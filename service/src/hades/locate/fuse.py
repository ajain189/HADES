"""Fuse - geometry-weighted multi-frame localization with an honest bias floor (Task 4.3).

The flagship estimator. Given the per-frame fusable observations of ONE stationary survivor
track, it produces a single fused ground coordinate with an HONEST 2x2 covariance. The
design is the research gate (docs/plans/p4-localization-research.md) sections 1, 2, 6:

- **Full-information weighted mean** (`Wi = Sigma_i^-1`), in the local ENU tangent plane in
  meters about a fixed mission origin. NOT a scalar `1/trace` weight: the dominant heading
  error makes each `Sigma_i` anisotropic and rotated, and the only real fusion gain on a
  heading-limited system is azimuthal diversity collapsing the cross-range axis - which a
  scalar weight discards. Full `Sigma_i^-1` also self-down-weights oblique/long-range frames
  (their `Sigma_i` is huge along down-range), so no hand-tuned cos/range factor is applied.

- **Per-frame `Sigma_i` via the linearized Jacobian of the SHARED `ray_to_ground`** (central
  finite difference, 2x7). The same single-source-of-truth function the Projector uses (D1),
  never re-implemented. The cheap Jacobian is for the WEIGHT only; the final reported tail is
  refined by Monte Carlo in `uncertainty.py` (Task 4.4).

- **THE BIAS FLOOR (the headline honesty point), via MONTE CARLO OVER FUSION.** Inverse-
  variance averaging drives the zero-mean jitter down as ~1/sqrt(N) but CANNOT touch the
  common-mode heading bias (the same wind-crab offset on every frame of one pass). A naive
  `Sigma_fuse = Lambda^-1` therefore shrinks toward zero while the estimate sits on a
  CONFIDENTLY WRONG point - the "smug filter," the worst SAR failure. The research gate (§2)
  originally specified an additive analytic floor `Sigma_report = Lambda^-1 + Sigma_bias`;
  this implementation supersedes that with the gate's own §1.2 Monte-Carlo-over-fusion (the
  linearized additive form under-covered: matched coverage 0.46 / NEES ~11, vs 0.99 / NEES ~1
  for MC). `_mc_fused_cov` resamples the inputs - drawing the heading BIAS ONCE per realization
  (the common-mode rule), jitter per frame - re-fuses each, and reports the spread of the FUSED
  estimates. Because the bias is shared across a realization's frames, it does NOT average out
  within that realization: the cloud stays wide and R95 asymptotes to a floor that grows with
  the heading lever arm (ground range), never to zero. The reported R95 is the EMPIRICAL 95th-
  percentile radius of that cloud about x_hat (the honest equal-coverage circle, §4), NOT the
  major semi-axis.

- **Aspect diversity informs the floor.** A heading bias displaces the ground point roughly
  perpendicular to the camera->target azimuth; observed from a spread of azimuths it partially
  cancels (the MC cloud tightens because the per-realization bias projects to different ground
  directions across diverse frames). A single straight pass (aspect_spread < ~70 deg) is
  flagged `heading_limited` and capped at SWEEP (never PINPOINT) no matter how tight the
  variance. v1 reports the floor and the regime; it does not ESTIMATE the bias (Schmidt-
  consider is v1.x).

- **Moving-target / model-mismatch detection** via a NIS-style residual-consistency test
  (mean squared Mahalanobis ~ 2 under a static target). High/over-threshold -> the estimate
  stays CONVERGING with the (large) empirical-scatter radius, `moving_suspected=True`. A
  single gross outlier is chi^2-rejected from the fused mean first (still visible as a
  detection - the gate owns fusion-eligibility, never visibility) so it can't fake "moving".
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from enum import Enum

import numpy as np

from hades.ingest.telemetry_source import Pose
from hades.locate.camera_model import CameraModel
from hades.locate.error_model import SensorErrorModel
from hades.locate.geometry import ray_to_ground  # SINGLE SOURCE OF TRUTH (D1) - shared

_M_PER_DEG_LAT = 111320.0
_CHI2_2_95 = 5.991464547107979  # chi^2(2) at 0.95 -> the 95% ellipse scale
_CHI2_2_999 = 13.815510557964274  # chi^2(2) at 0.999 -> per-frame outlier reject gate
_R95_FROM_SIGMA = math.sqrt(_CHI2_2_95)  # 2.4477...: circular-Gaussian R95 from an isotropic sigma

# Aspect-spread regime boundary (research gate §2): below this the heading bias does NOT
# cancel (single-pass), so the contact is heading_limited and capped at SWEEP; an orbit spans
# ~180 deg of axial spread and clears it (the bias is observable -> relaxed).
_ASPECT_RELAXED_DEG = 70.0

# Moving-target NIS threshold: mean squared Mahalanobis ~ 2 (=dim) under a static target.
# tau is the multiple of that expectation above which we declare non-convergence.
_NIS_TAU = 3.0

# Actionability class R95 band edges, meters (research gate §4; locked on sim calibration).
_PINPOINT_M = 5.0
_SWEEP_M = 25.0
_AREA_M = 100.0


class ConvergenceState(str, Enum):
    """Temporal-stability axis (orthogonal to the R95-band actionability class)."""

    CONVERGING = "CONVERGING"
    STABLE = "STABLE"


@dataclass(frozen=True)
class FuseObservation:
    """One fusable per-frame look at the track: the pose, the camera, and the detection
    pixel (the box bottom-center, the §3.2 feet-on-ground point). The fuser re-projects this
    pixel through the shared `ray_to_ground` and linearizes around the pose for the weight."""

    pose: Pose
    camera: CameraModel
    pixel: tuple[float, float]


@dataclass(frozen=True)
class FusedEstimate:
    """The fused result for one track. `coord` is (lat, lon). `r95_m` is the floored,
    honest sweep radius; `r95_prefloor_m` exposes the pure information radius (for tests /
    diagnostics). The ellipse (semi-axes + orientation) is the expert overlay."""

    coord: tuple[float, float]
    r95_m: float
    r95_prefloor_m: float
    cov_report: np.ndarray  # 2x2 ENU covariance INCLUDING the bias floor
    semi_major_m: float
    semi_minor_m: float
    orientation_deg: float
    actionability_class: str  # PINPOINT | SWEEP | AREA | CUE_ONLY
    convergence: ConvergenceState
    heading_limited: bool
    aspect_spread_deg: float
    moving_suspected: bool
    n_fused: int
    n_rejected: int
    nis: float


def _enu_offset(origin: tuple[float, float], latlon: tuple[float, float]) -> np.ndarray:
    """(east, north) meters of `latlon` relative to the `origin` lat/lon."""
    north = (latlon[0] - origin[0]) * _M_PER_DEG_LAT
    east = (latlon[1] - origin[1]) * _M_PER_DEG_LAT * math.cos(math.radians(origin[0]))
    return np.array([east, north])


def _enu_to_latlon(origin: tuple[float, float], enu: np.ndarray) -> tuple[float, float]:
    lat = origin[0] + enu[1] / _M_PER_DEG_LAT
    lon = origin[1] + enu[0] / (_M_PER_DEG_LAT * math.cos(math.radians(origin[0])))
    return lat, lon


class Fuser:
    """Stateless multi-frame fuser. One `fuse(observations)` call per (re-)evaluation."""

    def __init__(self, error_model: SensorErrorModel, mc_draws: int = 200, seed: int = 0) -> None:
        self.m = error_model
        self.mc_draws = mc_draws  # MC-over-fusion realizations for the reported covariance
        self.seed = seed

    # --- public ---------------------------------------------------------------------

    def fuse(self, observations: list[FuseObservation]) -> FusedEstimate | None:
        """Fuse the fusable observations of one stationary track into a FusedEstimate.

        Returns None if no observation projects (a CUE-ONLY contact upstream).
        """
        projected = self._project_all(observations)
        if not projected:
            return None

        origin = projected[0][0]  # mission origin = first projected lat/lon
        points = [_enu_offset(origin, latlon) for latlon, _ in projected]
        covs = [Sigma for _, Sigma in projected]

        # --- robust outlier reject (GROSS single bad boxes only) ---
        # Iteratively drop the single worst-residual frame while its removal is justified: it
        # must be a gross outlier vs the bulk AND the bulk must otherwise be consistent. This
        # removes a misassociation/glint without mass-rejecting a coherent DRIFT (whose points
        # are all mildly off, none grossly) - the drift must survive to feed the NIS test.
        kept_idx, n_rejected = self._reject_outliers(points, covs)
        pts = [points[i] for i in kept_idx]
        cvs = [covs[i] for i in kept_idx]

        # --- full-information weighted mean (the point estimate + its info radius) ---
        x_hat, cov_info = self._weighted_mean(pts, cvs)

        aspect_spread = self._aspect_spread(observations, origin)

        # --- REPORTED covariance + cloud = Monte Carlo OVER THE FUSION (research gate §1.2, §4) ---
        # The cheap linearized cov_info under-states the true fused error: at 20 deg heading the
        # ray map is non-linear and the per-frame errors are correlated, so Lambda^-1 over-
        # shrinks. The honest reported covariance is the spread of the FUSED estimate under
        # resampled input noise (jitter per frame, bias ONCE per realization - the common-mode
        # rule). This naturally carries both the non-Gaussian tail AND the non-shrinking bias.
        cov_report, mc_cloud = self._mc_fused_cov(observations, origin, x_hat)

        # --- NIS residual-consistency test (moving target / model mismatch) ---
        nis, moving = self._nis(pts, cvs, x_hat)
        if moving:
            # Stay honest: use the empirical scatter (it reflects the spread the static model
            # cannot explain), inflated above the over-optimistic information ellipse.
            cov_report = self._empirical_scatter(pts, x_hat) + cov_report
            mc_cloud = None  # the cloud no longer describes the (inflated) reported spread

        # --- derived reporting quantities ---
        r95_prefloor = self._r95_from_cov(cov_info)
        # R95 = the EMPIRICAL 95th-pct sample radius about x_hat (the honest equal-coverage
        # circle, §4), NOT the major semi-axis. Measuring about x_hat (the reported coord, the
        # weighted mean) - not the cloud's own unweighted mean - folds the weighted-vs-unweighted
        # offset into the radius. Falls back to the covariance form only when the cloud is
        # unavailable (moving-target inflation path).
        r95 = self._empirical_r95(mc_cloud, x_hat) if mc_cloud is not None else self._r95_from_cov(
            cov_report
        )
        major, minor, orient = self._ellipse(cov_report)
        heading_limited = aspect_spread < _ASPECT_RELAXED_DEG
        cls = self._actionability(r95, heading_limited, moving)
        convergence = (
            ConvergenceState.CONVERGING if moving else self._convergence(r95)
        )

        coord = _enu_to_latlon(origin, x_hat)
        return FusedEstimate(
            coord=coord,
            r95_m=r95,
            r95_prefloor_m=r95_prefloor,
            cov_report=cov_report,
            semi_major_m=major,
            semi_minor_m=minor,
            orientation_deg=orient,
            actionability_class=cls,
            convergence=convergence,
            heading_limited=heading_limited,
            aspect_spread_deg=aspect_spread,
            moving_suspected=moving,
            n_fused=len(pts),
            n_rejected=n_rejected,
            nis=nis,
        )

    # --- per-frame projection + linearized covariance -------------------------------

    def _project_all(
