"""WebSocket message contracts (pydantic → JSON Schema) — the cross-process boundary.

Two localhost channels, aligned by `frame_id` (== the FrameSource `seq`): a binary
channel of JPEG frames and this JSON channel. `DetectionMessage` is the Phase-2 JSON
payload — the per-frame boxes the UI overlays. `ContactRecord` (the taskable localized
record) is added in Phase 4 on the same channel.

These models ARE the schema: validation happens at the process boundary so a malformed
message fails loudly here instead of flowing downstream as a wrong coordinate (the
DESIGN.md §3.2 bug class). Boxes are `box_xyxy` in **original-frame pixels**, `(x_min,
y_min, x_max, y_max)`, confidence in `[0, 1]` — same convention as `detect.Detection`.
The pydantic models export to JSON Schema (`model_json_schema()`) for the UI side.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

if TYPE_CHECKING:
    from collections.abc import Sequence

    from hades.detect.detector import Detection
    from hades.locate.fuse import ConvergenceState


class BoxMessage(BaseModel):
    """One detected box on the wire — mirrors `detect.Detection` (DESIGN.md §3.2)."""

    model_config = ConfigDict(frozen=True)

    box_xyxy: tuple[float, float, float, float]
    conf: float = Field(ge=0.0, le=1.0)
    cls: str = "person"

    @model_validator(mode="after")
    def _check_box_ordered(self) -> BoxMessage:
        x_min, y_min, x_max, y_max = self.box_xyxy
        if x_max <= x_min or y_max <= y_min:
            raise ValueError(
                f"box_xyxy must be ordered with positive area "
                f"(x_min<x_max, y_min<y_max): {self.box_xyxy}"
            )
        return self


class DetectionMessage(BaseModel):
    """Per-frame detections on the JSON channel, aligned to video by `frame_id`."""

    model_config = ConfigDict(frozen=True)

    type: Literal["detection"] = "detection"
    frame_id: int = Field(ge=0, description="FrameSource seq this message belongs to")
    timestamp: float = Field(description="frame presentation time in seconds")
    boxes: list[BoxMessage] = Field(default_factory=list)

    @classmethod
    def from_detections(
        cls,
        *,
        frame_id: int,
        timestamp: float,
        detections: Sequence[Detection],
    ) -> DetectionMessage:
        """Build a message from the detector's `Detection`s (the emit-side adapter)."""
        return cls(
            frame_id=frame_id,
            timestamp=timestamp,
            boxes=[
                BoxMessage(box_xyxy=d.box_xyxy, conf=d.conf, cls=d.cls) for d in detections
            ],
        )


class ContactRecord(BaseModel):
    """A taskable, localized contact on the JSON channel (Task 4.6; research gate §9).

    The MINIMUM honest field set the localizer can populate today. `frame_id`-aligned to video
    like `DetectionMessage`. `detection_conf` and `localization_conf` are SEPARATE axes: a
    contact can be confidently DETECTED yet poorly LOCALIZED (heading-limited) - that
    separation is what stops the smug-filter lie from reaching the operator. `r95_m` is the
    honest equal-coverage sweep radius (the empirical MC quantile, NOT the major semi-axis);
    the ellipse (semi-axes + orientation) is the expert overlay.
