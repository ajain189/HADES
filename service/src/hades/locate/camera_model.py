"""CameraModel — fixed per-camera config the ray→ground geometry consumes (Task 3.4).

Holds intrinsics `K`, distortion, and the boresight `R_body_cam` (CAMERA-OPTICAL →
BODY-FRD, DESIGN.md §3.3). For the O4's fixed (no-gimbal) mount the boresight is a full
axis permutation, NOT near-identity — the camera is hard-mounted, so camera pitch = fixed
mount angle + airframe pitch. Two reference mounts are provided and verified against the
analytic derivation:

- ``nadir``: optical axis straight DOWN. optical +z → body +z (down), +x → +y (right),
  +y (image-down) → body −x (backward), so top-of-image = forward/North.
- ``forward``: optical axis straight FORWARD. optical +z → body +x (forward).

The optical-frame ray for a pixel is ``K⁻¹·pixel = [(u−cx)/fx, (v−cy)/fy, 1]`` (+z into
the scene), per §3.3. Distortion is undistorted before forming the ray; v1 fixtures are
pinhole (k=0) so undistortion is identity until a calibrated O4 lens model lands.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

# Boresight matrices (CAMERA-OPTICAL → BODY-FRD), each orthonormal with det +1. Columns
# are the images of optical (+x, +y, +z). Verified against the independent derivation.
_R_BODY_CAM_NADIR = np.array(
    [
        [0.0, -1.0, 0.0],  # optical +x → body +y (right); +y → body −x (back); +z → +z (down)
        [1.0, 0.0, 0.0],
        [0.0, 0.0, 1.0],
    ]
)
_R_BODY_CAM_FORWARD = np.array(
    [
        [0.0, 0.0, 1.0],  # optical +z → body +x (forward); +x → +y (right); +y → +z (down)
        [1.0, 0.0, 0.0],
        [0.0, 1.0, 0.0],
    ]
)
_MOUNTS = {"nadir": _R_BODY_CAM_NADIR, "forward": _R_BODY_CAM_FORWARD}


@dataclass(frozen=True)
class CameraModel:
    """Intrinsics + boresight for the fixed O4 mount. Loadable from config.

    Args:
        fx, fy: focal lengths in pixels.
