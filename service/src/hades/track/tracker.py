"""ByteTracker — a from-scratch numpy ByteTrack (Task 3.1).

Stateful `list[Detection] -> list[Track]`: assigns persistent IDs, bridges the
10→30fps gap with Kalman prediction, survives short occlusions, and NEVER resurrects a
dead ID. The defining ByteTrack behavior is **two-stage association**: high-confidence
detections are matched first, then *low*-confidence detections are matched only against
the tracks still unmatched after round one — this rescues a real survivor whose box
momentarily drops below the detection gate (the SAR recall-first doctrine) without
letting lone low-conf noise spawn a track (only high-conf detections initiate).

Deliberately torch-free (the project keeps PyTorch out of runtime/CI): the only
dependency is scipy's `linear_sum_assignment` for the optimal IoU matching. No RNG —
the tracker is fully deterministic, which the CI fixtures assert.

Coordinates are `box_xyxy` in original-frame pixels throughout (DESIGN.md §3.2); the
internal Kalman works in XYAH (see `kalman.py`) and converts at its boundary only.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum

import numpy as np
from scipy.optimize import linear_sum_assignment

from hades.detect.detector import Detection
from hades.track.kalman import KalmanFilter, xyah_to_xyxy, xyxy_to_xyah


class TrackState(Enum):
    """Lifecycle of a track. TENTATIVE → CONFIRMED → LOST → (removed, never resurrected)."""

    TENTATIVE = "tentative"  # newly initiated, not yet enough hits to be trusted
    CONFIRMED = "confirmed"  # matched on the current frame, surfaced to the pipeline
    LOST = "lost"  # unmatched but within the lost buffer; may still come back


@dataclass(frozen=True)
class Track:
    """A tracked object surfaced to the pipeline (box in original-frame pixels)."""

    track_id: int
    box_xyxy: tuple[float, float, float, float]
    state: TrackState
    conf: float = 0.0
    age: int = 0  # frames since the track was created
    hits: int = 0  # number of frames the track was matched to a detection
    time_since_update: int = 0  # frames since last matched (0 == matched this frame)


def _iou_matrix(tracks_xyxy: np.ndarray, dets_xyxy: np.ndarray) -> np.ndarray:
    """IoU between every (track, detection) pair. Shapes (T,4),(D,4) → (T,D)."""
    if len(tracks_xyxy) == 0 or len(dets_xyxy) == 0:
        return np.zeros((len(tracks_xyxy), len(dets_xyxy)), dtype=np.float64)

    tx1, ty1, tx2, ty2 = (tracks_xyxy[:, i][:, None] for i in range(4))
    dx1, dy1, dx2, dy2 = (dets_xyxy[:, i][None, :] for i in range(4))

    inter_w = np.clip(np.minimum(tx2, dx2) - np.maximum(tx1, dx1), 0, None)
    inter_h = np.clip(np.minimum(ty2, dy2) - np.maximum(ty1, dy1), 0, None)
    inter = inter_w * inter_h

    area_t = ((tx2 - tx1) * (ty2 - ty1))
    area_d = ((dx2 - dx1) * (dy2 - dy1))
    union = area_t + area_d - inter
    # Guard the 0/0 a zero-area box would produce (the §3.2/NMS division trap class).
    return np.divide(inter, union, out=np.zeros_like(inter), where=union > 0)


def _associate(
    track_boxes: np.ndarray, det_boxes: np.ndarray, iou_thresh: float
) -> tuple[list[tuple[int, int]], list[int], list[int]]:
    """Optimal IoU assignment. Returns (matches, unmatched_track_idx, unmatched_det_idx).

    Indices are into the *input arrays*, not track ids. A pair is only kept if its IoU
    clears `iou_thresh` (the Hungarian optimum can still include a bad pair, so we filter).
    """
    n_t, n_d = len(track_boxes), len(det_boxes)
    if n_t == 0 or n_d == 0:
        return [], list(range(n_t)), list(range(n_d))

    iou = _iou_matrix(track_boxes, det_boxes)
    # linear_sum_assignment minimises cost; we want to maximise IoU → minimise (1 - IoU).
    row_idx, col_idx = linear_sum_assignment(1.0 - iou)

    matches: list[tuple[int, int]] = []
    matched_t: set[int] = set()
    matched_d: set[int] = set()
    for r, c in zip(row_idx, col_idx):
        if iou[r, c] >= iou_thresh:
            matches.append((int(r), int(c)))
            matched_t.add(int(r))
            matched_d.add(int(c))

    unmatched_t = [i for i in range(n_t) if i not in matched_t]
    unmatched_d = [i for i in range(n_d) if i not in matched_d]
    return matches, unmatched_t, unmatched_d


@dataclass
class _Track:
    """Internal mutable track carrying Kalman state. Public `Track` is the snapshot."""

    track_id: int
    mean: np.ndarray
    covariance: np.ndarray
    state: TrackState
    conf: float
    age: int = 0
    hits: int = 0
    time_since_update: int = 0
    _history: list = field(default_factory=list)

    def box_xyxy(self) -> tuple[float, float, float, float]:
        return xyah_to_xyxy(self.mean)


class ByteTracker:
    """Two-stage ByteTrack association over a shared constant-velocity Kalman filter.

    Args:
        track_thresh: high/low confidence split. Detections ≥ this initiate and match in
            round 1; detections in `[det_thresh, track_thresh)` only match (round 2) and
            never initiate a track.
        det_thresh: floor below which a detection is ignored entirely.
        match_thresh: IoU floor for round-1 (high-conf) association.
        match_thresh_low: IoU floor for round-2 (low-conf) association — TIGHTER than
            round 1 (canonical ByteTrack: 0.5 vs 0.2). A low-conf detection is noisier, so
            it must overlap an existing track more closely to link; a loose floor here would
            attach round-2 garbage to a real track. Round 2 recovers a momentarily-faint
            box on an ESTABLISHED track, it does not chase weak matches.
        track_buffer: frames a LOST track is kept alive (and re-matchable) before it is
            permanently removed. At ~10fps detection cadence, 30 ≈ 3s of occlusion.
        min_hits: matches required before a TENTATIVE track is CONFIRMED (surfaced).
