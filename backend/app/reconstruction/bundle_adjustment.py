"""Levenberg-Marquardt bundle adjustment with a Schur complement on the point blocks.

Observations are undistorted normalized coordinates, residuals are scaled by the focal
length so the cost is (approximately) in pixels. A Huber loss limits the influence of
remaining outliers. The first camera is held fixed to remove the rotation/translation
gauge; the global scale gauge is left to the damping term.
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from app.vision.camera_model import Pose


@dataclass
class BAReport:
    initial_rms_px: float
    final_rms_px: float
    iterations: int
    observations: int


def _skew(v: np.ndarray) -> np.ndarray:
    """Batched skew-symmetric matrices, v: (N, 3) -> (N, 3, 3)."""
    z = np.zeros(len(v))
    return np.stack(
        [np.stack([z, -v[:, 2], v[:, 1]], -1), np.stack([v[:, 2], z, -v[:, 0]], -1), np.stack([-v[:, 1], v[:, 0], z], -1)],
        1,
    )


def _residuals(R, t, X, cam_idx, pt_idx, obs, focal):
    Xc = np.einsum("nij,nj->ni", R[cam_idx], X[pt_idx]) + t[cam_idx]
    z = Xc[:, 2:3]
    return (Xc[:, :2] / z - obs) * focal[:, None], Xc


def _huber_weights(r: np.ndarray, delta: float) -> np.ndarray:
    norm = np.linalg.norm(r, axis=1)
    return np.where(norm <= delta, 1.0, delta / np.maximum(norm, 1e-12))


def bundle_adjust(
    poses: list[Pose],
    points: np.ndarray,
    cam_idx: np.ndarray,
    pt_idx: np.ndarray,
    obs_normalized: np.ndarray,
    focal: np.ndarray,
    fixed_cameras: tuple[int, ...] = (0,),
    iterations: int = 25,
    huber_px: float = 2.0,
) -> tuple[list[Pose], np.ndarray, BAReport]:
    n_cam, n_pt = len(poses), len(points)
    R = np.stack([p.R for p in poses]).astype(np.float64)
    t = np.stack([p.t for p in poses]).astype(np.float64)
    X = points.astype(np.float64).copy()
    free = np.array([c not in fixed_cameras for c in range(n_cam)])
    cam_slot = np.cumsum(free) - 1  # index of each free camera in the reduced system
    n_free = int(free.sum())

    def cost(R_, t_, X_):
        r, Xc = _residuals(R_, t_, X_, cam_idx, pt_idx, obs_normalized, focal)
        w = _huber_weights(r, huber_px)
        return float((w * (r**2).sum(1)).sum()), r, Xc, w

    current, r, Xc, w = cost(R, t, X)
    initial_rms = float(np.sqrt((r**2).sum(1).mean()))
    lam = 1e-3
    it = 0
    for it in range(1, iterations + 1):
        z = Xc[:, 2]
        # d(residual)/d(Xc): (N, 2, 3)
        dpi = np.zeros((len(z), 2, 3))
        dpi[:, 0, 0] = 1 / z
        dpi[:, 1, 1] = 1 / z
        dpi[:, 0, 2] = -Xc[:, 0] / z**2
        dpi[:, 1, 2] = -Xc[:, 1] / z**2
        dpi *= focal[:, None, None]
        J_pt = dpi @ R[cam_idx]  # (N, 2, 3)
        RX = np.einsum("nij,nj->ni", R[cam_idx], X[pt_idx])
        J_cam = np.concatenate([dpi @ -_skew(RX), dpi], axis=2)  # (N, 2, 6): [rotation, translation]

        sw = w[:, None, None]
        # Point blocks
        Hpp = np.zeros((n_pt, 3, 3))
        np.add.at(Hpp, pt_idx, np.einsum("nki,nkj->nij", J_pt * sw, J_pt))
        bp = np.zeros((n_pt, 3))
        np.add.at(bp, pt_idx, -np.einsum("nki,nk->ni", J_pt * sw, r))
        # Camera blocks (free cameras only)
        mask = free[cam_idx]
        slot = cam_slot[cam_idx]
        Hcc = np.zeros((n_free * 6, n_free * 6))
        bc = np.zeros(n_free * 6)
        Jc_m, Jp_m, r_m, w_m, s_m, p_m = J_cam[mask], J_pt[mask], r[mask], w[mask], slot[mask], pt_idx[mask]
        blocks = np.einsum("nki,nkj->nij", Jc_m * w_m[:, None, None], Jc_m)
        for c in range(n_free):
            sel = s_m == c
            Hcc[c * 6 : c * 6 + 6, c * 6 : c * 6 + 6] = blocks[sel].sum(0)
            bc[c * 6 : c * 6 + 6] = -np.einsum("nki,nk->i", Jc_m[sel] * w_m[sel, None, None], r_m[sel])
        Hcp_obs = np.einsum("nki,nkj->nij", Jc_m * w_m[:, None, None], Jp_m)  # (M, 6, 3)

        improved = False
        for _ in range(10):
            Hpp_d = Hpp + lam * (Hpp * np.eye(3)) + 1e-9 * np.eye(3)
            Hpp_inv = np.linalg.inv(Hpp_d)
            # Schur complement S = Hcc - Hcp Hpp^-1 Hpc, accumulated observation pair by observation pair
            S = Hcc + lam * np.diag(np.diag(Hcc)) + 1e-9 * np.eye(len(Hcc))
            rhs = bc.copy()
            W_inv = np.einsum("nij,njk->nik", Hcp_obs, Hpp_inv[p_m])  # (M, 6, 3)
            np.add.at(rhs.reshape(n_free, 6), s_m, -np.einsum("nij,nj->ni", W_inv, bp[p_m]))
            # cross terms between cameras that share a point
            order = np.argsort(p_m, kind="stable")
            p_sorted = p_m[order]
            starts = np.flatnonzero(np.r_[True, p_sorted[1:] != p_sorted[:-1]])
            ends = np.r_[starts[1:], len(p_sorted)]
            for s0, e0 in zip(starts, ends):
                ids = order[s0:e0]
                for a in ids:
                    ca = s_m[a] * 6
                    for b in ids:
                        cb = s_m[b] * 6
                        S[ca : ca + 6, cb : cb + 6] -= W_inv[a] @ Hcp_obs[b].T
            try:
                dc = np.linalg.solve(S, rhs) if n_free else np.zeros(0)
            except np.linalg.LinAlgError:
                lam *= 10
                continue
            # back-substitute points
            rhs_p = bp.copy()
            np.add.at(rhs_p, p_m, -np.einsum("nji,nj->ni", Hcp_obs, dc.reshape(n_free, 6)[s_m]))
            dp = np.einsum("nij,nj->ni", Hpp_inv, rhs_p)

            R_new, t_new = R.copy(), t.copy()
            for c in np.flatnonzero(free):
                d = dc[cam_slot[c] * 6 : cam_slot[c] * 6 + 6]
                R_new[c] = cv2.Rodrigues(d[:3])[0] @ R[c]
                t_new[c] = t[c] + d[3:]
            X_new = X + dp
            new_cost, r_new, Xc_new, w_new = cost(R_new, t_new, X_new)
            if new_cost < current and np.all(Xc_new[:, 2] > 0):
                R, t, X = R_new, t_new, X_new
                gain = (current - new_cost) / max(current, 1e-12)
                current, r, Xc, w = new_cost, r_new, Xc_new, w_new
                lam = max(lam / 3, 1e-9)
                improved = True
                break
            lam *= 10
        if not improved or gain < 1e-7:
            break

    final_rms = float(np.sqrt((r**2).sum(1).mean()))
    new_poses = [Pose(R[c], t[c]) for c in range(n_cam)]
    return new_poses, X, BAReport(initial_rms, final_rms, it, len(cam_idx))
