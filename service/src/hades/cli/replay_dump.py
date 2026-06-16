"""replay-dump — write annotated frames so ingestion is visually observable.

The Phase 1 green criterion: replay a recorded clip (+ optional `.srt` telemetry),
overlay each frame with its time-synced pose (alt / attitude / fix status), and
write the frames to disk. This is the first place the whole ingestion path runs
end to end: `FileFrameSource` + `SrtFileSource` -> `align()` -> overlay.

The overlay is deliberately honest (DESIGN.md): it shows the `pose_status`
(OK / INTERPOLATED / EXTRAPOLATED / STALE / MISSING), prints "no fix" rather than
a fabricated 0,0, and shows attitude as "--" when the source can't supply it
(the DJI `.srt` case) rather than implying a level/north default.
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

from PIL import Image, ImageDraw

from hades.confirm.confirmation import Tier
from hades.ingest.file_frame_source import FileFrameSource
from hades.ingest.srt_file_source import SrtFileSource
from hades.ingest.sync import AlignedFrame, PoseStatus, align
from hades.ingest.telemetry_source import Pose

if TYPE_CHECKING:
    from hades.detect.detector import Detector

#: Detection box outline color (bright green) — distinct from the pose-overlay text.
BOX_COLOR = (0, 255, 120)

#: Per-tier box color so display priority is visually unambiguous on the feed (Task 3.8).
#: A faint glimpse (contact) is dim; a corroborated/persistent survivor (strong) is hot.
TIER_COLORS: dict[Tier, tuple[int, int, int]] = {
    Tier.CONTACT: (120, 120, 120),  # dim grey — the faint one-frame glimpse, still visible
    Tier.CANDIDATE: (255, 200, 0),  # amber — promoted by persistence/confidence
    Tier.STRONG: (255, 40, 40),  # hot red — corroborated / very-persistent, dispatch-grade
}


def run_replay_dump(
    clip: str | Path,
    telemetry: str | Path | None,
    out_dir: str | Path,
    *,
    stride: int = 1,
    max_frames: int | None = None,
    detector: Detector | None = None,
    track: bool = False,
) -> int:
    """Replay `clip` (+ optional telemetry), dump annotated frames to `out_dir`.

    A real clip is thousands of frames; `stride` (write every Nth frame) and
    `max_frames` (cap total written) keep this observability tool from dumping
    multi-GB of PNGs. When `detector` is given, each frame is run through it and the
    detected boxes are drawn — the Phase 2 observable green criterion. When `track` is
    also set, detections are run through the tracker → confirmation pipeline and each
    contact's TRACK ID + display-priority TIER is drawn instead (the Phase 3 observable
    green criterion), the box color encoding the tier. Returns the number of frames
    written.
    """
    if stride < 1:
        raise ValueError("stride must be >= 1")
    if track and detector is None:
        raise ValueError("--track requires a detector (nothing to track without detections)")
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)

    frames = FileFrameSource(clip)
    poses = list(SrtFileSource(telemetry)) if telemetry is not None else []

    # The tracker and confirmation rule are stateful across frames; one instance per run.
    tracker = _make_tracker() if track else None
    confirmer = _make_confirmer() if track else None

    count = 0
    for aligned in align(frames, poses):
        if aligned.frame.seq % stride != 0:
            continue
        if max_frames is not None and count >= max_frames:
            break
        img = Image.fromarray(aligned.frame.frame, mode="RGB")
        # Pose overlay first (opaque top bar), then detection/track boxes on top — so a box
        # near the top edge isn't occluded by the telemetry strip (review, minor).
        _draw_overlay(img, aligned)
        if detector is not None:
            detections = detector.detect(aligned.frame.frame)
            if track:
                _track_and_draw(img, detections, tracker, confirmer)
            else:
                _draw_detections(img, detections)
        img.save(out / f"frame_{aligned.frame.seq:05d}.png")
        count += 1
    return count


def _make_tracker():
    from hades.track.tracker import ByteTracker

    # min_hits=1 so a glimpse becomes a (low-tier) contact immediately — recall-first.
    return ByteTracker(min_hits=1)


def _make_confirmer():
    from hades.confirm.confirmation import Confirmation

    return Confirmation()

