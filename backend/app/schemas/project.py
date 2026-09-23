from datetime import datetime
from typing import Literal

from pydantic import Field, field_validator

from app.pipeline.config import ProjectConfig
from app.schemas.common import ApiInput, ApiModel, clean_text


def _clean_name(v: str | None) -> str | None:
    if v is None:
        return v
    v = clean_text(v, field="Name", max_len=120)
    if not v:
        raise ValueError("Name must not be empty")
    return v


def _clean_description(v: str | None) -> str | None:
    return None if v is None else clean_text(v, field="Description", max_len=2000, allow_newlines=True)


class ProjectCreate(ApiInput):
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=4000)

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        return _clean_name(v)

    @field_validator("description")
    @classmethod
    def _desc(cls, v: str) -> str:
        return _clean_description(v)


class ProjectUpdate(ApiInput):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=4000)
    config: ProjectConfig | None = None

    @field_validator("name")
    @classmethod
    def _name(cls, v: str | None) -> str | None:
        return _clean_name(v)

    @field_validator("description")
    @classmethod
    def _desc(cls, v: str | None) -> str | None:
        return _clean_description(v)


class StageOut(ApiModel):
    id: str
    label: str
    status: str
    progress: float
    duration_ms: float | None = None
    message: str | None = None
    warnings: list[str] = []
    error: dict | None = None


class RunOut(ApiModel):
    id: str
    status: str
    from_stage: str
    stages: list[StageOut]
    error: dict | None = None
    created_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None


class ProjectOut(ApiModel):
    id: str
    name: str
    description: str
    config: ProjectConfig
    created_at: datetime
    updated_at: datetime
    camera_count: int
    frame_count: int
    has_scene: bool
    scene_stale: bool
    last_run: RunOut | None = None


class RunRequest(ApiInput):
    from_stage: Literal["input", "object_detection", "tracking", "scene_understanding"] = "input"
