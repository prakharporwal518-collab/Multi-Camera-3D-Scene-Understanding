"""Lift per-camera 2D detections to 3D objects.

Detections of the same class are associated across cameras by triangulating box centres
and checking the reprojection into each box. Objects seen by a single camera are placed
by intersecting the ray through the bottom of the box with the ground plane, but only
when the reconstruction has been aligned to a ground plane.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from app.detection.base import Detection2D
from app.reconstruction.geometry import normalize_points, project, triangulate_multiview
from app.vision.camera_model import Intrinsics, Pose


@dataclass
class CameraView:
    camera_id: str
    intr: Intrinsics
    pose: Pose


@dataclass
class Detection3D:
    cls: str
    confidence: float
    center: np.ndarray
    size: np.ndarray  # (width, height, length)
    observations: dict[str, Detection2D] = field(default_factory=dict)
    method: str = "multi-view"  # multi-view | ground-contact

    @property
    def cameras(self) -> list[str]:
        return sorted(self.observations)


def _box_diag(det: Detection2D) -> float:
    x1, y1, x2, y2 = det.box
    return float(np.hypot(x2 - x1, y2 - y1))


def _fits(det: Detection2D, X: np.ndarray, view: CameraView, tolerance: float) -> float | None:
    px, z = project(X[None], view.pose, view.intr)
    if z[0] <= 0:
        return None
    err = float(np.linalg.norm(px[0] - det.center))
    return err if err < tolerance * _box_diag(det) else None


def _size_from_views(center: np.ndarray, obs: dict[str, Detection2D], views: dict[str, CameraView]) -> np.ndarray:
    widths, heights = [], []
    for cam_id, det in obs.items():
        v = views[cam_id]
        depth = (v.pose.R @ center + v.pose.t)[2]
        x1, y1, x2, y2 = det.box
        widths.append((x2 - x1) * depth / v.intr.fx)
        heights.append((y2 - y1) * depth / v.intr.fy)
    w, h = float(np.median(widths)), float(np.median(heights))
    # The extent along the viewing direction is not observable from a 2D box; use the width.
    return np.array([w, h, w])


def lift_detections(
    detections: dict[str, list[Detection2D]],
    views: dict[str, CameraView],
    ground_aligned: bool,
    tolerance: float = 0.2,
) -> list[Detection3D]:
    used: set[tuple[str, int]] = set()
    candidates = []
    cams = [c for c in detections if c in views]
    for ai, a in enumerate(cams):
        for b in cams[ai + 1 :]:
            for i, da in enumerate(detections[a]):
                for j, db in enumerate(detections[b]):
                    if da.cls != db.cls:
                        continue
                    xa = normalize_points(da.center[None], views[a].intr)[0]
                    xb = normalize_points(db.center[None], views[b].intr)[0]
                    X = triangulate_multiview([xa, xb], [views[a].pose, views[b].pose])
                    if not np.all(np.isfinite(X)):
                        continue
                    ea, eb = _fits(da, X, views[a], tolerance), _fits(db, X, views[b], tolerance)
                    if ea is None or eb is None:
                        continue
                    cost = ea / _box_diag(da) + eb / _box_diag(db)
                    candidates.append((cost, (a, i), (b, j)))
    candidates.sort(key=lambda c: c[0])

    objects: list[Detection3D] = []
    for _, (a, i), (b, j) in candidates:
        if (a, i) in used or (b, j) in used:
            continue
        obs = {a: detections[a][i], b: detections[b][j]}
        refs = [(a, i), (b, j)]
        X = _triangulate(obs, views)
        for c in cams:
            if c in obs:
                continue
            best = None
            for k, dc in enumerate(detections[c]):
                if (c, k) in used or dc.cls != obs[a].cls:
                    continue
                err = _fits(dc, X, views[c], tolerance)
                if err is not None and (best is None or err < best[0]):
                    best = (err, k)
            if best is not None:
                obs[c] = detections[c][best[1]]
                refs.append((c, best[1]))
                X = _triangulate(obs, views)
        used.update(refs)
        conf = float(np.mean([d.confidence for d in obs.values()]))
        size = _size_from_views(X, obs, views)
        if ground_aligned:
            X = X.copy()
            X[1] = max(X[1], size[1] / 2)
        objects.append(Detection3D(obs[a].cls, conf, X, size, obs, "multi-view"))

    if ground_aligned:
        for c in cams:
            for k, det in enumerate(detections[c]):
                if (c, k) in used:
                    continue
                lifted = _ground_contact(det, views[c])
                if lifted is not None:
                    objects.append(lifted)
    return objects


def _triangulate(obs: dict[str, Detection2D], views: dict[str, CameraView]) -> np.ndarray:
    xs = [normalize_points(d.center[None], views[c].intr)[0] for c, d in obs.items()]
    return triangulate_multiview(xs, [views[c].pose for c in obs])


def _ground_contact(det: Detection2D, view: CameraView) -> Detection3D | None:
    """Single-view placement: the bottom edge of the box touches the ground plane y = 0."""
    x = normalize_points(det.bottom_center[None], view.intr)[0]
    ray = view.pose.R.T @ np.array([x[0], x[1], 1.0])
    origin = view.pose.center
    if ray[1] >= -1e-6:
        return None  # ray does not hit the ground in front of the camera
    s = -origin[1] / ray[1]
    foot = origin + s * ray
    depth = (view.pose.R @ foot + view.pose.t)[2]
    x1, y1, x2, y2 = det.box
    w = (x2 - x1) * depth / view.intr.fx
    h = (y2 - y1) * depth / view.intr.fy
    center = foot + np.array([0.0, h / 2, 0.0])
    return Detection3D(det.cls, det.confidence * 0.8, center, np.array([w, h, w]), {view.camera_id: det}, "ground-contact")
