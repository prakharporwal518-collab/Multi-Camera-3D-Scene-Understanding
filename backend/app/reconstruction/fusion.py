"""Depth-map fusion: cross-view consistency filtering and voxel down-sampling."""

from __future__ import annotations

import numpy as np

from app.reconstruction.dense import DepthResult
from app.vision.camera_model import Pose


def _depth_lookup(points_w: np.ndarray, target: DepthResult, pose: Pose) -> tuple[np.ndarray, np.ndarray]:
    """Depth of ``points_w`` in the target camera and the target's own depth at that pixel."""
    cam = points_w @ pose.R.T + pose.t
    z = cam[:, 2]
    k = target.intr
    with np.errstate(divide="ignore", invalid="ignore"):
        u = np.round(cam[:, 0] / z * k.fx + k.cx).astype(np.int64)
        v = np.round(cam[:, 1] / z * k.fy + k.cy).astype(np.int64)
    h, w = target.depth.shape
    inside = (z > 0) & (u >= 0) & (u < w) & (v >= 0) & (v < h)
    stored = np.zeros(len(points_w), np.float32)
    stored[inside] = target.depth[v[inside], u[inside]]
    return z, stored


def filter_consistent(
    results: list[DepthResult],
    poses: dict[int, Pose],
    rel_tolerance: float = 0.015,
    min_agreeing_views: int = 1,
) -> list[DepthResult]:
    """Keep a pixel only if at least ``min_agreeing_views`` other depth maps agree with it."""
    by_view = {r.view: r for r in results}
    filtered = []
    for r in results:
        v_idx, u_idx = np.nonzero(r.depth)
        if len(u_idx) == 0:
            filtered.append(r)
            continue
        votes = np.zeros(len(u_idx), np.int32)
        for other in by_view.values():
            if other.view == r.view:
                continue
            z, stored = _depth_lookup(r.points, other, poses[other.view])
            ok = (stored > 0) & (np.abs(z - stored) < rel_tolerance * z)
            votes += ok
        keep = votes >= min_agreeing_views
        depth = np.zeros_like(r.depth)
        depth[v_idx[keep], u_idx[keep]] = r.depth[v_idx[keep], u_idx[keep]]
        confidence = np.where(depth > 0, r.confidence, 0).astype(np.float32)
        filtered.append(
            DepthResult(
                view=r.view,
                partners=r.partners,
                depth=depth,
                confidence=confidence,
                intr=r.intr,
                coverage=float((depth > 0).mean()),
                sparse_agreement=r.sparse_agreement,
                depth_range=r.depth_range,
                points=r.points[keep],
                colors=r.colors[keep],
            )
        )
    return filtered


def voxel_downsample(points: np.ndarray, colors: np.ndarray, voxel: float) -> tuple[np.ndarray, np.ndarray]:
    """Average points (and colours) that fall into the same voxel."""
    if len(points) == 0 or voxel <= 0:
        return points, colors
    keys = np.floor(points / voxel).astype(np.int64)
    _, inverse, counts = np.unique(keys, axis=0, return_inverse=True, return_counts=True)
    inverse = inverse.ravel()
    sums = np.zeros((len(counts), 3))
    np.add.at(sums, inverse, points)
    csum = np.zeros((len(counts), 3))
    np.add.at(csum, inverse, colors.astype(np.float64))
    return (sums / counts[:, None]).astype(np.float32), (csum / counts[:, None]).round().astype(np.uint8)
