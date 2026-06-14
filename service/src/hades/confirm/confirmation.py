"""Confirmation rule + world-clustering (Task 3.6).

Promotes each track's DISPLAY-PRIORITY TIER (contact → candidate → strong) from
persistence + accumulated confidence + world-location clustering. It NEVER gates
visibility: any detected track is at least a CONTACT. Promotion to STRONG is what makes a
contact eligible for the expensive Localizer (Phase 4) and, ultimately, dispatch — so a
false STRONG is the cardinal sin and the design is hardened against flicker accordingly.

Design (hardened by adversarial red-team — see the test module docstring):

- **Promotion driver = a leaky-integrator decay score**, not a raw N-of-M count. Every
  frame `score *= decay`; on a hit `score += conf`. Sparse/periodic flicker engineered to
  hit exactly N-of-M is starved by the decay between bursts (the resonant-aliasing attack
  a pure count cannot reject). A human-legible `hits in last M` is kept as a floor/UI
  number, not the driver.

- **Schmitt hysteresis**: promote at `θ_up`, demote only below `θ_down < θ_up`, and the
  decay coast carries a STRONG contact through a short occlusion. A demote never deletes
  the contact (recall-first applies on the way down too).

- **World-cluster corroboration counts ONE centroid vote per track** (never per-frame
  points — that is fake self-corroboration), and DROPS duplicate detector firings (two
  track IDs whose boxes co-occur with high IoU are one source, not two corroborators). Two
  *distinct, de-duplicated* tracks whose centroids fall within a range-scaled radius
  corroborate — the ego-motion-fragmented-survivor win. Only gate-PASSING points vote.

KNOWN LIMITATION (documented, not handled): this is a temporal/spatial CONSISTENCY filter,
not a semantic classifier. A reliably-detected non-person (AC unit, sun glint) produces a
stable, persistent, tight track and WILL reach STRONG — possibly more confidently than a
marginal real survivor. Mitigation is upstream (detector precision) and downstream
(mandatory operator confirmation before dispatch). STRONG means "worth a human look,"
never autonomous dispatch.
"""

from __future__ import annotations

import math
from collections import deque
from dataclasses import dataclass, field
from enum import IntEnum

from hades.locate.frame_gate import GateVerdict
from hades.locate.projector import GroundPoint

_METERS_PER_DEG = 111320.0


class Tier(IntEnum):
    """Display-priority tier. Ordered (IntEnum) so promote/demote comparisons read simply."""

    CONTACT = 0  # ≥1 detection; always visible (recall-first)
    CANDIDATE = 1  # persistence/confidence over the candidate threshold
    STRONG = 2  # very-persistent high-conf OR world-cluster corroborated


@dataclass
class _TrackState:
    """Per-track sliding-window state. The public output is just the tier."""

    window: deque = field(default_factory=lambda: deque(maxlen=_WINDOW_M))
    score: float = 0.0  # leaky-integrator decay score (the promotion driver)
    tier: Tier = Tier.CONTACT
    operator_locked: bool = False
    last_seen_frame: int = 0  # frame index of the most recent hit (for eviction)
    # Per-frame record kept for cluster de-dup: (lat, lon, conf, verdict, box, seen_frame).
    points: list = field(default_factory=list)

    def centroid(self) -> tuple[float, float] | None:
        """Confidence-weighted mean of this track's gate-PASSING points (one cluster vote).

        None when the track has no fusable point — it then casts no corroboration vote
        (but stays visible). Mean (not median) keeps it numpy-free and cheap; jitter
        averages out, which is the intended within-track smoothing.
        """
        passing = [
            (lat, lon, conf)
            for (lat, lon, conf, verdict, _box, _f) in self.points
            if verdict is not GateVerdict.REJECT and lat is not None
        ]
        if not passing:
            return None
        wsum = sum(c for _, _, c in passing)
        if wsum <= 0:
            return None
        lat = sum(lat * c for lat, _, c in passing) / wsum
        lon = sum(lon * c for _, lon, c in passing) / wsum
        return lat, lon


