"""Database operations for projects and cameras, plus DB -> API conversions."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import ConflictError, NotFoundError, ValidationFailed
from app.database.models import Camera, PipelineRun, Project
from app.pipeline.config import ProjectConfig
from app.pipeline.runner import empty_stage_records
from app.schemas.camera import CameraOut
from app.schemas.project import ProjectOut, RunOut
from app.services import storage

ACTIVE_RUN_STATES = ("queued", "running")


def get_project(db: Session, project_id: str) -> Project:
    project = db.get(Project, project_id)
    if project is None:
        raise NotFoundError("Project not found.", hint="It may have been deleted.", details={"projectId": project_id[:32]})
    return project


def get_camera(db: Session, camera_id: str) -> Camera:
    camera = db.get(Camera, camera_id)
    if camera is None:
        raise NotFoundError("Camera not found.", details={"cameraId": camera_id[:32]})
    return camera


def project_config(project: Project) -> ProjectConfig:
    return ProjectConfig.model_validate(project.config or {})


def latest_run(project: Project) -> PipelineRun | None:
    return project.runs[-1] if project.runs else None


def active_run(project: Project) -> PipelineRun | None:
    run = latest_run(project)
    return run if run and run.status in ACTIVE_RUN_STATES else None


def ensure_idle(project: Project, action: str) -> None:
    if active_run(project):
        raise ConflictError(
            f"Cannot {action} while the pipeline is running.",
            hint="Wait for the current run to finish or cancel it.",
        )


def bump_version(project: Project) -> None:
    project.data_version = (project.data_version or 1) + 1


def scene_version(project_id: str) -> int | None:
    doc = storage.read_json(storage.result_file(project_id, "scene.json"))
    return None if doc is None else doc.get("dataVersion")


def run_out(run: PipelineRun) -> RunOut:
    stages = run.stages or empty_stage_records()
    return RunOut.model_validate(
        {
            "id": run.id,
            "status": run.status,
            "from_stage": run.from_stage,
            "stages": stages,
            "error": run.error,
            "created_at": run.created_at,
            "started_at": run.started_at,
            "finished_at": run.finished_at,
        }
    )


def project_out(project: Project) -> ProjectOut:
    version = scene_version(project.id)
    run = latest_run(project)
    return ProjectOut.model_validate(
        {
            "id": project.id,
            "name": project.name,
            "description": project.description,
            "config": project_config(project),
            "created_at": project.created_at,
            "updated_at": project.updated_at,
            "camera_count": len(project.cameras),
            "frame_count": sum(c.frame_count for c in project.cameras),
            "has_scene": version is not None,
            "scene_stale": version is not None and version != project.data_version,
            "last_run": run_out(run) if run else None,
        }
    )


def camera_out(camera: Camera) -> CameraOut:
    return CameraOut.model_validate(
        {
            "id": camera.id,
            "project_id": camera.project_id,
            "label": camera.label,
            "name": camera.name,
            "source_kind": camera.source_kind,
            "width": camera.width,
            "height": camera.height,
            "fps": camera.fps,
            "frame_count": camera.frame_count,
            "status": "ready" if camera.frame_count > 0 else "empty",
            "calibration": camera.calibration,
            "created_at": camera.created_at,
        }
    )


def list_projects(db: Session) -> list[Project]:
    return list(db.scalars(select(Project).order_by(Project.updated_at.desc())))


def create_project(db: Session, name: str, description: str) -> Project:
    project = Project(name=name, description=description, config=ProjectConfig().model_dump(by_alias=True))
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


def next_label(project: Project) -> str:
    used = {c.label for c in project.cameras}
    n = 1
    while f"CAM-{n:02d}" in used:
        n += 1
    return f"CAM-{n:02d}"


def add_camera(db: Session, project: Project, name: str | None) -> Camera:
    ensure_idle(project, "add a camera")
    limit = get_settings().max_cameras
    if len(project.cameras) >= limit:
        raise ValidationFailed(f"A project can have at most {limit} cameras.", code="camera_limit")
    label = next_label(project)
    position = max((c.position for c in project.cameras), default=-1) + 1
    camera = Camera(project_id=project.id, label=label, name=name or f"Camera {label[-2:]}", position=position)
    db.add(camera)
    bump_version(project)
    db.commit()
    db.refresh(camera)
    return camera


def delete_camera(db: Session, camera: Camera) -> None:
    project = camera.project
    ensure_idle(project, "remove a camera")
    storage.remove_camera_frames(project.id, camera.id)
    db.delete(camera)
    bump_version(project)
    db.commit()
