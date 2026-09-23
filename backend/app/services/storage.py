"""Filesystem layout for uploaded frames and pipeline results.

All paths are built from server-generated identifiers; user-supplied filenames are never
used to construct a path, which rules out directory traversal through uploads.
"""

from __future__ import annotations

import json
import re
import shutil
from pathlib import Path

from app.core.config import get_settings
from app.core.errors import ValidationFailed

_SAFE_ID = re.compile(r"^[a-zA-Z0-9_-]{1,64}$")


def _check_id(value: str) -> str:
    if not _SAFE_ID.match(value):
        raise ValidationFailed("Invalid identifier.", details={"id": value[:64]})
    return value


def root() -> Path:
    path = get_settings().storage_dir.resolve()
    path.mkdir(parents=True, exist_ok=True)
    return path


def project_dir(project_id: str) -> Path:
    return root() / "projects" / _check_id(project_id)


def frames_dir(project_id: str, camera_id: str) -> Path:
    return project_dir(project_id) / "frames" / _check_id(camera_id)


def frame_path(project_id: str, camera_id: str, index: int) -> Path:
    if index < 0:
        raise ValidationFailed("Frame index must be non-negative.")
    return frames_dir(project_id, camera_id) / f"{index:06d}.jpg"


def results_dir(project_id: str) -> Path:
    return project_dir(project_id) / "results"


def result_file(project_id: str, name: str) -> Path:
    if not re.match(r"^[a-zA-Z0-9_.-]{1,80}$", name) or ".." in name:
        raise ValidationFailed("Invalid result name.")
    return results_dir(project_id) / name


def staging_dir(project_id: str, run_id: str) -> Path:
    path = project_dir(project_id) / f"staging-{_check_id(run_id)}"
    path.mkdir(parents=True, exist_ok=True)
    return path


def promote_staging(project_id: str, staging: Path) -> None:
    """Replace the project's results with a finished staging directory."""
    target = results_dir(project_id)
    backup = target.with_name("results-old")
    shutil.rmtree(backup, ignore_errors=True)
    if target.exists():
        target.rename(backup)
    staging.rename(target)
    shutil.rmtree(backup, ignore_errors=True)


def discard_staging(staging: Path) -> None:
    shutil.rmtree(staging, ignore_errors=True)


def write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, separators=(",", ":")))
    tmp.replace(path)


def read_json(path: Path) -> dict | None:
    if not path.is_file():
        return None
    return json.loads(path.read_text())


def remove_camera_frames(project_id: str, camera_id: str) -> None:
    shutil.rmtree(frames_dir(project_id, camera_id), ignore_errors=True)


def remove_project(project_id: str) -> None:
    shutil.rmtree(project_dir(project_id), ignore_errors=True)

