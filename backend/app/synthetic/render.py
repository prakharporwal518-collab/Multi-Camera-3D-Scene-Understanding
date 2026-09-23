"""Vectorised ray-caster for :mod:`app.synthetic.scene`.

Produces an RGB image, a metric depth map (camera z) and an instance mask per camera.
Textures are evaluated in world coordinates so they are consistent across views.
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from app.synthetic.scene import Box, Plane, SyntheticScene
from app.vision.camera_model import Intrinsics, Pose

SUN = np.array([0.35, 0.8, -0.45])
SUN = SUN / np.linalg.norm(SUN)
SKY_TOP = np.array([150, 170, 190], np.float32)
SKY_BOTTOM = np.array([200, 205, 210], np.float32)


@dataclass
class RenderResult:
    rgb: np.ndarray  # (H, W, 3) uint8
    depth: np.ndarray  # (H, W) float32, 0 where no surface
    instance: np.ndarray  # (H, W) int16, -1 background, else index into scene.boxes


def _hash(ix: np.ndarray, iy: np.ndarray, seed: int) -> np.ndarray:
    h = (ix * 374761393 + iy * 668265263 + seed * 2147483647) & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((h ^ (h >> 16)) & 0xFFFF).astype(np.float32) / 65535.0


def value_noise(u: np.ndarray, v: np.ndarray, scale: float, seed: int = 0) -> np.ndarray:
    x, y = u / scale, v / scale
    x0, y0 = np.floor(x).astype(np.int64), np.floor(y).astype(np.int64)
    fx, fy = x - x0, y - y0
    fx, fy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    a = _hash(x0, y0, seed)
    b = _hash(x0 + 1, y0, seed)
    c = _hash(x0, y0 + 1, seed)
    d = _hash(x0 + 1, y0 + 1, seed)
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def fractal_noise(u: np.ndarray, v: np.ndarray, base: float, octaves: int = 4, seed: int = 0) -> np.ndarray:
    total, amp, norm = np.zeros_like(u, dtype=np.float32), 1.0, 0.0
    for o in range(octaves):
        total += amp * value_noise(u, v, base / (2**o), seed + o * 17)
        norm += amp
        amp *= 0.55
    return total / norm


def _blotches(u: np.ndarray, v: np.ndarray, scale: float, seed: int, level: float = 0.68) -> np.ndarray:
    """Sparse dark stains with sharp edges; they give the feature detector distinctive corners."""
    n = value_noise(u, v, scale, seed) * 0.7 + value_noise(u, v, scale / 3, seed + 5) * 0.3
    return np.clip((n - level) * 6, 0, 1)


def _ground_texture(x: np.ndarray, z: np.ndarray) -> np.ndarray:
    n = fractal_noise(x, z, 0.8, 6, seed=3)
    n = n - 0.5 * _blotches(x, z, 0.35, 41) + 0.25 * _blotches(x, z, 0.22, 43)
    road = x < 0.5
    col = np.empty(x.shape + (3,), np.float32)
    asphalt = 70 + 60 * n
    col[...] = asphalt[..., None] * np.array([1.0, 1.0, 1.03])
    # sidewalk tiles
    tile = (np.abs(((x - 0.5) % 1.2) - 0.6) > 0.57) | (np.abs((z % 1.2) - 0.6) > 0.57)
    side = 140 + 50 * n - 45 * tile
    col[~road] = (side[~road, None] * np.array([1.0, 0.97, 0.92]))
    # curb
    curb = (x >= 0.35) & (x < 0.65)
    col[curb] = (175 + 30 * n[curb])[:, None]
    # dashed centre line and crosswalk
    dash = road & (np.abs(x + 2.7) < 0.08) & ((z % 4.0) < 2.2)
    col[dash] = np.array([210, 190, 90]) * (0.85 + 0.15 * n[dash, None])
    cross = road & (z > 1.0) & (z < 3.5) & (((x + 20) % 1.0) < 0.5)
    col[cross] = 205 + 30 * n[cross, None]
    return col


def _facade_texture(u: np.ndarray, v: np.ndarray, seed: int) -> np.ndarray:
    n = fractal_noise(u, v, 0.5, 6, seed) - 0.6 * _blotches(u, v, 0.4, seed + 3)
    cell_u, cell_v = np.floor(u / 3.0).astype(np.int64), np.floor(v / 3.0).astype(np.int64)
    tint = np.stack([_hash(cell_u, cell_v, seed + k) for k in range(3)], -1)
    base = np.stack([150 + 55 * n, 120 + 50 * n, 100 + 45 * n], -1) * (0.8 + 0.4 * tint)
    # posters / signage: coloured rectangles that break the window grid's repetition
    poster = (_hash(cell_u, cell_v, seed + 7) > 0.72) & ((u % 3.0) > 0.4) & ((u % 3.0) < 1.3) & ((v % 3.0) < 0.75)
    base[poster] = (60 + 180 * tint[poster]) * (0.7 + 0.5 * n[poster, None])
    wu, wv = (u % 3.0), (v % 3.0)
    window = (wu > 0.7) & (wu < 2.3) & (wv > 0.9) & (wv < 2.4) & (v > 0.8)
    glass = 40 + 70 * fractal_noise(u, v, 0.3, 4, seed + 9)
    base[window] = glass[window, None] * np.array([0.8, 0.9, 1.05])
    frame = window & ((np.abs(wu - 1.5) < 0.04) | (np.abs(wv - 1.65) < 0.04))
    base[frame] = 200
    return base


def _intersect_plane(origin: np.ndarray, dirs: np.ndarray, plane: Plane) -> tuple[np.ndarray, np.ndarray]:
    a = plane.axis
    denom = dirs[:, a]
    with np.errstate(divide="ignore", invalid="ignore"):
        t = (plane.offset - origin[a]) / denom
    hit = origin + t[:, None] * dirs
    others = [k for k in range(3) if k != a]
    (lo0, hi0), (lo1, hi1) = plane.bounds
    ok = (t > 0) & (hit[:, others[0]] >= lo0) & (hit[:, others[0]] <= hi0)
    ok &= (hit[:, others[1]] >= lo1) & (hit[:, others[1]] <= hi1)
    ok &= np.sign(-denom) == plane.facing
    return np.where(ok, t, np.inf), hit


def _intersect_box(origin: np.ndarray, dirs: np.ndarray, box: Box) -> tuple[np.ndarray, np.ndarray]:
    """Slab test in the box frame. Returns hit distance and the local-frame face normal."""
    c, s = np.cos(box.yaw), np.sin(box.yaw)
    Ry = np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])  # local -> world
    o = Ry.T @ (origin - box.center)
    d = dirs @ Ry  # == (Ry.T @ dirs.T).T
    half = box.size / 2
    with np.errstate(divide="ignore", invalid="ignore"):
        t1 = (-half - o) / d
        t2 = (half - o) / d
    tmin = np.minimum(t1, t2)
    tmax = np.maximum(t1, t2)
    t_near = np.nanmax(tmin, axis=1)
    t_far = np.nanmin(tmax, axis=1)
    ok = (t_far >= t_near) & (t_far > 0) & (t_near > 0)
    axis = np.argmax(tmin, axis=1)
    local_normal = np.zeros_like(d)
    local_normal[np.arange(len(d)), axis] = -np.sign(d[np.arange(len(d)), axis])
    normal = local_normal @ Ry.T
    return np.where(ok, t_near, np.inf), normal


def _box_color(box: Box, local: np.ndarray, normal: np.ndarray, seed: int) -> np.ndarray:
    base = np.array(box.color, np.float32)
    u = local[:, 0] + local[:, 2]
    v = local[:, 1]
    n = fractal_noise(u, v, 0.15, 5, seed) - 0.5 * _blotches(u, v, 0.18, seed + 1)
    col = base[None, :] * (0.7 + 0.6 * n[:, None])
    if box.texture == "panels":
        top = v > box.size[1] * 0.1
        side = np.abs(normal[:, 1]) < 0.5
        glass = top & side & (v < box.size[1] * 0.42)
        col[glass] = (40 + 50 * n[glass])[:, None] * np.array([0.85, 0.95, 1.1])
        seam = (np.abs(((u + 10) % 1.1) - 0.55) < 0.02) & side
        col[seam] *= 0.6
        lights = (v < -box.size[1] * 0.2) & (v > -box.size[1] * 0.32) & (np.abs(normal[:, 1]) < 0.5)
        col[lights] = np.array([230, 225, 200])
    return col


def render(scene: SyntheticScene, intr: Intrinsics, pose: Pose, supersample: int = 2, seed: int = 0) -> RenderResult:
    W, H = intr.width * supersample, intr.height * supersample
    # Sub-pixel sample positions chosen so that, after box-filter down-sampling, output pixel
    # i is centred on u = i (the OpenCV convention the rest of the pipeline assumes).
    offset = 0.5 - 0.5 * supersample
    uu, vv = np.meshgrid(np.arange(W) + offset, np.arange(H) + offset)
    K = intr.K.copy()
    K[:2] *= supersample
    rays_cam = np.stack([(uu - K[0, 2]) / K[0, 0], (vv - K[1, 2]) / K[1, 1], np.ones_like(uu)], -1).reshape(-1, 3)
    dirs = rays_cam @ pose.R  # camera -> world rotation is R.T, i.e. d_w = R.T d_c
    origin = pose.center

    n_rays = len(dirs)
    best_t = np.full(n_rays, np.inf)
    color = np.zeros((n_rays, 3), np.float32)
    normal = np.zeros((n_rays, 3), np.float32)
    instance = np.full(n_rays, -1, np.int16)

    for p_idx, plane in enumerate(scene.planes):
        t, hit = _intersect_plane(origin, dirs, plane)
        closer = t < best_t
        if not closer.any():
            continue
        best_t[closer] = t[closer]
        h = hit[closer]
        if plane.texture == "ground":
            color[closer] = _ground_texture(h[:, 0], h[:, 2])
        elif plane.axis == 2:
            color[closer] = _facade_texture(h[:, 0], h[:, 1], seed=31 + p_idx)
        else:
            color[closer] = _facade_texture(h[:, 2], h[:, 1], seed=31 + p_idx)
        nrm = np.zeros(3)
        nrm[plane.axis] = plane.facing
        normal[closer] = nrm
        instance[closer] = -1

    for b_idx, box in enumerate(scene.boxes):
        t, nrm = _intersect_box(origin, dirs, box)
        closer = t < best_t
        if not closer.any():
            continue
        best_t[closer] = t[closer]
        hit = origin + t[closer, None] * dirs[closer]
        c, s = np.cos(box.yaw), np.sin(box.yaw)
        Ry = np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
        local = (hit - box.center) @ Ry
        color[closer] = _box_color(box, local, nrm[closer] @ Ry, seed=101 + b_idx)
        normal[closer] = nrm[closer]
        instance[closer] = b_idx

    hit_any = np.isfinite(best_t)
    shade = 0.55 + 0.5 * np.clip(normal @ SUN, 0, 1)
    color *= shade[:, None]
    sky_mix = np.clip((vv.reshape(-1) / H), 0, 1)[:, None]
    sky = SKY_TOP * (1 - sky_mix) + SKY_BOTTOM * sky_mix
    color[~hit_any] = sky[~hit_any]

    # depth along the optical axis
    depth = np.where(hit_any, best_t * rays_cam[:, 2], 0).astype(np.float32)

    rgb = color.reshape(H, W, 3)
    depth = depth.reshape(H, W)
    inst = instance.reshape(H, W)
    if supersample > 1:
        rgb = cv2.resize(rgb, (intr.width, intr.height), interpolation=cv2.INTER_AREA)
        depth = depth[supersample // 2 :: supersample, supersample // 2 :: supersample]
        inst = inst[supersample // 2 :: supersample, supersample // 2 :: supersample]

    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0 : intr.height, 0 : intr.width]
    r2 = ((xx - intr.cx) / intr.width) ** 2 + ((yy - intr.cy) / intr.height) ** 2
    rgb = rgb * (1 - 0.35 * r2)[..., None] + rng.normal(0, 2.0, rgb.shape)
    return RenderResult(np.clip(rgb, 0, 255).astype(np.uint8), depth.astype(np.float32), inst)
