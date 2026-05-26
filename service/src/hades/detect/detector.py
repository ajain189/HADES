"""Detector interface and the `Detection` value object.

A `Detector` is a **stateless** `frame -> list[Detection]` (DESIGN.md §1): it
knows nothing about time, tracks, or survivors — just boxes in one image. The
Core ML weights behind it are swappable; the interface is not. Tracking,
confirmation, and localization are downstream and stateful.

`Detection` is the cross-module box contract. Per DESIGN.md §3.2:

- `box_xyxy = (x_min, y_min, x_max, y_max)` is in **pixels of the original
  (pre-letterbox) frame**. Any letterbox/scale applied for inference is undone
  *inside* the detector before a pixel leaves it — a coordinate that escapes in
  letterboxed space is the named §3.2 footgun.
- Image axes are origin top-left, **+x right / +y down** (OpenCV convention).
- `cls` is `"person"` — v1 is single-class (CLAUDE.md detection line); the field
  exists so the contract is explicit, not so the system is multi-class.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class Detection:
    """One detected box in original-frame pixels (DESIGN.md §3.2).

    Attributes:
        box_xyxy: (x_min, y_min, x_max, y_max) pixels, pre-letterbox frame.
        conf: detection confidence in [0, 1].
        cls: object class; always "person" in v1 (single-class).
    """

    box_xyxy: tuple[float, float, float, float]
    conf: float
    cls: str = "person"

