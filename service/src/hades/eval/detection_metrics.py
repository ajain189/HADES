"""Detection metrics — center-distance matching, P/R, size- and subclass-stratified recall.

The acceptance-gate metric (design lines 90–100):

- **Match by center-distance**, not IoU@0.5: a survivor box is a handful of pixels, so
  IoU is dominated by 1–2px jitter and would reject correct detections. A prediction
  matches a ground-truth box when their centers are within `max_distance` pixels.
- **Precision / recall** from the one-to-one matching (greedy by ascending distance, each
  GT consumed once). Recall is `None` when there is no GT (undefined, not 0).
- **Size-stratified recall** (`recall_by_size`): bucket GT by box area to expose the
  small-target recall cliff (the design's core difficulty).
- **Per-subclass recall** (`recall_by_subclass`): the real acceptance floor, keyed off the
  hard-subclass labels (in-water/head-only, rooftop-prone, debris-occluded, in-vehicle).

Pure geometry over `Detection` (predictions) and `GroundTruth` (labels); no model here, so
it runs deterministically on CI. `box_xyxy` is original-frame pixels (DESIGN.md §3.2).
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass


@dataclass(frozen=True)
class GroundTruth:
    """One labeled survivor box. `subclass` is the hard-subclass tag (or None)."""

    box_xyxy: tuple[float, float, float, float]
    subclass: str | None = None

    def __post_init__(self) -> None:
        x_min, y_min, x_max, y_max = self.box_xyxy
        # A malformed/inverted label silently yields a bogus center+area and can vanish
        # from size buckets, corrupting stratified metrics (Codex P2). Reject it on load.
        if x_max <= x_min or y_max <= y_min:
            raise ValueError(
                f"GroundTruth box_xyxy must be ordered with positive area: {self.box_xyxy}"
            )

    @property
    def center(self) -> tuple[float, float]:
        x_min, y_min, x_max, y_max = self.box_xyxy
        return (x_min + x_max) / 2.0, (y_min + y_max) / 2.0

    @property
    def area(self) -> float:
        x_min, y_min, x_max, y_max = self.box_xyxy
        return (x_max - x_min) * (y_max - y_min)


@dataclass(frozen=True)
class Match:
    """A prediction↔ground-truth pairing and the center distance that joined them."""

    pred_index: int
    gt_index: int
    distance: float


@dataclass(frozen=True)
class FrameScore:
    """TP/FP/FN counts and derived precision/recall for a matched frame (or set)."""

    true_positives: int
    false_positives: int
    false_negatives: int

    @property
    def precision(self) -> float | None:
        denom = self.true_positives + self.false_positives
        return None if denom == 0 else self.true_positives / denom

    @property
    def recall(self) -> float | None:
        denom = self.true_positives + self.false_negatives
        return None if denom == 0 else self.true_positives / denom


def _center(box: tuple[float, float, float, float]) -> tuple[float, float]:
    x_min, y_min, x_max, y_max = box
    return (x_min + x_max) / 2.0, (y_min + y_max) / 2.0


def match_by_center_distance(
    predictions: Sequence,
    ground_truths: Sequence[GroundTruth],
    *,
    max_distance: float,
) -> list[Match]:
    """Match predictions to GT by center distance — **maximum cardinality, min total dist**.

    A prediction may pair with any GT whose center is within `max_distance`. The result
    is a maximum-cardinality bipartite matching (so TP — and hence precision/recall — is
    never under-reported): greedy-nearest would strand a matchable pair in clustered
    survivor scenes (review I2) — preds@{4,6}, GTs@{0,5}, thr=5 — greedy takes 6↔5 and
    orphans both 4 and 0 (TP=1); the optimal matches both (TP=2).

    Among all maximum matchings it then minimizes total pair distance via distance-
    reducing swaps, so a contested GT goes to the *nearer* prediction (the real
    detection) and the farther one is the FP. Result is deterministic.
    """
    # adj[pi] = GT indices within threshold, ordered nearest-first.
    adj: list[list[int]] = []
    dist_of: dict[tuple[int, int], float] = {}
    for pi, p in enumerate(predictions):
        px, py = _center(p.box_xyxy)
        near: list[tuple[float, int]] = []
        for gi, g in enumerate(ground_truths):
            gx, gy = g.center
            dist = ((px - gx) ** 2 + (py - gy) ** 2) ** 0.5
            if dist <= max_distance:
                near.append((dist, gi))
                dist_of[(pi, gi)] = dist
        near.sort(key=lambda c: c[0])
        adj.append([gi for _, gi in near])

    gt_to_pred: dict[int, int] = {}  # gt index -> matched pred index

    def _augment(pi: int, seen: set[int]) -> bool:
        for gi in adj[pi]:
            if gi in seen:
                continue
            seen.add(gi)
            if gi not in gt_to_pred or _augment(gt_to_pred[gi], seen):
                gt_to_pred[gi] = pi
                return True
        return False

    for pi in range(len(predictions)):
        _augment(pi, set())

    _minimize_total_distance(gt_to_pred, adj, dist_of)

    matches = [
        Match(pred_index=pi, gt_index=gi, distance=dist_of[(pi, gi)])
        for gi, pi in gt_to_pred.items()
    ]
    matches.sort(key=lambda m: m.pred_index)
    return matches


def _minimize_total_distance(
    gt_to_pred: dict[int, int],
    adj: list[list[int]],
    dist_of: dict[tuple[int, int], float],
) -> None:
    """Cardinality-preserving local search that reduces total matched distance.

