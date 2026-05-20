"""FrameSource interface and a synthetic implementation.

A `FrameSource` is an iterable of `Frame`s — one responsibility: yield
`(frame, timestamp, seq)`. It knows nothing about detection or telemetry
(DESIGN.md §1). `seq` is the monotonic per-frame id used downstream to align
telemetry (the `frame_id` in CLAUDE.md).

Image convention (DESIGN.md §3.2): frames are HxWx3 uint8 in RGB, origin
top-left, +x right / +y down.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Iterator
from dataclasses import dataclass

import numpy as np


# eq=False -> identity eq/hash; a value-eq on the ndarray field would raise the
# ambiguous-truth ValueError and break hashing (frames are never value-compared).
@dataclass(frozen=True, eq=False)
class Frame:
    """One decoded frame.

    Attributes:
        frame: HxWx3 uint8 RGB image (DESIGN.md §3.2 axis convention).
        timestamp: presentation time in seconds (monotonic within a source).
        seq: monotonic frame id from 0; the key telemetry is aligned on.
    """

    frame: np.ndarray
