r"""SrtFileSource — parse a DJI O4 `.srt` telemetry sidecar into `Pose`s.

The high-rate validation replay path. Each SubRip block is one video frame
(`FrameCnt`), carrying lat/lon/rel_alt/abs_alt but **no attitude** (DESIGN.md §3.5).
Parser policy (hardened against real DJI variation):

- Tolerant `[key: value]` token extraction (`\s*` around the colon), so field-order
  and modern/legacy spacing variation is absorbed; the combined
  `[rel_alt: X abs_alt: Y]` two-keys-one-bracket form is handled.
- `alt` is sourced from the trustworthy `rel_alt`, tagged `REL_TAKEOFF`. `abs_alt`
  is parsed as advisory metadata and flagged `abs_alt_valid=False` when implausible
  (the field glitches on O-series firmware).
- A block with no GPS fix yields a ``Pose`` flagged ``gps_valid=False`` (lat/lon ``None``) —
  never dropped (would shift frame alignment) and never plotted as 0,0.
- ``seq = FrameCnt - 1`` makes the 1-based -> 0-based conversion explicit (aligns to
  ``Frame.seq``).
- An empty/zero-telemetry sidecar raises — running the validation path blind is unsafe.
"""

from __future__ import annotations

import re
from collections.abc import Iterator
from pathlib import Path

from hades.ingest.telemetry_source import Pose, TelemetrySource

# A signed decimal, optionally in scientific notation.
_NUM = r"[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?"
# Plausible absolute-altitude envelope (meters); outside -> abs_alt flagged invalid.
# The floor is just-below-sea-level: a negative abs_alt is the documented DJI FPV
# firmware glitch signature (nonzero-ground / 1/10-scaling bugs), not a real altitude
# over coastal SAR terrain. The fixture plants -32.309 to exercise this path.
_ABS_ALT_MIN, _ABS_ALT_MAX = -5.0, 10_000.0


def _find(pattern: str, text: str) -> str | None:
    m = re.search(pattern, text)
    return m.group(1) if m else None


def _to_float(s: str | None) -> float | None:
    if s is None:
        return None
    try:
        v = float(s)
    except ValueError:
        return None
    # NaN/inf must never reach the georeference math.
    if v != v or v in (float("inf"), float("-inf")):
        return None
    return v


class SrtFileSource(TelemetrySource):
    """Replays a DJI O4 `.srt` sidecar as `Pose` samples."""

    def __init__(self, path: str | Path):
        self.path = Path(path)

    def __iter__(self) -> Iterator[Pose]:
