from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.api.deps import get_run_manager
from app.core.errors import ConflictError
from app.database.session import get_db
from app.schemas.project import ProjectCreate, ProjectOut, ProjectUpdate, RunOut, RunRequest
from app.services import project_service as svc
from app.services import storage
from app.services.run_manager import RunManager

router = APIRouter(prefix="/projects", tags=["projects"])


@router.get("", response_model=list[ProjectOut])
def list_projects(db: Session = Depends(get_db)):
    return [svc.project_out(p) for p in svc.list_projects(db)]


@router.post("", response_model=ProjectOut, status_code=status.HTTP_201_CREATED)
def create_project(body: ProjectCreate, db: Session = Depends(get_db)):
    return svc.project_out(svc.create_project(db, body.name, body.description))


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(project_id: str, db: Session = Depends(get_db)):
    return svc.project_out(svc.get_project(db, project_id))


@router.patch("/{project_id}", response_model=ProjectOut)
def update_project(project_id: str, body: ProjectUpdate, db: Session = Depends(get_db)):
    project = svc.get_project(db, project_id)
    if body.name is not None:
        project.name = body.name
    if body.description is not None:
        project.description = body.description
    if body.config is not None:
        svc.ensure_idle(project, "change processing settings")
        new = body.config.model_dump(by_alias=True)
        if new != project.config:
            project.config = new
            svc.bump_version(project)
    db.commit()
    db.refresh(project)
    return svc.project_out(project)


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(project_id: str, db: Session = Depends(get_db)):
    project = svc.get_project(db, project_id)
    svc.ensure_idle(project, "delete the project")
    storage.remove_project(project.id)
    db.delete(project)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---- pipeline runs ------------------------------------------------------------------------
@router.post("/{project_id}/runs", response_model=RunOut, status_code=status.HTTP_202_ACCEPTED)
def start_run(project_id: str, body: RunRequest, db: Session = Depends(get_db), runs: RunManager = Depends(get_run_manager)):
    project = svc.get_project(db, project_id)
    return svc.run_out(runs.start(db, project, body.from_stage))


def _alias(stage: str):
    def handler(project_id: str, db: Session = Depends(get_db), runs: RunManager = Depends(get_run_manager)):
        project = svc.get_project(db, project_id)
        return svc.run_out(runs.start(db, project, stage))

    return handler


# Convenience endpoints named after the pipeline steps they (re)start.
router.add_api_route("/{project_id}/reconstruction", _alias("input"), methods=["POST"], response_model=RunOut,
                     status_code=202, summary="Run the full pipeline (reconstruction and everything after it)")
router.add_api_route("/{project_id}/detection", _alias("object_detection"), methods=["POST"], response_model=RunOut,
                     status_code=202, summary="Re-run detection, tracking and scene graph on the existing reconstruction")
router.add_api_route("/{project_id}/tracking", _alias("tracking"), methods=["POST"], response_model=RunOut,
                     status_code=202, summary="Re-run tracking and scene graph")


@router.get("/{project_id}/runs/latest", response_model=RunOut | None)
def latest_run(project_id: str, db: Session = Depends(get_db)):
    run = svc.latest_run(svc.get_project(db, project_id))
    return svc.run_out(run) if run else None


@router.post("/{project_id}/runs/cancel", response_model=RunOut)
def cancel_run(project_id: str, db: Session = Depends(get_db), runs: RunManager = Depends(get_run_manager)):
    project = svc.get_project(db, project_id)
    run = svc.active_run(project)
    if run is None:
        raise ConflictError("No run is in progress.")
    runs.cancel(run.id)
    return svc.run_out(run)
