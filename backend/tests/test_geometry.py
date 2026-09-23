"""Sparse reconstruction on synthetic correspondences (no images involved)."""

import numpy as np

from app.reconstruction.geometry import umeyama
from app.reconstruction.sfm import IncrementalSfm, View, build_tracks
from app.synthetic.scene import look_at
from app.vision.camera_model import Intrinsics
from app.vision.features import Features, MatchResult


def _synthetic_views(n_cams=4, n_points=600, noise_px=0.3, seed=0):
    rng = np.random.default_rng(seed)
    points = np.column_stack([rng.uniform(-6, 6, n_points), rng.uniform(0, 3, n_points), rng.uniform(6, 16, n_points)])
    target = np.array([0, 1, 11.0])
    intr = Intrinsics(800, 800, 400, 300, 800, 600)
    poses, views = [], []
    for i in range(n_cams):
        eye = np.array([-6 + 4 * i, 3.5, -2.0 + 0.5 * i])
        pose = look_at(eye, target)
        cam = points @ pose.R.T + pose.t
        px = cam @ intr.K.T
        px = px[:, :2] / px[:, 2:3] + rng.normal(0, noise_px, (n_points, 2))
        poses.append(pose)
        feats = Features(px.astype(np.float32), None, "sift", 0.0)
        views.append(View(f"c{i}", f"CAM-0{i + 1}", intr, feats, np.zeros((600, 800, 3), np.uint8)))
    return points, poses, views


def _matches(n_cams, n_points, outlier_rate=0.05, seed=1):
    rng = np.random.default_rng(seed)
    out = {}
    for i in range(n_cams):
        for j in range(i + 1, n_cams):
            idx = np.arange(n_points)
            inlier = rng.random(n_points) > outlier_rate
            out[(i, j)] = MatchResult(idx, idx, np.full(n_points, 0.5), inlier, None, 0.0)
    return out


def test_tracks_link_pairwise_matches():
    matches = _matches(3, 50, outlier_rate=0.0)
    tracks = build_tracks(3, [50, 50, 50], matches)
    assert len(tracks) == 50
    assert all(len(t) == 3 for t in tracks)


def test_incremental_sfm_recovers_cameras_up_to_similarity():
    points, poses, views = _synthetic_views()
    result = IncrementalSfm(views, _matches(len(views), len(points))).run()
    assert sorted(result.poses) == [0, 1, 2, 3]
    assert result.point_errors.mean() < 1.0
    est = np.array([result.poses[i].center for i in range(4)])
    gt = np.array([p.center for p in poses])
    s, R, t = umeyama(est, gt)
    err = np.linalg.norm(s * est @ R.T + t - gt, axis=1)
    assert err.max() < 0.05  # metres, with 0.3 px noise
    # bundle adjustment should not make things worse
    assert result.ba_reports[-1].final_rms_px <= result.ba_reports[0].initial_rms_px + 1e-6


def test_insufficient_matches_raise_readable_error():
    import pytest

    from app.core.errors import ProcessingError

    points, _, views = _synthetic_views(n_cams=2, n_points=20)
    with pytest.raises(ProcessingError) as exc:
        IncrementalSfm(views, _matches(2, 20)).run()
    assert exc.value.code == "insufficient_matches"
    assert "CAM-01" in exc.value.message and exc.value.hint
