from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Protocol

import numpy as np

from app.detection.base import Detection2D
from app.detection.multiview import Detection3D
from app.pipeline.config import ProjectConfig
from app.reconstruction.bundle_adjustment import BAReport
from app.reconstruction.dense import DepthResult
from app.reconstruction.sfm import SparseResult, View
from app.scene.relations import Relation
from app.tracking.tracker import Track
from app.vision.camera_model import Intrinsics, Pose
from app.vision.features import MatchResult

DetectionProvider = Callable[[str, int, np.ndarray], list[Detection2D]]


@dataclass
class CameraSource:
    id: str
    label: str
    name: str
    width: int
    height: int
    frame_count: int
    fps: float | None
    calibration: dict | None  # {"method", "intrinsics", "reprojectionErrorPx"}
    load_frame: Callable[[int], np.ndarray]  # returns RGB uint8
    frame_url: str  # URL template containing "{index}"


@dataclass
class PipelineInput:
    project_id: str
    cameras: list[CameraSource]
    config: ProjectConfig
    detection_provider: DetectionProvider | None = None
    detection_source: str = "none"
    image_source: str = "uploaded"
    source: str = "pipeline"
    regions: list[dict] = field(default_factory=list)


class Reporter(Protocol):
    def stage_started(self, stage: str) -> None: ...
    def stage_progress(self, stage: str, fraction: float, message: str | None = None) -> None: ...
    def stage_finished(
        self, stage: str, status: str, message: str, warnings: list[str], duration_ms: float, error: dict | None = None
    ) -> None: ...
    def check_cancelled(self) -> None: ...


@dataclass
class CameraState:
    source: CameraSource
    intr_native: Intrinsics
    intr: Intrinsics  # at processing resolution
    calibration_method: str
    calibration_error: float | None
    image_rgb: np.ndarray | None = None
    image_gray: np.ndarray | None = None
    pose: Pose | None = None
    registration_note: str | None = None


@dataclass
class FrameObjects:
    index: int
    t: float
    objects: list[Detection3D]
    raw: dict[str, list[Detection2D]]
    track_ids: list[int | None] = field(default_factory=list)


@dataclass
class PipelineState:
    cameras: list[CameraState] = field(default_factory=list)
    views: list[View] = field(default_factory=list)
    matches: dict[tuple[int, int], MatchResult] = field(default_factory=dict)
    sparse: SparseResult | None = None
    sparse_points: np.ndarray | None = None  # aligned world frame
    sparse_colors: np.ndarray | None = None
    ground_aligned: bool = False
    units: str = "relative"
    depth: list[DepthResult] = field(default_factory=list)
    dense_points: np.ndarray | None = None
    dense_colors: np.ndarray | None = None
    ba_reports: list[BAReport] = field(default_factory=list)
    timestamps: list[tuple[int, float]] = field(default_factory=list)
    frames: list[FrameObjects] = field(default_factory=list)
    tracks: list[Track] = field(default_factory=list)
    relations: list[Relation] = field(default_factory=list)
    viewpoint_camera: str | None = None
    warnings: list[str] = field(default_factory=list)
    stage_records: dict[str, dict] = field(default_factory=dict)
    loaded_scene: dict | None = None  # when restarting from a later stage

    def registered(self) -> list[CameraState]:
        return [c for c in self.cameras if c.pose is not None]
