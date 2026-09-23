"""Simulated 2D detector for the demo dataset.

No detection model ships with this repository, so the demo derives 2D boxes from the
synthetic ground truth (projected 3D boxes, visibility from the instance mask) and
perturbs them with noise and occasional misses. The scene document labels these
detections as *simulated*; they never appear in real projects.
"""

from __future__ import annotations

import numpy as np

from app.detection.base import Detection2D
from app.synthetic.scene import Box
from app.vision.camera_model import Intrinsics, Pose

DETECTABLE = {"car": "car", "truck": "truck", "person": "person", "bench": "bench"}


def _corners(box: Box) -> np.ndarray:
    hx, hy, hz = box.size / 2
    c, s = np.cos(box.yaw), np.sin(box.yaw)
    Ry = np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
    local = np.array([[x, y, z] for x in (-hx, hx) for y in (-hy, hy) for z in (-hz, hz)])
    return local @ Ry.T + box.center


def simulate(boxes: list[Box], instance: np.ndarray, intr: Intrinsics, pose: Pose, rng: np.random.Generator) -> list[Detection2D]:
    out = []
    for idx, box in enumerate(boxes):
        cls = DETECTABLE.get(box.cls)
        if cls is None:
            continue
        cam = _corners(box) @ pose.R.T + pose.t
        if np.any(cam[:, 2] <= 0.1):
            continue
        px = cam @ intr.K.T
        px = px[:, :2] / px[:, 2:3]
        x1, y1 = np.clip(px.min(0), 0, [intr.width - 1, intr.height - 1])
        x2, y2 = np.clip(px.max(0), 0, [intr.width - 1, intr.height - 1])
        if x2 - x1 < 12 or y2 - y1 < 12:
            continue
        # Instance masks are rendered at the same resolution as the camera.
        region = instance[int(y1) : int(y2) + 1, int(x1) : int(x2) + 1]
        visible = float((region == idx).mean()) if region.size else 0.0
        full_area = (px.max(0) - px.min(0)).prod()
        visible *= (x2 - x1) * (y2 - y1) / max(full_area, 1)
        if visible < 0.2 or rng.random() < 0.05:
            continue
        w, h = x2 - x1, y2 - y1
        noise = rng.normal(0, 0.025, 4) * np.array([w, h, w, h])
        box2d = (x1 + noise[0], y1 + noise[1], x2 + noise[2], y2 + noise[3])
        conf = float(np.clip(0.55 + 0.4 * visible + rng.normal(0, 0.04), 0.3, 0.99))
        out.append(Detection2D(cls, conf, tuple(float(v) for v in box2d)))
    return out
