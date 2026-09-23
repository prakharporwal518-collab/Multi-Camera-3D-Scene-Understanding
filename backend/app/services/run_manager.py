"""Executes pipeline runs on a small thread pool and persists their progress."""

from __future__ import annotations

import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import AppError
from app.database.models import PipelineRun, Project
from app.database.session import SessionLocal
from app.pipeline.context import CameraSource, PipelineInput
from app.pipeline.runner import Cancelled, PipelineTimeout, empty_stage_records, run_pipeline
from app.services import media, storage
from app.services.detector_registry import detector_registry
from app.services.project_service import ensure_idle, project_config

log = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(timezone.utc)


class DbReporter:
    """Writes stage transitions to the run row. Progress writes are throttled."""

    def __init__(self, run_id: str, cancel: threading.Event, deadline: float):
        self.run_id = run_id
        self.cancel = cancel
        self.deadline = deadline
        self._last_write = 0.0

    def _update(self, stage: str, force: bool = True, **fields) -> None:
        now = time.monotonic()
        if not force and now - self._last_write < 0.4:
            return
        self._last_write = now
        with SessionLocal() as db:
            run = db.get(PipelineRun, self.run_id)
            if run is None:
                return
            stages = [dict(s) for s in (run.stages or empty_stage_records())]
            for s in stages:
                if s["id"] == stage:
                    s.update(fields)
            run.stages = stages
            db.commit()

    def stage_started(self, stage: str) -> None:
        self._update(stage, status="processing", progress=0.0)

    def stage_progress(self, stage: str, fraction: float, message: str | None = None) -> None:
        fields = {"progress": round(float(fraction), 3)}
        if message:
            fields["message"] = message
        self._update(stage, force=False, **fields)

    def stage_finished(self, stage, status, message, warnings, duration_ms, error=None) -> None:
        self._update(stage, status=status, message=message, warnings=warnings, durationMs=duration_ms,
                     progress=1.0 if status != "failed" else 0.0, error=error)

    def check_cancelled(self) -> None:
        if self.cancel.is_set():
            raise Cancelled()
        if time.monotonic() > self.deadline:
            raise PipelineTimeout()


class RunManager:
    def __init__(self, workers: int):
        self.executor = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="pipeline")
        self.cancel_flags: dict[str, threading.Event] = {}

    def recover_interrupted(self) -> None:
        """Runs that were in flight when the server stopped can never finish; mark them failed."""
        with SessionLocal() as db:
            for run in db.scalars(select(PipelineRun).where(PipelineRun.status.in_(["queued", "running"]))):
                run.status = "failed"
                run.finished_at = _now()
                run.error = {"code": "interrupted", "message": "The server restarted while this run was in progress.",
                             "hint": "Start the pipeline again."}
            db.commit()

    def start(self, db: Session, project: Project, from_stage: str) -> PipelineRun:
        ensure_idle(project, "start another run")
        run = PipelineRun(project_id=project.id, from_stage=from_stage, stages=empty_stage_records(),
                          data_version=project.data_version)
        db.add(run)
        db.commit()
        db.refresh(run)
        self.cancel_flags[run.id] = threading.Event()
        self.executor.submit(self._execute, run.id)
        return run

    def cancel(self, run_id: str) -> bool:
        flag = self.cancel_flags.get(run_id)
        if flag is None:
            return False
        flag.set()
        return True

    def shutdown(self) -> None:
        for flag in self.cancel_flags.values():
            flag.set()
        self.executor.shutdown(wait=False, cancel_futures=True)

    # ------------------------------------------------------------------------------------
    def _execute(self, run_id: str) -> None:
        settings = get_settings()
        cancel = self.cancel_flags[run_id]
        with SessionLocal() as db:
            run = db.get(PipelineRun, run_id)
            if run is None:
                return
            run.status = "running"
            run.started_at = _now()
            db.commit()
            project = run.project
            inp = self._build_input(project)
            data_version = run.data_version
            from_stage = run.from_stage
            project_id = project.id

        reporter = DbReporter(run_id, cancel, time.monotonic() + settings.processing_timeout_s)
        results = storage.results_dir(project_id)
        # A full run writes into a staging directory that replaces the previous results only
        # on success, so a failed or cancelled re-run never destroys a good reconstruction.
        out_dir = storage.staging_dir(project_id, run_id) if from_stage == "input" else results
        status, error = "completed", None
        try:
            scene = run_pipeline(inp, reporter, out_dir, from_stage)
            scene["dataVersion"] = data_version
            scene["runId"] = run_id
            storage.write_json(out_dir / "scene.json", scene)
            if out_dir != results:
                storage.promote_staging(project_id, out_dir)
        except Cancelled:
            status = "cancelled"
            error = {"code": "cancelled", "message": "The run was cancelled."}
        except PipelineTimeout:
            status = "failed"
            error = {"code": "processing_timeout",
                     "message": f"Processing exceeded the {settings.processing_timeout_s} s time limit.",
                     "hint": "Reduce the number of timesteps or the depth resolution in Settings, or raise PROCESSING_TIMEOUT_S."}
        except AppError as exc:
            status, error = "failed", exc.to_dict()["error"]
        except Exception:  # pragma: no cover - defensive; stage-level handler normally catches these
            log.exception("run %s crashed", run_id)
            status = "failed"
            error = {"code": "internal_error", "message": "The pipeline stopped because of an internal error."}
        finally:
            self.cancel_flags.pop(run_id, None)
            if out_dir != results:
                storage.discard_staging(out_dir)
        with SessionLocal() as db:
            run = db.get(PipelineRun, run_id)
            if run is not None:
                run.status = status
                run.error = error
                run.finished_at = _now()
                if status != "completed":
                    stages = [dict(s) for s in run.stages]
                    for s in stages:
                        if s["status"] == "processing":
                            s["status"] = "failed" if status == "failed" else "waiting"
                    run.stages = stages
                db.commit()

    def _build_input(self, project: Project) -> PipelineInput:
        sources = []
        for cam in project.cameras:
            def loader(index: int, pid=project.id, cid=cam.id):
                return media.load_frame_rgb(storage.frame_path(pid, cid, index))

            sources.append(
                CameraSource(
                    id=cam.id,
                    label=cam.label,
                    name=cam.name,
                    width=cam.width or 0,
                    height=cam.height or 0,
                    frame_count=cam.frame_count,
                    fps=cam.fps,
                    calibration=cam.calibration,
                    load_frame=loader,
                    frame_url=f"cameras/{cam.id}/frames/{{index}}/image",
                )
            )
        detector = detector_registry.get()
        return PipelineInput(
            project_id=project.id,
            cameras=sources,
            config=project_config(project),
            detection_provider=(lambda _cid, _idx, image: detector.detect(image)) if detector else None,
            detection_source=f"model:{detector.name}" if detector else "none",
        )