# --- tunable constants (module-level, not a config object — solo-maintainer simplicity) --
_WINDOW_M = 30  # sliding window length (frames) ≈ 3 s at 10 fps detection cadence
_DECAY = 0.9  # leaky-integrator decay per frame; gaps multiply this, starving flicker
# Schmitt thresholds on the decay score (up > down so tiers don't flap at the boundary).
_CAND_UP, _CAND_DOWN = 1.5, 0.8
_STRONG_UP, _STRONG_DOWN = 4.5, 2.5
_SOLO_STRONG = 6.5  # a lone very-persistent high-conf track reaches strong without a cluster
# World-cluster corroboration radius grows with slant range (scatter grows with range /
# obliquity; a fixed radius mis-handles one regime). R = base + k·range, in meters. The
# disk-overlap-of-uncertainty upgrade is deferred to Phase 4 where per-track σ exists.
_CLUSTER_R_BASE_M = 8.0
_CLUSTER_R_PER_RANGE = 0.05  # +5 m radius per 100 m of slant range
_SLANT_RANGE_CEIL_M = 5000.0  # clamp a pathological slant_range so the radius can't explode
_DUP_IOU = 0.5  # boxes co-occurring above this IoU = one detector source, de-duplicated
_DUP_WORLD_M = 10.0  # ...AND centroids within this — else they are distinct close survivors
_EVICT_AFTER = 2 * _WINDOW_M  # frames silent before a dead track is evicted (no ghosts/leak)


def _iou(a: tuple, b: tuple) -> float:
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    iw = max(0.0, min(ax2, bx2) - max(ax1, bx1))
    ih = max(0.0, min(ay2, by2) - max(ay1, by1))
    inter = iw * ih
    union = (ax2 - ax1) * (ay2 - ay1) + (bx2 - bx1) * (by2 - by1) - inter
    return inter / union if union > 0 else 0.0


def _ground_dist_m(p: tuple[float, float], q: tuple[float, float]) -> float:
    """Flat-earth meters between two (lat, lon) — small-angle, matches the geometry §3.1."""
    dlat = (p[0] - q[0]) * _METERS_PER_DEG
    dlon = (p[1] - q[1]) * _METERS_PER_DEG * math.cos(math.radians(p[0]))
    return math.hypot(dlat, dlon)


class Confirmation:
    """Stateful confirmation rule. `update` once per frame returns {track_id: Tier}."""

    def __init__(self) -> None:
        self._tracks: dict[int, _TrackState] = {}
        self._frame = 0
        self._last_vote_count = 0
        # Persistent record of track-id pairs proven to be ONE detector source (they
        # co-occurred with overlapping boxes at the same world point). Kept beyond the
        # sliding window so de-dup does not "forget" and let a duplicate fake-corroborate
        # once the co-occurrence frames age out (review H2). Symmetric set of frozensets.
        self._duplicate_pairs: set[frozenset[int]] = set()

    def update(
        self, ground_points: dict[int, GroundPoint], *, slant_range: float = 100.0
    ) -> dict[int, Tier]:
        """Advance one frame. `ground_points` maps track_id → its GroundPoint this frame
        (absent track_ids are misses). `slant_range` (m) scales the cluster radius."""
        self._frame += 1
        seen = set(ground_points)

        # 1. Decay every known track; add this frame's hit (conf) to seen ones.
        for tid, st in self._tracks.items():
            st.score *= _DECAY
            hit = tid in seen
            st.window.append(hit)
            if hit:
                gp = ground_points[tid]
                st.score += gp.conf
                st.last_seen_frame = self._frame
                st.points.append(
                    (gp.lat, gp.lon, gp.conf, gp.verdict, gp.detection.box_xyxy, self._frame)
                )
                self._prune(st)

        # 2. Initiate states for newly-seen tracks.
        for tid in seen:
            if tid not in self._tracks:
                st = _TrackState()
                gp = ground_points[tid]
                st.score += gp.conf
                st.window.append(True)
                st.last_seen_frame = self._frame
                st.points.append(
                    (gp.lat, gp.lon, gp.conf, gp.verdict, gp.detection.box_xyxy, self._frame)
                )
                self._tracks[tid] = st

        # 3. Record duplicate-source pairs seen THIS frame (persists beyond the window).
        self._record_duplicates(seen)
