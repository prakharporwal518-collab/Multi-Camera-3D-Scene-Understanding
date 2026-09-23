from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")


class DepthConfig(CamelModel):
    num_planes: int = Field(default=128, ge=16, le=256)
    window: int = Field(default=9, ge=3, le=21)
    working_width: int = Field(default=640, ge=256, le=1920)
    min_score: float = Field(default=0.6, ge=0.1, le=0.95)


class ProjectConfig(CamelModel):
    """Processing parameters stored per project. Ranges are enforced on every update."""

    detector: Literal["sift", "orb", "akaze"] = "sift"
    max_features: int = Field(default=6000, ge=500, le=20000)
    match_ratio: float = Field(default=0.75, ge=0.5, le=0.95)
    reference_frame: int = Field(default=0, ge=0)
    # Measured distance between the first two cameras; gives the reconstruction metric scale.
    baseline_meters: float | None = Field(default=None, gt=0, le=1000)
    max_timesteps: int = Field(default=20, ge=1, le=120)
    timestep_stride: int = Field(default=1, ge=1, le=100)
    near_distance: float = Field(default=2.0, gt=0, le=50)
    voxel_size: float = Field(default=0.04, gt=0, le=1.0)
    depth: DepthConfig = Field(default_factory=DepthConfig)


STAGES: list[tuple[str, str]] = [
    ("input", "Input"),
    ("preprocessing", "Preprocessing"),
    ("calibration", "Calibration"),
    ("feature_extraction", "Feature extraction"),
    ("feature_matching", "Feature matching"),
    ("pose_estimation", "Pose estimation"),
    ("depth_estimation", "Depth estimation"),
    ("reconstruction", "3D reconstruction"),
    ("object_detection", "Object detection"),
    ("tracking", "Tracking"),
    ("scene_understanding", "Scene understanding"),
]
STAGE_IDS = [s for s, _ in STAGES]
