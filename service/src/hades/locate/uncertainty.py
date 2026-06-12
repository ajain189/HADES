"""Monte Carlo uncertainty propagation (Task 4.4; research gate §4).

The FINAL reported uncertainty for a confirmed contact. Where `fuse.py` uses a cheap
linearized Jacobian for the per-frame fusion WEIGHT, this module produces the honest
reported ellipse + sweep radius by Monte Carlo: sample the input sigmas from the
`error_model`, push each draw through the SAME `ray_to_ground` (single source of truth),
and read the cloud's shape.

Decisions locked in the research gate:

- **Monte Carlo, N=1000** (2000 for the offline coverage report) - not Unscented Transform
  or linearized. Only MC yields the empirical R95 quantile of the non-Gaussian cross-range
  arc; UT/linearized assume Gaussian-from-covariance, which is exactly what the banana
  breaks. MC runs only on the confirmed contact (cold path), so the cost is trivial.

- **R95 = the EMPIRICAL 95th-percentile sample radius about the point estimate, NOT the
  major semi-axis.** The major semi-axis over-states the equal-coverage circle (it sweeps
  empty area off the minor axis) -> false pessimism. The empirical quantile is the honest,
  assumption-free "95% of the time the survivor is within this circle" claim, robust to the
  non-Gaussian shape.

- **95% ellipse scale = sqrt(chi^2(2)=5.991)** = 2.4477 (the expert overlay), oriented by
  the sample-covariance eigenvectors.

- **Common-mode heading bias drawn ONCE per contact**, jitter per draw - drawing the bias
  i.i.d. per draw would fake an error reduction fusion cannot achieve (the smug filter,
  inside the MC).

- **Per-sample above-horizon rejection** (`ray_to_ground` raises) + a max-plausible-range
  cap. The reject FRACTION is reported; a near-horizon-unstable contact (> 5% reject) is
  forced to CUE_ONLY with a floor radius - a transparent rejection, never a silent clip
  (clipping biases the covariance inward = false confidence).
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from hades.ingest.telemetry_source import Pose
from hades.locate.camera_model import CameraModel
from hades.locate.error_model import SensorErrorModel
from hades.locate.geometry import ray_to_ground  # SINGLE SOURCE OF TRUTH (D1) - shared

_M_PER_DEG_LAT = 111320.0
_CHI2_2_95 = 5.991464547107979
_R95_SCALE = math.sqrt(_CHI2_2_95)  # 2.4477...

# A contact whose MC draws reject (above-horizon) above this fraction is near-horizon
# unstable -> CUE_ONLY with a floor radius (research gate §4).
_REJECT_FRACTION_CUE = 0.05
_MAX_GROUND_RANGE_M = 5000.0  # a survivor 5 km out is not what this camera resolves
_CUE_FLOOR_RADIUS_M = 200.0  # the honest "area, not a point" floor for an unstable contact

# Actionability class R95 band edges, meters (must match fuse.py for a consistent class).
_PINPOINT_M = 5.0
_SWEEP_M = 25.0
_AREA_M = 100.0


@dataclass(frozen=True)
class UncertaintyResult:
    """The reported uncertainty for one contact: covariance, 95% ellipse, and the honest
    equal-coverage R95 sweep radius + its actionability class."""

    cov: np.ndarray  # 2x2 ENU sample covariance (meters)
    r95_m: float  # empirical 95th-percentile sample radius (the sweep circle)
    semi_major_m: float  # 95% ellipse major semi-axis (expert overlay)
    semi_minor_m: float
    orientation_deg: float
    actionability_class: str  # PINPOINT | SWEEP | AREA | CUE_ONLY
    reject_fraction: float  # fraction of MC draws that rejected (above-horizon / out of range)
    floor_radius_m: float  # the CUE floor applied when reject_fraction is high
    coverage_of_own_r95: float  # fraction of samples within r95 (≈0.95 by construction)
    n_used: int  # MC draws that produced a valid ground point


class MonteCarloUncertainty:
    """Propagates input sigmas to a contact's reported ellipse + R95 by Monte Carlo."""

    def __init__(
        self, error_model: SensorErrorModel, n_draws: int = 1000, seed: int = 0
    ) -> None:
        self.m = error_model
        self.n = n_draws
        self.seed = seed

    def propagate(
        self,
        pose: Pose,
        camera: CameraModel,
        pixel: tuple[float, float],
        ground_elev: float = 0.0,
    ) -> UncertaintyResult:
        """Monte Carlo ground-point cloud for one contact around `pose`/`pixel`.

        Draws N perturbed (pose, pixel) realizations, projects each via `ray_to_ground`, and
        summarizes the surviving cloud. The heading bias is ONE draw shared across the N
        realizations (common-mode); jitter + GPS + boresight + pixel noise are per draw.
        """
        rng = np.random.default_rng(self.seed)
        m = self.m

        origin = (pose.lat, pose.lon)
        pts: list[np.ndarray] = []
        rejected = 0
        for _ in range(self.n):
            # The heading BIAS (crab) is UNKNOWN for this contact, so each MC sample draws its
            # own realization — that uncertainty is real dispersion in the reported ellipse.
            # (The "once per contact, not per frame" rule of §4 governs MULTI-FRAME fusion
            # geometry, where the SAME physical bias hits every frame; here we quantify a
            # single contact's uncertainty, so the unknown bias is a per-sample random var.)
            bias_sign = rng.choice([-1.0, 1.0]) if m.crab_sign_random else 1.0
            heading_bias = bias_sign * (
                m.crab_angle_deg + rng.normal(0.0, m.heading_bias_sigma_deg)
            )
            sample_pose, sample_pixel = self._draw(pose, pixel, m, heading_bias, rng)
            try:
                latlon = ray_to_ground(
                    sample_pose, camera, pixel=sample_pixel,
