"""Constant-velocity Kalman filter in XYAH state — the ByteTrack motion model.

State is 8-D: ``[cx, cy, a, h, vcx, vcy, va, vh]`` where the box is parameterised by
**center** ``(cx, cy)``, **aspect** ``a = w / h``, and **height** ``h`` — the canonical
ByteTrack/SORT parameterisation (height-relative noise keeps a far/small box from being
swamped by the same absolute uncertainty as a near/large one). The xyxy↔xyah conversion
is the one place a mirrored-axis (DESIGN.md §3.2) bug can creep in, so it lives here in
one spot and is round-trip-tested.

This is a faithful numpy port of the standard ByteTrack filter (no torch). It is
deterministic: no RNG, fixed matrices.
"""

from __future__ import annotations

import math

import numpy as np

# Standard deviation weights (ByteTrack defaults). Process and measurement noise both
# scale with box height so uncertainty is size-relative, not absolute-pixels.
_STD_WEIGHT_POSITION = 1.0 / 20.0
_STD_WEIGHT_VELOCITY = 1.0 / 160.0


def xyxy_to_xyah(box_xyxy: tuple[float, float, float, float]) -> np.ndarray:
    """``(x_min, y_min, x_max, y_max)`` pixels → ``[cx, cy, a, h]`` measurement vector."""
    x_min, y_min, x_max, y_max = box_xyxy
    w = x_max - x_min
    h = y_max - y_min
    # A zero/negative or non-finite height divides into the aspect ratio and seeds an
    # inf/NaN into the filter that corrupts every downstream box (the `Detection`
    # constructor already rejects degenerate boxes, but guard the conversion too so no
    # caller path can poison the Kalman state).
    if not (math.isfinite(w) and math.isfinite(h)) or h <= 0.0:
        raise ValueError(f"xyxy_to_xyah: degenerate/non-finite box {box_xyxy!r}")
    cx = x_min + w / 2.0
    cy = y_min + h / 2.0
    return np.array([cx, cy, w / h, h], dtype=np.float64)


def xyah_to_xyxy(xyah: np.ndarray) -> tuple[float, float, float, float]:
    """``[cx, cy, a, h]`` → ``(x_min, y_min, x_max, y_max)`` pixels (inverse of above)."""
    cx, cy, a, h = xyah[0], xyah[1], xyah[2], xyah[3]
    w = a * h
    return (cx - w / 2.0, cy - h / 2.0, cx + w / 2.0, cy + h / 2.0)


class KalmanFilter:
    """8-D constant-velocity filter over XYAH. One instance is shared by all tracks."""

    def __init__(self) -> None:
        ndim, dt = 4, 1.0
        # Constant-velocity state-transition: position += velocity each step.
        self._motion_mat = np.eye(2 * ndim, 2 * ndim)
        for i in range(ndim):
            self._motion_mat[i, ndim + i] = dt
        # We only measure the 4 position dims, not velocities.
        self._update_mat = np.eye(ndim, 2 * ndim)

    def initiate(self, measurement: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """Create a track state from an initial XYAH measurement."""
        mean_pos = measurement
        mean_vel = np.zeros_like(mean_pos)
        mean = np.r_[mean_pos, mean_vel]

        h = measurement[3]
        std = np.array(
            [
