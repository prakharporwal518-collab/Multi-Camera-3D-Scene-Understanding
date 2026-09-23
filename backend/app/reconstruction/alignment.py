"""Bring a reconstruction into a display-friendly world frame.

SfM output lives in the frame of the reference camera (OpenCV: +Y down, +Z forward).
The viewer expects +Y up with the ground at y = 0, so we

1. rotate 180 degrees about X (OpenCV camera frame -> Y-up) right after pose estimation,
2. once dense points exist, fit the plane with the most support among those whose normal
   is within 35 degrees of the reference camera's "up" direction and treat it as ground,
3. rotate that normal onto +Y and translate the plane to y = 0.

Sparse SfM points are usually too thin on the ground (it is seen at a grazing angle) for
step 2, which is why it runs on the fused dense cloud. If no convincing ground plane is
found, the scene stays in the (Y-up) reference camera frame and a warning is returned.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from app.reconstruction.geometry import rotation_between
from app.vision.camera_model import Pose

FLIP = np.diag([1.0, -1.0, -1.0])
MAX_GROUND_TILT_DEG = 35.0
MIN_GROUND_POINTS = 30
MIN_GROUND_SHARE = 0.05


@dataclass
class Similarity:
    """x' = s * R @ x + t"""

    s: float
    R: np.ndarray
    t: np.ndarray

    def apply(self, points: np.ndarray) -> np.ndarray:
        return (self.s * points @ self.R.T + self.t).astype(np.float32) if len(points) else points

    def apply_pose(self, pose: Pose) -> Pose:
        # x_c = R_c x + t_c with x = (x' - t) R / s  ->  x_c = R_c R^T (x' - t)/s + t_c ; scale camera coordinates by s
        R_new = pose.R @ self.R.T
        t_new = self.s * pose.t - R_new @ self.t
        return Pose(R_new, t_new)

    def then(self, other: "Similarity") -> "Similarity":
        return Similarity(other.s * self.s, other.R @ self.R, other.s * other.R @ self.t + other.t)


def fit_plane_ransac(
    points: np.ndarray,
    threshold: float,
    iterations: int = 600,
    seed: int = 0,
    up: np.ndarray | None = None,
    max_tilt_deg: float = 90.0,
):
    """RANSAC plane fit. With ``up`` given, only planes within ``max_tilt_deg`` of it are scored."""
    rng = np.random.default_rng(seed)
    min_cos = np.cos(np.radians(max_tilt_deg))
    best_inliers = np.zeros(len(points), bool)
    best = None
    if len(points) < 3:
        return None, best_inliers
    for _ in range(iterations):
        sample = points[rng.choice(len(points), 3, replace=False)]
        normal = np.cross(sample[1] - sample[0], sample[2] - sample[0])
        norm = np.linalg.norm(normal)
        if norm < 1e-9:
            continue
        normal /= norm
        if up is not None and abs(normal @ up) < min_cos:
            continue
        d = -normal @ sample[0]
        inliers = np.abs(points @ normal + d) < threshold
        if inliers.sum() > best_inliers.sum():
            best_inliers, best = inliers, (normal, d)
    if best is None:
        return None, best_inliers
    # least-squares refit on inliers
    pts = points[best_inliers]
    centroid = pts.mean(0)
    _, _, vt = np.linalg.svd(pts - centroid)
    normal = vt[-1]
    if normal @ best[0] < 0:
        normal = -normal
    return (normal, -normal @ centroid), best_inliers


def to_y_up() -> Similarity:
    """OpenCV reference-camera frame (+Y down, +Z forward) -> +Y up."""
    return Similarity(1.0, FLIP, np.zeros(3))


def align_to_ground(
    points: np.ndarray, camera_centers: np.ndarray, up_hint: np.ndarray, max_points: int = 20000
) -> tuple[Similarity, str | None]:
    """Similarity that puts the ground plane at y = 0 (inputs already in a +Y-up frame).

    Returns the identity and a warning if no plausible ground plane is found.
    """
    identity = Similarity(1.0, np.eye(3), np.zeros(3))
    if len(points) > max_points:
        points = points[np.random.default_rng(0).choice(len(points), max_points, replace=False)]
    extent = np.percentile(points, 95, axis=0) - np.percentile(points, 5, axis=0)
    threshold = 0.004 * float(np.linalg.norm(extent)) + 1e-6
    up = up_hint / np.linalg.norm(up_hint)

    plane, inliers = fit_plane_ransac(points, threshold, up=up, max_tilt_deg=MAX_GROUND_TILT_DEG)
    if plane is None or inliers.sum() < max(MIN_GROUND_POINTS, MIN_GROUND_SHARE * len(points)):
        return identity, "No ground plane was found; the scene is shown in the reference camera's frame."
    normal, d = plane
    if normal @ up < 0:
        normal, d = -normal, -d
    R = rotation_between(normal, np.array([0.0, 1.0, 0.0]))
    # After rotating, the plane n.x + d = 0 becomes y = -d; shift it to y = 0.
    align = Similarity(1.0, R, np.array([0.0, d, 0.0]))
    if np.median(align.apply(camera_centers)[:, 1]) <= 0:
        return identity, "The fitted ground plane lies above the cameras; kept the reference camera frame."
    return align, None
