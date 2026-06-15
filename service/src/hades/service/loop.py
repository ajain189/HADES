"""Service loop - assembles the pipeline and emits over two WS channels (Task 4.7).

This is the FIRST place the real pipeline runs end to end and emits the taskable
`ContactRecord`. Per the research gate (§10), it adds exactly THREE deltas over the proven
`cli/replay_dump` chain (which already wires FrameSource + SrtFileSource -> align -> Detector
-> Tracker -> Confirmation on CPU):

  1. Fuse on confirmed tracks (the real Projector + Fuser, not replay_dump's display proxy),
  2. the two-channel emit (binary JPEG frames + JSON detections/contacts), and
  3. a long-running loop.

Design for testability (§10): the core `run_messages()` is a GENERATOR of per-frame
`LoopOutput` (frame_id, jpeg, DetectionMessage, list[ContactRecord]), decoupled from the WS
transport - so it runs fully offline + deterministic with a `StubDetector` on CPU. The thin
`serve()` wrapper pushes those outputs onto the two localhost WS channels. CoreML is NEVER
imported at module top; the detector is injected (the ANE path stays a manual/hardware run).

The single highest seam risk is frame_id ALIGNMENT across the two channels: the JPEG, the
DetectionMessage, and every ContactRecord for a frame all carry the SAME frame_id (the join
key the UI uses). The `.srt` replay path is position-only, so `ray_to_ground` raises on every
frame and every contact is CUE-ONLY - the loop catches that and emits the contact (recall-
first), it does NOT crash and does NOT drop the detection from view.
"""

from __future__ import annotations

import io
from collections import defaultdict, deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Iterator

import numpy as np
from PIL import Image

from hades.confirm.confirmation import Confirmation, Tier
from hades.ingest.file_frame_source import FileFrameSource
from hades.ingest.srt_file_source import SrtFileSource
from hades.ingest.sync import align
from hades.locate.camera_model import CameraModel
from hades.locate.error_model import SensorErrorModel
from hades.locate.fuse import FuseObservation, Fuser
from hades.locate.projector import GroundPoint, Projector
from hades.track.tracker import ByteTracker
from hades.ws.schema import ContactRecord, DetectionMessage

if TYPE_CHECKING:
    from hades.detect.detector import Detector
    from hades.ingest.telemetry_source import Pose

# How many recent per-track observations the fuser keeps (the fusion buffer ~ a few seconds).
_FUSE_WINDOW = 60


@dataclass
class LoopOutput:
    """One frame's emit: the binary JPEG + the JSON DetectionMessage + any ContactRecords.
    All three carry the SAME `frame_id` - the cross-channel join key (§10)."""

    frame_id: int
    timestamp: float
    jpeg: bytes
    detection_msg: DetectionMessage
    contacts: list[ContactRecord]


@dataclass
class _TrackBuf:
    """Per-track rolling fusion buffer + bookkeeping for the contact record."""

    obs: deque = field(default_factory=lambda: deque(maxlen=_FUSE_WINDOW))
    first_frame: int = -1  # -1 = never seen; stamped on first sighting (independent of obs)
    last_conf: float = 0.0


class ServiceLoop:
    """Assembles the pipeline over a recorded clip (+ telemetry) and produces per-frame emits.

    The detector is INJECTED (CPU-only `StubDetector` in tests, ONNX/CoreML in the real run) so
    the loop never imports a hardware backend. Camera + error model default to the v1 config.
    """

    def __init__(
        self,
        clip: str | Path,
        telemetry: str | Path | None,
        detector: Detector,
        *,
        camera: CameraModel | None = None,
        ground_elev: float = 0.0,
        error_model: SensorErrorModel | None = None,
    ) -> None:
        self.clip = clip
        self.telemetry = telemetry
        self.detector = detector
        self.camera = camera or CameraModel(fx=1400.0, fy=1400.0, cx=960.0, cy=540.0, mount="nadir")
        self.projector = Projector(camera=self.camera, ground_elev=ground_elev)
        self.fuser = Fuser(error_model=error_model or SensorErrorModel())
        self.tracker = ByteTracker(min_hits=1)
        self.confirmer = Confirmation()
        self._bufs: dict[int, _TrackBuf] = defaultdict(_TrackBuf)

    def run_messages(self, *, max_frames: int | None = None) -> Iterator[LoopOutput]:
        """Yield one `LoopOutput` per frame: the assembled-pipeline result, aligned by frame_id.

        Drop-to-latest / back-pressure is the WS transport's job (`serve`); this core runs the
        pipeline once per aligned frame and produces well-formed, frame_id-aligned messages.
        """
        frames = FileFrameSource(self.clip)
        poses = list(SrtFileSource(self.telemetry)) if self.telemetry is not None else []

        count = 0
        for aligned in align(frames, poses):
            if max_frames is not None and count >= max_frames:
                break
            frame_id = aligned.frame.seq
            ts = aligned.frame.timestamp
            detections = self.detector.detect(aligned.frame.frame)
            pose = aligned.pose

            # Detector path: detections are ALWAYS emitted on the JSON channel (recall-first).
            det_msg = DetectionMessage.from_detections(
                frame_id=frame_id, timestamp=ts, detections=detections
            )

            # Track -> per-track GroundPoint (real Projector, not the display proxy).
            tracks = self.tracker.update(detections)
            ground: dict[int, GroundPoint] = {}
            for t in tracks:
                gp = (
                    self.projector.project([_as_detection(t)], pose)[0]
                    if pose is not None
                    else _cue_only_ground_point(t)
                )
                ground[t.track_id] = gp
                buf = self._bufs[t.track_id]
                if buf.first_frame < 0:  # stamp age origin on FIRST sighting, even with no pose
                    buf.first_frame = frame_id
                buf.last_conf = t.conf
                # Buffer for fusion ONLY a gate-fusable observation. A REJECT frame (bad
                # geometry) whose ray still projects to a finite point must NOT enter the fused
                # estimate - the gate governs fusion-eligibility, never visibility (the
                # detection still surfaces via `ground`/the DetectionMessage above).
                if pose is not None and _should_buffer(gp):
                    buf.obs.append(_fuse_obs(t, pose, self.camera))

            tiers = self.confirmer.update(ground) if ground else {}

            contacts = self._contacts_for(frame_id, tracks, ground, tiers)
            yield LoopOutput(
                frame_id=frame_id,
                timestamp=ts,
                jpeg=_encode_jpeg(aligned.frame.frame),
                detection_msg=det_msg,
                contacts=contacts,
            )
            count += 1

    # --- contact-record assembly ----------------------------------------------------

    def _contacts_for(
        self,
        frame_id: int,
        tracks,
        ground: dict[int, GroundPoint],
        tiers: dict[int, Tier],
    ) -> list[ContactRecord]:
        out: list[ContactRecord] = []
        for t in tracks:
            tier = tiers.get(t.track_id, Tier.CONTACT)
            buf = self._bufs[t.track_id]
            age = max(1, frame_id - buf.first_frame + 1)
            gp = ground.get(t.track_id)

            # Fuse ONLY confirmed (STRONG) tracks that have fusable observations; otherwise the
            # contact is CUE-ONLY (visible, no fused coordinate) - the position-only .srt path.
            fused = None
            if tier is Tier.STRONG and buf.obs:
                fused = self.fuser.fuse(list(buf.obs))

            if fused is not None:
                out.append(
                    ContactRecord.from_fused(
                        frame_id=frame_id,
                        track_id=t.track_id,
                        coord=fused.coord,
