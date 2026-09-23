"""Small multi-view geometry helpers shared by the sparse and dense stages."""

from __future__ import annotations

import cv2
import numpy as np

from app.vision.camera_model import Intrinsics, Pose


def normalize_points(points: np.ndarray, intr: Intrinsics) -> np.ndarray:
    """Pixel coordinates -> undistorted normalized image coordinates (N, 2)."""
    if len(points) == 0:
        return np.empty((0, 2))
    pts = np.asarray(points, dtype=np.float64).reshape(-1, 1, 2)
    return cv2.undistortPoints(pts, intr.K, intr.dist_coeffs).reshape(-1, 2)


def project(points_w: np.ndarray, pose: Pose, intr: Intrinsics) -> tuple[np.ndarray, np.ndarray]:
    """Project world points. Returns pixel coordinates (N, 2) and camera-space depth (N,)."""
    if len(points_w) == 0:
        return np.empty((0, 2)), np.empty(0)
    pts = np.asarray(points_w, dtype=np.float64)
    depth = (pts @ pose.R.T + pose.t)[:, 2]
    rvec, _ = cv2.Rodrigues(pose.R)
    pixels, _ = cv2.projectPoints(pts.reshape(-1, 1, 3), rvec, pose.t.astype(np.float64), intr.K, intr.dist_coeffs)
    return pixels.reshape(-1, 2), depth


def triangulate_multiview(normalized_obs: list[np.ndarray], poses: list[Pose]) -> np.ndarray:
    """Linear (DLT) triangulation of a single point seen in two or more views."""
    rows = []
    for x, pose in zip(normalized_obs, poses):
        P = pose.projection
        rows.append(x[0] * P[2] - P[0])
        rows.append(x[1] * P[2] - P[1])
    _, _, vt = np.linalg.svd(np.asarray(rows))
    X = vt[-1]
    if abs(X[3]) < 1e-12:
        return np.full(3, np.nan)
    return X[:3] / X[3]


def ray_angle_deg(point: np.ndarray, centers: list[np.ndarray]) -> float:
    """Largest angle between viewing rays of ``point`` from the given camera centres."""
    dirs = [point - c for c in centers]
    dirs = [d / (np.linalg.norm(d) + 1e-12) for d in dirs]
    best = 0.0
    for i in range(len(dirs)):
        for j in range(i + 1, len(dirs)):
            cos = float(np.clip(dirs[i] @ dirs[j], -1.0, 1.0))
            best = max(best, np.degrees(np.arccos(cos)))
    return best


def rotation_between(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Rotation matrix that maps unit vector ``a`` onto unit vector ``b``."""
    a = a / np.linalg.norm(a)
    b = b / np.linalg.norm(b)
    v = np.cross(a, b)
    c = float(a @ b)
    if np.linalg.norm(v) < 1e-9:
        if c > 0:
            return np.eye(3)
        # 180 degrees: rotate about any axis orthogonal to a
        axis = np.array([1.0, 0, 0]) if abs(a[0]) < 0.9 else np.array([0, 1.0, 0])
        axis = np.cross(a, axis)
        axis /= np.linalg.norm(axis)
        return cv2.Rodrigues(axis * np.pi)[0]
    vx = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + vx + vx @ vx * (1 / (1 + c))


def umeyama(src: np.ndarray, dst: np.ndarray) -> tuple[float, np.ndarray, np.ndarray]:
    """Similarity transform (s, R, t) minimising ||dst - (s R src + t)||^2."""
    mu_s, mu_d = src.mean(0), dst.mean(0)
    xs, xd = src - mu_s, dst - mu_d
    cov = xd.T @ xs / len(src)
    U, S, Vt = np.linalg.svd(cov)
    D = np.eye(3)
    if np.linalg.det(U) * np.linalg.det(Vt) < 0:
        D[2, 2] = -1
    R = U @ D @ Vt
    var_s = (xs**2).sum() / len(src)
    s = float(np.trace(np.diag(S) @ D) / var_s)
    t = mu_d - s * R @ mu_s
    return s, R, t
