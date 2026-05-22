"""FileFrameSource — decode a recorded video file into `Frame`s via PyAV.

The replay path for v1: recorded drone footage in, `Frame(frame, timestamp, seq)`
out. Software decode by default; VideoToolbox HW decode is requested only when the
clip is large enough to satisfy its minimum-dimension constraints (it rejects tiny
inputs), with software fallback. Dimensions are read per frame (no caching) so a
mid-stream resolution change flows through (Task 1.3). A frame that raises a libav
decode error is skipped, not propagated (tolerate corrupt frames / link loss).
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import av
import numpy as np

from hades.ingest.frame_source import Frame, FrameSource

# VideoToolbox rejects small frames; only attempt HW decode at/above this size.
# Below it (fixtures, thumbnails) software decode is used directly.
_HW_MIN_DIM = 240


class FileFrameSource(FrameSource):
    """Yields `Frame`s decoded from a recorded video file.

    Args:
        path: video file to decode.
        hwaccel: if True, attempt VideoToolbox HW decode for large clips
            (with software fallback). Default True; harmless on small fixtures
            because the size gate keeps them on the software path.
    """

    def __init__(self, path: str | Path, hwaccel: bool = True):
        self.path = Path(path)
        self.hwaccel = hwaccel

    def _open(self) -> av.container.InputContainer:
        try:
            container = self._open_container()
        except av.FFmpegError as exc:
            raise ValueError(f"not a decodable video file: {self.path} ({exc})") from exc
        if not container.streams.video:
            container.close()
            raise ValueError(f"no video stream in {self.path}")
        return container

    def _open_container(self) -> av.container.InputContainer:
        if self.hwaccel:
            try:
                from av.codec.hwaccel import HWAccel, hwdevices_available
