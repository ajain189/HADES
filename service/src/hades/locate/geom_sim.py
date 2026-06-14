"""Geometric localization simulator (Task 4.2; research gate §6).

Generates calibrated synthetic ground truth for the meter-error metric and the coverage
validation: given a target lat/lon and an analytic flight path, it emits per frame a
ground-truth detection pixel (forward projection) plus a noisy pose (sensor errors injected
from a `SensorErrorModel`), so the downstream Fuse + Monte Carlo can be scored against a
known truth.

ANTI-CIRCULARITY (§4 Risk A) — the load-bearing architectural rule:

  `world_to_pixel` is the FORWARD-collinearity equation (world -> pixel). It MUST NOT call,
  import, or invert `geometry.ray_to_ground` (the inverse path). It shares ONLY the
  convention builders that are too sign-trap-loaded to re-derive safely:
  `geometry.R_world_body`, `CameraModel.K`, `CameraModel.R_body_cam`. Re-deriving the
  rotation here would just open a second home for a sign-flip bug.

The two paths are each pinned to their OWN hand-derived analytic fixtures (this module's
tests vs `test_geometry.py`); a shared rotation bug would have to satisfy both independent
anchors at once, which a sign error cannot. The zero-noise round-trip
(`world_to_pixel` then `ray_to_ground` recovers the target to < 1e-6 m) is a NECESSARY
sanity check, not the proof.

Ground truth is the INPUT `target_latlon` the sim was handed — never derived from any
projection. The forward map only produces the *pixel* a perfect detector would report.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Iterator

import numpy as np

from hades.ingest.telemetry_source import Pose
from hades.locate.camera_model import CameraModel
from hades.locate.error_model import SensorErrorModel
from hades.locate.geometry import R_world_body  # convention builder ONLY (NOT the solver)

_M_PER_DEG_LAT = 111320.0  # matches geometry.py's flat-earth scale (§3.1)


# --- ENU <-> geodetic offset (the INVERSE of geometry.py's ENU->latlon, written forward) ---
# geometry.py does:  lat = drone.lat + north/M ; lon = drone.lon + east/(M*cos(lat)).
# The forward direction (drone_latlon -> target_latlon => ENU offset in meters) is the
# algebraic inverse of those two lines. This is convention-sharing (the same flat-earth
# small-angle model and cos(lat) scaling), NOT solver-sharing.
def _enu_offset(drone_latlon: tuple[float, float], target_latlon: tuple[float, float]) -> np.ndarray:
    """ENU (east, north, up=0) meters from the drone's ground nadir to the target point."""
    dlat = target_latlon[0] - drone_latlon[0]
    dlon = target_latlon[1] - drone_latlon[1]
    north = dlat * _M_PER_DEG_LAT
    east = dlon * _M_PER_DEG_LAT * math.cos(math.radians(drone_latlon[0]))
    return np.array([east, north, 0.0])


def world_to_pixel(
    pose: Pose,
    camera: CameraModel,
    target_latlon: tuple[float, float],
    ground_elev: float,
) -> tuple[float, float] | None:
    """Forward-project a ground target to its image pixel (FORWARD collinearity).

    Returns ``(u_px, v_px)`` in original-frame pixels, or ``None`` when the target is
    behind the lens / outside the optical half-space (``r_cam.z <= 0``) — a "not visible"
    frame, never a phantom pixel. The math, written forward (NOT inverting ray_to_ground):

      p_enu = target_ENU - drone_ENU            # drone at (0,0,H) above its nadir
      r_cam = (R_world_body . R_body_cam)^T . p_enu   # world -> body -> optical (transpose)
      require r_cam.z > 0                        # in front of the lens
      u = fx * r_cam.x/r_cam.z + cx              # pinhole intrinsics, forward
      v = fy * r_cam.y/r_cam.z + cy
      then forward-distort (identity for the pinhole v1)
    """
    if pose.lat is None or pose.lon is None:
        raise ValueError("world_to_pixel: pose has no GPS fix")
    if pose.roll is None or pose.pitch is None or pose.yaw is None:
        raise ValueError("world_to_pixel: pose attitude is None — cannot project")
    if pose.alt is None:
        raise ValueError("world_to_pixel: pose.alt is None")

    height = pose.alt - ground_elev  # AGL; same-datum subtraction (sim controls both)
    # Drone sits at ENU (0, 0, H) above its own ground nadir; the target is on the plane.
    p_enu = _enu_offset((pose.lat, pose.lon), target_latlon)
    p_enu[2] = -height  # target is `height` below the drone (drone at +H, ground at 0)

    r_world_cam = R_world_body(pose.roll, pose.pitch, pose.yaw) @ camera.R_body_cam
    r_cam = r_world_cam.T @ p_enu  # world -> optical (active rotation transpose)

    if r_cam[2] <= 0.0:
        return None  # behind the lens / at-or-above the optical horizon: not visible

    u = camera.fx * (r_cam[0] / r_cam[2]) + camera.cx
    v = camera.fy * (r_cam[1] / r_cam[2]) + camera.cy
    u, v = _forward_distort(camera, u, v)
    return float(u), float(v)


