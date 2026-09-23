"""Dense depth by plane-sweep multi-view stereo.

For a reference camera, fronto-parallel planes are swept through the depth range covered
by the sparse reconstruction (sampled uniformly in inverse depth). Each neighbouring
camera is warped onto every plane with the induced homography and compared to the
reference image with windowed zero-mean normalised cross-correlation (ZNCC).

Unlike rectified two-view stereo this works for wide, converging baselines, and the
aggregated ZNCC score doubles as a per-pixel confidence value.
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from app.vision.camera_model import Intrinsics, Pose


@dataclass
class DepthOptions:
    num_planes: int = 128
    window: int = 9
    working_width: int = 640
    max_pair_angle_deg: float = 50.0
    max_partners: int = 3
    min_score: float = 0.6
    min_texture: float = 4.0  # std-dev of intensity inside the window


@dataclass
class DepthResult:
    view: int
    partners: list[int]
    depth: np.ndarray  # (h, w) float32 at working resolution, 0 = no estimate
    confidence: np.ndarray  # (h, w) float32 in [0, 1]
    intr: Intrinsics  # intrinsics of the working resolution
    coverage: float
    sparse_agreement: float | None
    depth_range: tuple[float, float]
    points: np.ndarray  # (N, 3) world points
    colors: np.ndarray  # (N, 3) uint8


def viewing_angle_deg(a: Pose, b: Pose) -> float:
    return float(np.degrees(np.arccos(np.clip(a.R[2] @ b.R[2], -1, 1))))


def choose_partners(view: int, poses: dict[int, Pose], shared: dict[tuple[int, int], int], opt: DepthOptions) -> list[int]:
    candidates = []
    for other in poses:
        if other == view or viewing_angle_deg(poses[view], poses[other]) > opt.max_pair_angle_deg:
            continue
        n = shared.get((min(view, other), max(view, other)), 0)
        if n > 0:
            candidates.append((n, other))
    candidates.sort(reverse=True)
    return [other for _, other in candidates[: opt.max_partners]]


def _box_mean(img: np.ndarray, k: int) -> np.ndarray:
    return cv2.blur(img, (k, k), borderType=cv2.BORDER_REFLECT)


def plane_sweep_depth(
    view: int,
    partners: list[int],
    intr: dict[int, Intrinsics],
    poses: dict[int, Pose],
    images_gray: dict[int, np.ndarray],
    images_rgb: dict[int, np.ndarray],
    sparse_points: np.ndarray,
    opt: DepthOptions | None = None,
) -> DepthResult | None:
    opt = opt or DepthOptions()
    if not partners:
        return None
    ref_full = intr[view]
    scale = min(1.0, opt.working_width / ref_full.width)
    w, h = int(round(ref_full.width * scale)), int(round(ref_full.height * scale))
    ref_k = ref_full.scaled(w, h)
    ref_img = _prepare(images_gray[view], ref_full, ref_k)

    pr = poses[view]
    cam_pts = sparse_points @ pr.R.T + pr.t
    z = cam_pts[:, 2]
    px = cam_pts[z > 0] @ ref_k.K.T
    px = px[:, :2] / px[:, 2:3]
    in_view = (px[:, 0] >= 0) & (px[:, 0] < w) & (px[:, 1] >= 0) & (px[:, 1] < h)
    visible_z = z[z > 0][in_view]
    if len(visible_z) < 10:
        return None
    d_min, d_max = np.percentile(visible_z, 1) * 0.8, np.percentile(visible_z, 99) * 1.25
    inv = np.linspace(1 / d_min, 1 / d_max, opt.num_planes)
    depths = 1 / inv

    k = opt.window
    ref_f = ref_img.astype(np.float32)
    mu_r = _box_mean(ref_f, k)
    var_r = np.maximum(_box_mean(ref_f * ref_f, k) - mu_r**2, 0)
    std_r = np.sqrt(var_r)

    partner_imgs = []
    for p in partners:
        pk = intr[p].scaled(int(round(intr[p].width * scale)), int(round(intr[p].height * scale)))
        partner_imgs.append((p, pk, _prepare(images_gray[p], intr[p], pk).astype(np.float32)))

    best = np.full((h, w), -1.0, np.float32)
    second = np.full((h, w), -1.0, np.float32)
    best_idx = np.zeros((h, w), np.int32)
    scores = np.empty((opt.num_planes, h, w), np.float32)
    n_vec = np.array([0.0, 0.0, 1.0])
    K_ref_inv = np.linalg.inv(ref_k.K)
    for i, d in enumerate(depths):
        per_partner = []
        for p, pk, img in partner_imgs:
            R_rel = poses[p].R @ pr.R.T
            t_rel = poses[p].t - R_rel @ pr.t
            H = pk.K @ (R_rel + np.outer(t_rel, n_vec) / d) @ K_ref_inv
            warped = cv2.warpPerspective(img, H, (w, h), flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP, borderValue=-1)
            inside = warped >= 0
            warped = np.where(inside, warped, 0)
            mu_w = _box_mean(warped, k)
            var_w = np.maximum(_box_mean(warped * warped, k) - mu_w**2, 0)
            cov = _box_mean(ref_f * warped, k) - mu_r * mu_w
            zncc = cov / (np.sqrt(var_r * var_w) + 1e-3)
            zncc[~inside] = -1
            per_partner.append(zncc)
        stack = np.stack(per_partner)
        # Occlusion-robust aggregation: average of the best two partners.
        stack.sort(axis=0)
        score = stack[-2:].mean(0) if len(stack) >= 2 else stack[-1]
        scores[i] = score
        better = score > best
        second = np.where(better, best, np.maximum(second, score))
        best_idx = np.where(better, i, best_idx)
        best = np.where(better, score, best)

    depth = _subplane_depth(scores, best_idx, inv)
    valid = (best > opt.min_score) & (std_r > opt.min_texture) & (best_idx > 0) & (best_idx < opt.num_planes - 1)
    # Reject ambiguous minima: the best plane must beat planes far away from it.
    valid &= (best - second) > 0.02
    depth = np.where(valid, depth, 0).astype(np.float32)
    confidence = np.clip((best - opt.min_score) / (1 - opt.min_score), 0, 1) * valid

    points, colors = _backproject(depth, ref_k, pr, images_rgb[view], ref_full)
    coverage = float(valid.mean())
    return DepthResult(
        view=view,
        partners=partners,
        depth=depth,
        confidence=confidence.astype(np.float32),
        intr=ref_k,
        coverage=coverage,
        sparse_agreement=_sparse_agreement(depth, sparse_points, pr, ref_k),
        depth_range=(float(d_min), float(d_max)),
        points=points,
        colors=colors,
    )


def _prepare(gray: np.ndarray, full: Intrinsics, target: Intrinsics) -> np.ndarray:
    """Undistort and resize to the working resolution in one remap."""
    if np.any(np.abs(full.dist_coeffs) > 0):
        gray = cv2.undistort(gray, full.K, full.dist_coeffs)
    if (target.width, target.height) != (full.width, full.height):
        gray = cv2.resize(gray, (target.width, target.height), interpolation=cv2.INTER_AREA)
    return gray


def _subplane_depth(scores: np.ndarray, idx: np.ndarray, inv: np.ndarray) -> np.ndarray:
    """Parabolic interpolation of the score peak in inverse depth."""
    n = len(inv)
    i0 = np.clip(idx, 1, n - 2)
    rows, cols = np.indices(idx.shape)
    s_m, s_0, s_p = scores[i0 - 1, rows, cols], scores[i0, rows, cols], scores[i0 + 1, rows, cols]
    denom = s_m - 2 * s_0 + s_p
    offset = np.divide(0.5 * (s_m - s_p), denom, out=np.zeros_like(denom), where=np.abs(denom) > 1e-6)
    offset = np.clip(offset, -0.5, 0.5)
    step = inv[1] - inv[0]
    inv_depth = inv[i0] + offset * step
    return 1 / np.maximum(inv_depth, 1e-6)


def _backproject(depth: np.ndarray, k: Intrinsics, pose: Pose, rgb_full: np.ndarray, full: Intrinsics):
    v, u = np.nonzero(depth)
    if len(u) == 0:
        return np.zeros((0, 3), np.float32), np.zeros((0, 3), np.uint8)
    z = depth[v, u]
    x = (u - k.cx) / k.fx * z
    y = (v - k.cy) / k.fy * z
    cam = np.stack([x, y, z], 1)
    world = (cam - pose.t) @ pose.R
    rgb = rgb_full
    if np.any(np.abs(full.dist_coeffs) > 0):
        rgb = cv2.undistort(rgb_full, full.K, full.dist_coeffs)
    rgb = cv2.resize(rgb, (k.width, k.height), interpolation=cv2.INTER_AREA)
    return world.astype(np.float32), rgb[v, u].astype(np.uint8)


def _sparse_agreement(depth: np.ndarray, sparse_points: np.ndarray, pose: Pose, k: Intrinsics) -> float | None:
    cam = sparse_points @ pose.R.T + pose.t
    z = cam[:, 2]
    ok = z > 0
    px = cam[ok] @ k.K.T
    u = np.round(px[:, 0] / px[:, 2]).astype(int)
    v = np.round(px[:, 1] / px[:, 2]).astype(int)
    h, w = depth.shape
    inside = (u >= 0) & (u < w) & (v >= 0) & (v < h)
    d = depth[v[inside], u[inside]]
    ref = z[ok][inside]
    has = d > 0
    if has.sum() < 10:
        return None
    return float(np.median(np.abs(d[has] - ref[has]) / ref[has]))

