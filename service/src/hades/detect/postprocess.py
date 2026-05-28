"""Shared YOLO output decode + NMS — the SINGLE place raw output becomes `Detection`s.

The exported model has `nms=False` (bench/export_coreml.py), so the raw output is
`(1, 4 + n_classes, n_anchors)` — rows 0–3 are box `(cx, cy, w, h)` in *letterbox*
pixels, rows `4..` are per-class scores (no objectness in YOLO11). v1 is single-class:
only **person == COCO class 0 == row 4** is kept.

Both the Core ML and ONNX backends import THIS module — the decode is never
re-implemented per backend (mirrors the plan's single-source-of-truth rule for the
ray→ground math). Boxes are mapped back to original-frame pixels via the `Letterbox`
metadata before they leave, so a coordinate never escapes in letterboxed space
(DESIGN.md §3.2).
"""

from __future__ import annotations

import numpy as np

from .detector import Detection
from .preprocess import Letterbox

#: Class index of `person` in the model's output rows (row `4 + this`). It is 0 for the
#: stock COCO export. NOTE (P2.5): the fine-tuned single-`person`-class model MUST also
#: place person at index 0, or this reads the wrong score row — assert it at export time.
PERSON_CLASS_INDEX = 0


def decode_yolo(
    raw: np.ndarray,
    lb: Letterbox,
    *,
    conf_threshold: float = 0.25,
    iou_threshold: float = 0.7,
) -> list[Detection]:
    """Decode raw YOLO output `(1, 4+C, A)` to person `Detection`s in original pixels.

    Steps: select the person-class row, threshold, convert `(cx,cy,w,h)`→`xyxy` in
    letterbox space, un-letterbox to original pixels, then NMS. Returns `[]` when no
    anchor clears the threshold (an empty scene is normal, not an error).

    Orientation guard (review C1): the channel axis (`4+C`, ~84) is far smaller than the
    anchor axis (`A`, ~8400). A transposed export `(1, A, 4+C)` would pass a naive
    `shape[0]==1` check and then `pred[4]` would silently read anchor #4's vector instead
    of the person-score row — yielding an EMPTY map over a scene full of survivors. We
    refuse the wrong orientation loudly rather than index into it.
    """
    if raw.ndim != 3 or raw.shape[0] != 1:
        raise ValueError(f"expected raw shape (1, 4+C, A), got {raw.shape}")
    channels, anchors = raw.shape[1], raw.shape[2]
    if channels <= 4 + PERSON_CLASS_INDEX or channels >= anchors:
        # The detection head is channel-major: a small box+class axis, a large anchor
        # axis. `channels >= anchors` means a transposed/garbage layout — reject it.
        raise ValueError(
            f"raw must be channel-major (1, 4+C, A) with 4+C < A; got "
            f"(1, {channels}, {anchors}) — looks transposed or malformed"
        )

    pred = raw[0]  # (4+C, A)
    person_scores = pred[4 + PERSON_CLASS_INDEX]  # (A,)
