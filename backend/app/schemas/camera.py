from datetime import datetime
from typing import Literal

from pydantic import Field, field_validator, model_validator

from app.schemas.common import ApiInput, ApiModel, clean_text


def _clean_name(v: str | None) -> str | None:
    if v is None:
        return v
    v = clean_text(v, field="Camera name", max_len=60)
    if not v:
        raise ValueError("Camera name must not be empty")
    return v


class CameraCreate(ApiInput):
    name: str | None = Field(default=None, max_length=120)

    @field_validator("name")
    @classmethod
    def _name(cls, v: str | None) -> str | None:
        return _clean_name(v)


class CameraUpdate(ApiInput):
    name: str = Field(max_length=120)

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        return _clean_name(v)


class CameraOut(ApiModel):
    id: str
    project_id: str
    label: str
    name: str
    source_kind: str | None
    width: int | None
    height: int | None
    fps: float | None
    frame_count: int
    status: Literal["empty", "ready"]
    calibration: dict | None
    created_at: datetime


class UploadResult(ApiModel):
    camera: CameraOut
    added: int
    skipped: list[dict] = []


class CalibrationRequest(ApiInput):
    method: Literal["assumed", "manual", "checkerboard"]
    fx: float | None = Field(default=None, gt=0, le=1e5)
    fy: float | None = Field(default=None, gt=0, le=1e5)
    cx: float | None = Field(default=None, gt=0, le=1e5)
    cy: float | None = Field(default=None, gt=0, le=1e5)
    dist: list[float] = Field(default_factory=lambda: [0.0, 0.0, 0.0, 0.0, 0.0], max_length=8)
    pattern_cols: int | None = Field(default=None, ge=3, le=30)
    pattern_rows: int | None = Field(default=None, ge=3, le=30)
    square_size_m: float | None = Field(default=None, gt=0, le=1)
    max_frames: int = Field(default=40, ge=3, le=200)

    @model_validator(mode="after")
    def _required_for_method(self):
        if self.method == "manual" and None in (self.fx, self.fy, self.cx, self.cy):
            raise ValueError("Manual calibration requires fx, fy, cx and cy")
        if self.method == "checkerboard" and None in (self.pattern_cols, self.pattern_rows, self.square_size_m):
            raise ValueError("Checkerboard calibration requires patternCols, patternRows and squareSizeM")
        return self


class MatchRequest(ApiInput):
    camera_a: str = Field(max_length=32)
    camera_b: str = Field(max_length=32)
    frame_index: int = Field(default=0, ge=0)
    detector: Literal["sift", "orb", "akaze"] = "sift"
    ratio: float = Field(default=0.75, ge=0.5, le=0.95)
    max_features: int = Field(default=4000, ge=200, le=20000)

    @model_validator(mode="after")
    def _distinct(self):
        if self.camera_a == self.camera_b:
            raise ValueError("Choose two different cameras")
        return self
