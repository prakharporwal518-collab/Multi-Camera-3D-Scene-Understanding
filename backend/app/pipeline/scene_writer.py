"""Serialise pipeline results into the scene document consumed by the frontend.

The same writer is used for real projects and for the demo dataset, so both follow one
schema (see docs/scene-format.md). Binary payloads:

* ``points.bin``  - N x float32 xyz, then N x uint8 rgb, then N x uint8 layer (0 sparse, 1 dense).
                    Points are shuffled so any prefix is a uniform subsample (used for LOD).
* ``depth_<camera>.png`` - 8-bit RGB PNG: R/G hold a 16-bit depth value (hi/lo byte),
                    B holds confidence * 255. Value 0 means "no estimate".
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import cv2
import numpy as np

from app.pipeline.context import PipelineInput, PipelineState
from app.pipeline.stages import object_id
from app.scene.relations import VEHICLE_CLASSES

SCHEMA_VERSION = 1


def write_points(path: Path, sparse: np.ndarray, sparse_rgb: np.ndarray, dense: np.ndarray, dense_rgb: np.ndarray, seed: int = 7) -> dict:
    pts = np.concatenate([sparse, dense]).astype(np.float32)
    cols = np.concatenate([sparse_rgb, dense_rgb]).astype(np.uint8)
    layer = np.concatenate([np.zeros(len(sparse), np.uint8), np.ones(len(dense), np.uint8)])
    order = np.random.default_rng(seed).permutation(len(pts))
    pts, cols, layer = pts[order], cols[order], layer[order]
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "wb") as fh:
        fh.write(np.ascontiguousarray(pts).tobytes())
        fh.write(np.ascontiguousarray(cols).tobytes())
        fh.write(layer.tobytes())
    lo = np.percentile(pts, 1, 0) if len(pts) else np.zeros(3)
    hi = np.percentile(pts, 99, 0) if len(pts) else np.zeros(3)
    return {
        "count": int(len(pts)),
        "sparseCount": int(len(sparse)),
        "denseCount": int(len(dense)),
        "bounds": {"min": _r(lo), "max": _r(hi)},
        "format": "xyz-f32/rgb-u8/layer-u8",
    }


def read_points(path: Path) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    raw = path.read_bytes()
    n = len(raw) // 16  # 12 bytes xyz + 3 bytes rgb + 1 byte layer
    pts = np.frombuffer(raw[: n * 12], np.float32).reshape(n, 3)
    cols = np.frombuffer(raw[n * 12 : n * 15], np.uint8).reshape(n, 3)
    layer = np.frombuffer(raw[n * 15 : n * 16], np.uint8)
    return pts, cols, layer


def write_depth_png(path: Path, depth: np.ndarray, confidence: np.ndarray) -> dict:
    valid = depth > 0
    d_max = float(depth[valid].max()) if valid.any() else 1.0
    step = d_max / 65000.0
    q = np.where(valid, np.clip(np.round(depth / step), 1, 65535), 0).astype(np.uint16)
    hi, lo = (q >> 8).astype(np.uint8), (q & 0xFF).astype(np.uint8)
    conf = np.round(np.clip(confidence, 0, 1) * 255).astype(np.uint8)
    path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(path), np.dstack([conf, lo, hi]))  # OpenCV writes BGR -> file is RGB = (hi, lo, conf)
    vals = depth[valid]
    return {
        "encoding": {"type": "rg16", "step": step},
        "min": float(vals.min()) if len(vals) else None,
        "max": float(vals.max()) if len(vals) else None,
        "mean": float(vals.mean()) if len(vals) else None,
        "median": float(np.median(vals)) if len(vals) else None,
    }


def _r(v, nd: int = 4) -> list[float]:
    return [round(float(x), nd) for x in np.asarray(v).ravel()]


def _camera_entry(cam, sparse, view_index: int) -> dict:
    intr = cam.intr_native
    entry = {
        "id": cam.source.id,
        "label": cam.source.label,
        "name": cam.source.name,
        "width": cam.source.width,
        "height": cam.source.height,
        "fps": cam.source.fps,
        "frameCount": cam.source.frame_count,
        "frameUrl": cam.source.frame_url,
        "intrinsics": {k: round(v, 3) if isinstance(v, float) else v for k, v in intr.to_dict().items()},
        "fovY": round(intr.fov_y_deg, 2),
        "calibration": {"method": cam.calibration_method, "reprojectionErrorPx": cam.calibration_error},
        "registered": cam.pose is not None,
        "registrationNote": cam.registration_note,
        "pose": None,
        "observations": 0,
        "meanReprojErrorPx": None,
    }
    if cam.pose is not None:
        entry["pose"] = {"R": _r(cam.pose.R, 6), "t": _r(cam.pose.t), "position": _r(cam.pose.center)}
    if sparse is not None and view_index in sparse.poses:
        n_obs, err = sparse.camera_error(view_index)
        entry["observations"] = n_obs
        entry["meanReprojErrorPx"] = round(err, 3) if np.isfinite(err) else None
    return entry


def _object_entry(frame, k: int, cam_labels: dict[str, str]) -> dict:
    o = frame.objects[k]
    track = frame.track_ids[k] if k < len(frame.track_ids) else None
    return {
        "id": object_id(frame, k),
        "trackId": track,
        "class": o.cls,
        "category": "vehicle" if o.cls in VEHICLE_CLASSES else o.cls,
        "confidence": round(o.confidence, 3),
        "center": _r(o.center, 3),
        "size": _r(o.size, 3),
        "yaw": 0.0,
        "method": o.method,
        "visibleCameras": [cam_labels.get(c, c) for c in o.cameras],
        "boxes": {cam_labels.get(c, c): _r(d.box, 1) for c, d in o.observations.items()},
    }


def _track_entry(tr) -> dict:
    states = []
    for s in tr.states:
        states.append(
            {
                "t": round(s.t, 3),
                "position": _r(s.position, 3),
                "velocity": _r(s.velocity, 3),
                "observed": s.observed,
                "cameras": s.cameras,
            }
        )
    speeds = [float(np.linalg.norm(s.velocity[[0, 2]])) for s in tr.states if s.observed][1:]
    return {
        "id": tr.id,
        "class": tr.cls,
        "status": tr.status,
        "confidence": round(tr.confidence, 3),
        "observations": sum(s.observed for s in tr.states),
        "meanSpeed": round(float(np.mean(speeds)), 3) if speeds else 0.0,
        "states": states,
    }


def build_scene(inp: PipelineInput, st: PipelineState, out_dir: Path, stage_records: list[dict], resources: dict) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    point_info = write_points(
        out_dir / "points.bin",
        st.sparse_points,
        st.sparse_colors,
        st.dense_points if st.dense_points is not None else np.zeros((0, 3), np.float32),
        st.dense_colors if st.dense_colors is not None else np.zeros((0, 3), np.uint8),
    )
    point_info["url"] = "points.bin"

    labels = {c.source.id: c.source.label for c in st.cameras}
    depth_maps = []
    for d in st.depth:
        cam = st.cameras[d.view]
        name = f"depth_{cam.source.id}.png"
        info = write_depth_png(out_dir / name, d.depth, d.confidence)
        h, w = d.depth.shape
        depth_maps.append(
            {
                "cameraId": cam.source.id,
                "url": name,
                "width": w,
                "height": h,
                "coverage": round(d.coverage, 4),
                "sparseAgreement": None if d.sparse_agreement is None else round(d.sparse_agreement, 5),
                "partners": [labels[st.cameras[p].source.id] for p in d.partners],
                "method": "plane-sweep ZNCC + cross-view consistency",
                **info,
            }
        )

    sparse = st.sparse
    cameras = [_camera_entry(c, sparse, v) for v, c in enumerate(st.cameras)]
    reproj = [c["meanReprojErrorPx"] for c in cameras if c["meanReprojErrorPx"] is not None]
    pair_stats = [
        {"a": st.views[i].label, "b": st.views[j].label, "tentative": m.num_tentative, "inliers": m.num_inliers}
        for (i, j), m in sorted(st.matches.items())
    ]
    frames = [
        {"index": f.index, "t": round(f.t, 3), "objects": [_object_entry(f, k, labels) for k in range(len(f.objects))]}
        for f in st.frames
    ]
    error_hist = []
    if sparse is not None and len(sparse.point_errors):
        counts, edges = np.histogram(sparse.point_errors, bins=12, range=(0, 3))
        error_hist = [{"from": round(float(edges[i]), 2), "to": round(float(edges[i + 1]), 2), "count": int(counts[i])} for i in range(len(counts))]

    prev = st.loaded_scene
    if prev is not None:
        # Geometry stages were not re-run: carry their outputs over from the previous scene.
        depth_maps = prev["depthMaps"]
        pair_stats = prev["matching"]["pairs"]
        error_hist = prev["stats"]["reprojErrorHistogram"]
        prev_cams = {c["id"]: c for c in prev["cameras"]}
        for c in cameras:
            old = prev_cams.get(c["id"], {})
            c["observations"] = old.get("observations", 0)
            c["meanReprojErrorPx"] = old.get("meanReprojErrorPx")
        reproj = [c["meanReprojErrorPx"] for c in cameras if c["meanReprojErrorPx"] is not None]
        ba = prev["stats"]["bundleAdjustment"]
    else:
        ba = [
            {"initialRmsPx": round(b.initial_rms_px, 3), "finalRmsPx": round(b.final_rms_px, 3), "iterations": b.iterations, "observations": b.observations}
            for b in st.ba_reports
        ]

    return {
        "schemaVersion": SCHEMA_VERSION,
        "projectId": inp.project_id,
        "source": inp.source,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "units": st.units,
        "groundAligned": st.ground_aligned,
        "provenance": {
            "images": inp.image_source,
            "reconstruction": "pipeline",
            "depth": "pipeline" if depth_maps else "none",
            "detections": inp.detection_source if st.frames else "none",
            "tracks": "pipeline" if st.tracks else "none",
            "sceneGraph": "rules" if st.relations else "none",
        },
        "cameras": cameras,
        "pointCloud": point_info,
        "depthMaps": depth_maps,
        "timeline": {"timestamps": [round(t, 3) for _, t in st.timestamps], "frameIndices": [i for i, _ in st.timestamps]},
        "frames": frames,
        "tracks": [_track_entry(t) for t in st.tracks],
        "regions": inp.regions,
        "relations": [r.to_dict() for r in st.relations],
        "relationsViewpoint": st.viewpoint_camera,
        "matching": {"pairs": pair_stats, "detector": inp.config.detector, "ratio": inp.config.match_ratio},
        "stats": {
            "stages": stage_records,
            "registeredCameras": sum(c["registered"] for c in cameras),
            "sparsePoints": point_info["sparseCount"],
            "densePoints": point_info["denseCount"],
            "meanReprojErrorPx": round(float(np.mean(reproj)), 3) if reproj else None,
            "reprojErrorHistogram": error_hist,
            "bundleAdjustment": ba,
            "sceneExtent": round(float(np.linalg.norm(np.asarray(point_info["bounds"]["max"]) - np.asarray(point_info["bounds"]["min"]))), 3),
            "resources": resources,
        },
        "evaluation": None,
        "warnings": st.warnings,
    }
