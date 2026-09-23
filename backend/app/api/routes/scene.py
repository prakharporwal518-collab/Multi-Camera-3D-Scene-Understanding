"""Read access to pipeline results and exports."""

import csv
import io
import json
from pathlib import Path
from typing import Literal

import numpy as np
from fastapi import APIRouter, Depends, Query
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.errors import NotFoundError
from app.database.session import get_db
from app.pipeline.scene_writer import read_points
from app.services import project_service as svc
from app.services import storage

router = APIRouter(tags=["scene"])
ExportFormat = Literal["ply", "scene-json", "tracks-csv", "cameras-json"]


def _scene(project_id: str) -> dict:
    doc = storage.read_json(storage.result_file(project_id, "scene.json"))
    if doc is None:
        raise NotFoundError(
            "No reconstruction is available for this project yet.",
            code="scene_not_found",
            hint="Run the pipeline from the Overview page.",
        )
    return doc


@router.get("/scene/{project_id}")
def get_scene(project_id: str, db: Session = Depends(get_db)) -> dict:
    project = svc.get_project(db, project_id)
    doc = _scene(project.id)
    doc["stale"] = doc.get("dataVersion") != project.data_version
    return doc


@router.get("/scene/{project_id}/objects")
def get_objects(project_id: str, frame: int | None = Query(default=None, ge=0), db: Session = Depends(get_db)) -> dict:
    doc = _scene(svc.get_project(db, project_id).id)
    frames = doc.get("frames", [])
    if not frames:
        return {"frameIndex": None, "objects": []}
    chosen = frames[-1] if frame is None else next((f for f in frames if f["index"] == frame), None)
    if chosen is None:
        raise NotFoundError(f"No detections for frame {frame}.", details={"available": [f["index"] for f in frames]})
    return {"frameIndex": chosen["index"], "t": chosen["t"], "objects": chosen["objects"]}


@router.get("/scene/{project_id}/files/{name}")
def get_result_file(project_id: str, name: str, db: Session = Depends(get_db)):
    project = svc.get_project(db, project_id)
    if not (name == "points.bin" or (name.startswith("depth_") and name.endswith(".png"))):
        raise NotFoundError("Unknown result file.")
    path = storage.result_file(project.id, name)
    if not path.is_file():
        raise NotFoundError("Result file not found.", hint="Re-run the pipeline.")
    media = "application/octet-stream" if name.endswith(".bin") else "image/png"
    return FileResponse(path, media_type=media, headers={"Cache-Control": "no-cache"})


class ExportRequest(BaseModel):
    format: ExportFormat


def _export(project_id: str, fmt: ExportFormat, db: Session) -> Response:
    project = svc.get_project(db, project_id)
    doc = _scene(project.id)
    base = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in project.name)[:40] or "scene"
    if fmt == "ply":
        body = ply_bytes(storage.result_file(project.id, "points.bin"))
        return _download(body, f"{base}.ply", "application/octet-stream")
    if fmt == "scene-json":
        return _download(json.dumps(doc, indent=1).encode(), f"{base}_scene.json", "application/json")
    if fmt == "cameras-json":
        cams = [{k: c[k] for k in ("id", "label", "width", "height", "intrinsics", "pose", "calibration")} for c in doc["cameras"]]
        return _download(json.dumps({"units": doc["units"], "cameras": cams}, indent=1).encode(), f"{base}_cameras.json", "application/json")
    return _download(tracks_csv(doc).encode(), f"{base}_tracks.csv", "text/csv")


@router.get("/projects/{project_id}/export")
def export_get(project_id: str, format: ExportFormat = Query(...), db: Session = Depends(get_db)):
    return _export(project_id, format, db)


@router.post("/projects/{project_id}/export")
def export_post(project_id: str, body: ExportRequest, db: Session = Depends(get_db)):
    return _export(project_id, body.format, db)


def _download(body: bytes, filename: str, media_type: str) -> Response:
    return Response(body, media_type=media_type, headers={"Content-Disposition": f'attachment; filename="{filename}"'})


def ply_bytes(points_path: Path) -> bytes:
    pts, cols, _ = read_points(points_path)
    header = (
        "ply\nformat binary_little_endian 1.0\ncomment exported by multi-camera-3d-scene-understanding\n"
        f"element vertex {len(pts)}\nproperty float x\nproperty float y\nproperty float z\n"
        "property uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n"
    ).encode()
    rec = np.zeros(len(pts), dtype=[("x", "<f4"), ("y", "<f4"), ("z", "<f4"), ("r", "u1"), ("g", "u1"), ("b", "u1")])
    rec["x"], rec["y"], rec["z"] = pts[:, 0], pts[:, 1], pts[:, 2]
    rec["r"], rec["g"], rec["b"] = cols[:, 0], cols[:, 1], cols[:, 2]
    return header + rec.tobytes()


def tracks_csv(doc: dict) -> str:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["track_id", "class", "t", "x", "y", "z", "vx", "vy", "vz", "observed", "cameras"])
    for tr in doc.get("tracks", []):
        for s in tr["states"]:
            writer.writerow([tr["id"], tr["class"], s["t"], *s["position"], *s["velocity"], int(s["observed"]), " ".join(s["cameras"])])
    return buf.getvalue()