def _forward_distort(camera: CameraModel, u: float, v: float) -> tuple[float, float]:
    # v1 fixtures are pinhole (no distortion) — identity. A calibrated O4 forward-distortion
    # model plugs in here later (the inverse of camera_model._undistort) without touching
    # any caller. Kept as a seam so the sim and the real lens model stay symmetric.
    if not camera.dist:
        return u, v
    raise NotImplementedError(
        "forward distortion not implemented for v1 (fixtures are pinhole)"
    )


# --- ground-truth frames + analytic flight paths ------------------------------------


@dataclass(frozen=True)
class GroundTruthFrame:
    """One frame of perfect ground truth: the true pose, the pixel a perfect detector sees,
    and the geometry (slant range, camera pitch from nadir, bearing to target)."""

    pose_true: Pose
    pixel_true: tuple[float, float]
    target_latlon: tuple[float, float]
    slant_range_m: float
    nadir_angle_deg: float  # camera optical-axis angle from straight-down
    target_bearing_deg: float  # compass bearing drone -> target (for aspect diversity)
    velocity_enu: tuple[float, float, float]  # (E, N, U) m/s — for the time-sync injection


@dataclass(frozen=True)
class SimFrame:
    """What the sim hands the localizer: a noisy pose + noisy pixel, plus the truth to
    score against. The localizer consumes `pose_meas`/`pixel_meas`; the meter-error report
    consumes `target_latlon`/`pose_true` as ground truth."""

    seq: int
    t: float
    pose_meas: Pose
    pose_true: Pose
    pixel_meas: tuple[float, float]
    pixel_true: tuple[float, float]
    target_latlon: tuple[float, float]
    slant_range_m: float
    nadir_angle_deg: float


def _geometry(
    camera: CameraModel,
    pose: Pose,
    target_latlon: tuple[float, float],
    ground_elev: float,
) -> tuple[float, float, float]:
    """(slant_range_m, nadir_angle_deg, target_bearing_deg) for one true pose + target."""
    p_enu = _enu_offset((pose.lat, pose.lon), target_latlon)
    height = pose.alt - ground_elev
    slant = math.hypot(math.hypot(p_enu[0], p_enu[1]), height)
    # Camera pitch from nadir: angle of the optical axis (+z into scene) from ENU-down.
    optical_axis = np.array([0.0, 0.0, 1.0])
    axis_world = R_world_body(pose.roll, pose.pitch, pose.yaw) @ camera.R_body_cam @ optical_axis
    down = np.array([0.0, 0.0, -1.0])
    nadir = math.degrees(math.acos(float(np.clip(np.dot(axis_world, down), -1.0, 1.0))))
    bearing = math.degrees(math.atan2(p_enu[0], p_enu[1])) % 360.0  # from North, clockwise
    return slant, nadir, bearing


def _velocity_enu(poses: list[Pose], i: int) -> tuple[float, float, float]:
    """Drone velocity (E, N, U) m/s at frame i, by central/one-sided finite difference.

    Feeds the time-sync injection: a pose lagged by Delta seconds is displaced by
    velocity * Delta along-track. With a single frame (no neighbor) velocity is zero.
    """
    if len(poses) < 2:
        return (0.0, 0.0, 0.0)
    j = i + 1 if i == 0 else i
