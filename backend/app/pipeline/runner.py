"""Runs pipeline stages in order and records status, timing and warnings for each."""

from __future__ import annotations

import logging
import resource
import time
from pathlib import Path

import numpy as np

from app.core.errors import AppError, ProcessingError
from app.pipeline.config import STAGE_IDS, STAGES
from app.pipeline.context import CameraState, PipelineInput, PipelineState, Reporter
from app.pipeline.scene_writer import build_scene, read_points
from app.pipeline.stages import STAGE_FUNCTIONS, StageSkipped, stage_input
from app.vision.camera_model import Intrinsics, Pose

log = logging.getLogger(__name__)


class Cancelled(Exception):
    pass


class PipelineTimeout(Exception):
    pass


def empty_stage_records() -> list[dict]:
    return [
        {
            "id": sid,
            "label": label,
            "status": "waiting",
            "progress": 0.0,
            "durationMs": None,
            "message": None,
            "warnings": [],
            "error": None,
        }
        for sid, label in STAGES
    ]


def run_pipeline(inp: PipelineInput, reporter: Reporter, out_dir: Path, from_stage: str = "input") -> dict:
    """Run stages from ``from_stage`` to the end and return the scene document.

    Raises the underlying :class:`AppError` if a stage fails; the reporter has already
    recorded the failure by then.
    """
    if from_stage not in STAGE_IDS:
        raise ValueError(f"unknown stage {from_stage}")
    st = PipelineState()
    records = {r["id"]: r for r in empty_stage_records()}
    wall_start, cpu_start = time.perf_counter(), time.process_time()

    start_idx = STAGE_IDS.index(from_stage)
    if start_idx > 0:
        _restore(inp, st, out_dir)
        for sid in STAGE_IDS[:start_idx]:
            previous = st.loaded_scene["stats"]["stages"]
            prev = next((r for r in previous if r["id"] == sid), None)
            if prev:
                records[sid] = prev
            r = records[sid]
            reporter.stage_finished(sid, r["status"], r["message"] or "", r["warnings"], r["durationMs"] or 0, r.get("error"))

    for sid in STAGE_IDS[start_idx:]:
        reporter.check_cancelled()
        reporter.stage_started(sid)
        t0 = time.perf_counter()
        rec = records[sid]
        try:
            message, warnings = STAGE_FUNCTIONS[sid](inp, st, reporter)
            status = "warning" if warnings else "completed"
        except StageSkipped as skip:
            message, warnings, status = str(skip), [], "skipped"
        except (Cancelled, PipelineTimeout):
            raise
        except AppError as err:
            rec.update(status="failed", durationMs=_ms(t0), message=err.message, error=err.to_dict()["error"])
            reporter.stage_finished(sid, "failed", err.message, [], _ms(t0), rec["error"])
            raise
        except Exception as exc:  # unexpected bug: report it without leaking internals
            log.exception("stage %s crashed", sid)
            err = ProcessingError(
                f"The {rec['label'].lower()} stage stopped because of an internal error.",
                code="internal_error",
                status_code=500,
                hint="This is a bug. The server log contains the details.",
                details={"exception": type(exc).__name__},
            )
            rec.update(status="failed", durationMs=_ms(t0), message=err.message, error=err.to_dict()["error"])
            reporter.stage_finished(sid, "failed", err.message, [], _ms(t0), rec["error"])
            raise err from exc
        rec.update(status=status, durationMs=_ms(t0), message=message, warnings=warnings, progress=1.0)
        st.warnings.extend(warnings)
        reporter.stage_finished(sid, status, message, warnings, rec["durationMs"])

    resources = {
        "wallTimeS": round(time.perf_counter() - wall_start, 2),
        "cpuTimeS": round(time.process_time() - cpu_start, 2),
        "peakMemoryMb": round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, 1),
        "gpu": None,
    }
    if st.loaded_scene is not None:
        # A restart re-uses earlier stages; report resources for the pipeline as a whole.
        prev = st.loaded_scene["stats"].get("resources") or {}
        resources["wallTimeS"] = round(resources["wallTimeS"] + prev.get("wallTimeS", 0), 2)
        resources["cpuTimeS"] = round(resources["cpuTimeS"] + prev.get("cpuTimeS", 0), 2)
    return build_scene(inp, st, out_dir, list(records.values()), resources)


def _ms(t0: float) -> float:
    return round((time.perf_counter() - t0) * 1000, 1)


def _restore(inp: PipelineInput, st: PipelineState, out_dir: Path) -> None:
    """Rebuild the geometric state from a previous run so later stages can be re-run alone."""
    import json

    scene_path = out_dir / "scene.json"
    if not scene_path.is_file():
        raise ProcessingError(
            "There is no reconstruction to build on yet.",
            code="reconstruction_missing",
            hint="Run the full pipeline first.",
        )
    scene = json.loads(scene_path.read_text())
    st.loaded_scene = scene
    stage_input(inp, st, _NullReporter())  # timestamps and camera list
    by_id = {c["id"]: c for c in scene["cameras"]}
    restored: list[CameraState] = []
    for cam in st.cameras:
        saved = by_id.get(cam.source.id)
        if saved is None:
            raise ProcessingError(
                f"{cam.source.label} was added after the last reconstruction.",
                code="reconstruction_stale",
                hint="Re-run the full pipeline so the new camera is registered.",
            )
        intr = Intrinsics.from_dict(saved["intrinsics"])
        cam.intr_native = intr
        cam.intr = intr
        cam.calibration_method = saved["calibration"]["method"]
        cam.calibration_error = saved["calibration"]["reprojectionErrorPx"]
        cam.registration_note = saved.get("registrationNote")
        if saved["pose"]:
            cam.pose = Pose(np.asarray(saved["pose"]["R"]).reshape(3, 3), np.asarray(saved["pose"]["t"]))
        restored.append(cam)
    st.cameras = restored
    st.units = scene["units"]
    st.ground_aligned = scene["groundAligned"]
    pts, cols, layer = read_points(out_dir / "points.bin")
    st.sparse_points, st.sparse_colors = pts[layer == 0], cols[layer == 0]
    st.dense_points, st.dense_colors = pts[layer == 1], cols[layer == 1]


class _NullReporter:
    def stage_started(self, stage: str) -> None: ...
    def stage_progress(self, stage: str, fraction: float, message: str | None = None) -> None: ...
    def stage_finished(self, stage, status, message, warnings, duration_ms, error=None) -> None: ...
    def check_cancelled(self) -> None: ...
