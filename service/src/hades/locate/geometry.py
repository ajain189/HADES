"""The ONE ray→ground recipe (DESIGN.md §3.4) — single source of truth (Task 3.4).

`ray_to_ground` is imported by BOTH the Projector (Task 3.5) and Fuse (Phase 4) and is
NEVER re-implemented — that discipline is what prevents the coordinate-convention
divergence the design fears. Every convention from DESIGN.md §3.1-§3.4 is explicit here:

  undistort(pixel) → K⁻¹·pixel               # optical-frame ray, +z into scene
    → R_world_body · R_body_cam · ray        # active rotate optical → ENU world
    → require ray·Up < 0, else REJECT        # no phantom ground pin behind the drone
    → intersect flat-earth plane at the operator ground elevation (AGL)
    → ENU offset → (lat, lon)                # WGS84, (lat, lon) degrees order

Frames (§3.1-§3.3): world = ENU (East, North, Up), +z up, flat-earth, origin at the
drone's ground-nadir for this frame. Body = FRD (x-forward, y-right, z-down). Attitude
(roll, pitch, yaw) degrees with +pitch nose-up, +roll right-wing-down, yaw clockwise from
true North. Composition is the active rotation of column vectors:
``v_world = R_world_body · R_body_cam · v_cam``.

`R_world_body` is the aerospace ZYX (yaw→pitch→roll) intrinsic Euler giving FRD→NED, then
the fixed NED→ENU axis adapter. **+pitch needs NO sign flip** — the adapter already maps
scipy's +pitch (nose forward-up in NED) to a positive ENU up-component (the named sign
trap). Degrees are converted to radians only inside this module, never across a boundary
(§3.1).
"""

from __future__ import annotations

import math

import numpy as np
from scipy.spatial.transform import Rotation

from hades.ingest.telemetry_source import Pose
from hades.locate.camera_model import CameraModel

_METERS_PER_DEG_LAT = 111320.0  # flat-earth small-angle scale (§3.1)

# Fixed NED→ENU axis adapter: NED=[N,E,D] → ENU=[E,N,U] with E=E_ned, N=N_ned, U=−D_ned.
# det = +1 (a proper axis swap+flip, not a reflection).
_P_NED_ENU = np.array(
    [
        [0.0, 1.0, 0.0],
        [1.0, 0.0, 0.0],
        [0.0, 0.0, -1.0],
    ]
)

# Datums HADES recognises. A subtraction is allowed ONLY between two IDENTICAL, non-UNKNOWN
# datums (DESIGN.md §3.1/§3.5). HAE and MSL are NOT mutually subtractable even though both
# are "absolute": they differ by the geoid undulation (~−25 to −35 m on hurricane coasts),
# and HADES has no geoid-normalization, so mixing them injects the very ~30 m AGL error the
# alt_datum tag exists to prevent. UNKNOWN never feeds a subtraction, even against itself —
# two UNKNOWN tags are by definition of possibly-different datums (the tag means "we could
# not determine it"). REL_TAKEOFF subtracts only against REL_TAKEOFF.
_KNOWN_DATUMS = frozenset({"HAE", "MSL", "REL_TAKEOFF", "UNKNOWN"})


def R_world_body(roll_deg: float, pitch_deg: float, yaw_deg: float) -> np.ndarray:
    """Rotation mapping a BODY (FRD) vector to a WORLD (ENU) vector: ``v_enu = R · v_frd``.

    Aerospace ZYX (yaw, pitch, roll) intrinsic Euler (FRD→NED) composed with the fixed
    NED→ENU adapter. +pitch = nose-up requires no sign flip (the adapter handles it).
    """
    r_ned_body = Rotation.from_euler(
        "ZYX", [yaw_deg, pitch_deg, roll_deg], degrees=True
    ).as_matrix()
    return _P_NED_ENU @ r_ned_body


def _agl(pose: Pose, ground_elev: float, ground_elev_datum: str) -> float:
    """Height of the drone above the ground plane (AGL), refusing to mix vertical datums.

    H = drone_alt − ground_elev, valid ONLY when both carry the SAME, KNOWN, non-UNKNOWN
    datum. Refuses HAE↔MSL (geoid undulation, no normalization here), REL_TAKEOFF↔absolute,
    any UNKNOWN — even UNKNOWN↔UNKNOWN — and any UNRECOGNISED/empty tag (an `==`-equal but
    meaningless datum like "" or a typo is not a license to subtract). Subtracting across
    any of these silently injects a ~30 m offset (DESIGN.md §3.5).
    """
    if pose.alt is None:
        raise ValueError("ray_to_ground: pose.alt is None (no altitude to form AGL)")
    drone_datum = pose.alt_datum

    # Allowed iff identical AND a RECOGNISED, non-UNKNOWN datum. (HAE/MSL differ by the
    # geoid; UNKNOWN is unknowable; an unrecognised/empty tag is not a real datum.)
    subtractable = {d for d in _KNOWN_DATUMS if d != "UNKNOWN"}
    if drone_datum != ground_elev_datum or drone_datum not in subtractable:
