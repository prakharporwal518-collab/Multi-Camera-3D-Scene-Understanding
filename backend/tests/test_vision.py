import cv2
import numpy as np
import pytest

from app.core.errors import ProcessingError, ValidationFailed
from app.detection.onnx_detector import decode_yolo_output
from app.pipeline.scene_writer import read_points, write_depth_png, write_points
from app.synthetic.render import render
from app.synthetic.scene import build_street_scene, street_cameras
from app.vision.calibration import calibrate_checkerboard, validate_manual_intrinsics
from app.vision.features import detect_features, match_features


K_TRUE = np.array([[620.0, 0, 330.0], [0, 620.0, 235.0], [0, 0, 1]])


def _board_images(n=8, cols=7, rows=5, square_px=40, square_m=0.03):
    """Render a planar board through a known pinhole camera from several tilted poses."""
    margin = 40
    board = np.full(((rows + 1) * square_px + 2 * margin, (cols + 1) * square_px + 2 * margin), 255, np.uint8)
    for r in range(rows + 1):
        for c in range(cols + 1):
            if (r + c) % 2 == 0:
                y, x = margin + r * square_px, margin + c * square_px
                board[y : y + square_px, x : x + square_px] = 0
    # board pixel -> metric plane coordinates, origin at the board centre
    s = square_m / square_px
    h, w = board.shape
    S = np.array([[s, 0, -w * s / 2], [0, s, -h * s / 2], [0, 0, 1]])
    rng = np.random.default_rng(3)
    images = []
    for _ in range(n):
        rvec = rng.uniform(-0.45, 0.45, 3) * np.array([1, 1, 0.3])
        R = cv2.Rodrigues(rvec)[0]
        t = np.array([rng.uniform(-0.03, 0.03), rng.uniform(-0.03, 0.03), rng.uniform(0.38, 0.5)])
        H = K_TRUE @ np.column_stack([R[:, 0], R[:, 1], t]) @ S
        images.append(cv2.warpPerspective(board, H, (640, 480), borderValue=180))
    return images


def test_checkerboard_calibration_on_synthetic_boards():
    out = calibrate_checkerboard(_board_images(), 7, 5, 0.03)
    assert out.views_used >= 3
    assert out.reprojection_error_px < 0.5
    assert out.intrinsics.fx == pytest.approx(620, rel=0.02)
    assert out.intrinsics.cx == pytest.approx(330, abs=8)
    assert out.quality == "good"


def test_checkerboard_with_wrong_pattern_size_fails_clearly():
    with pytest.raises(ProcessingError) as exc:
        calibrate_checkerboard(_board_images(3), 9, 6, 0.03)
    assert exc.value.code == "calibration_failed"
    assert "9 x 6" in exc.value.hint


def test_manual_intrinsics_reject_nonsense():
    with pytest.raises(ValidationFailed):
        validate_manual_intrinsics({"fx": 500, "fy": 1500, "cx": 320, "cy": 240}, 640, 480)
    intr = validate_manual_intrinsics({"fx": 500, "fy": 510, "cx": 320, "cy": 240, "dist": [0.1, 0, 0, 0]}, 640, 480)
    assert intr.dist == [0.1, 0, 0, 0, 0.0]


@pytest.fixture(scope="module")
def street_pair():
    scene, _ = build_street_scene()
    cams = street_cameras(640, 360)
    grays = []
    for _, intr, pose in cams[1:3]:
        rgb = render(scene, intr, pose, supersample=1).rgb
        grays.append(cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY))
    return grays


@pytest.mark.parametrize("detector", ["sift", "orb", "akaze"])
def test_matching_on_rendered_views(street_pair, detector):
    a = detect_features(street_pair[0], detector, 3000)
    b = detect_features(street_pair[1], detector, 3000)
    m = match_features(a, b, 0.8)
    assert m.num_inliers >= 40, (detector, m.num_tentative, m.num_inliers)
    assert m.inlier_ratio > 0.4


def test_matching_ratio_is_validated(street_pair):
    a = detect_features(street_pair[0], "orb", 500)
    with pytest.raises(ValidationFailed):
        match_features(a, a, 1.5)


def test_point_file_roundtrip(tmp_path):
    rng = np.random.default_rng(0)
    sparse, dense = rng.normal(size=(10, 3)).astype(np.float32), rng.normal(size=(25, 3)).astype(np.float32)
    info = write_points(tmp_path / "p.bin", sparse, np.zeros((10, 3), np.uint8), dense, np.ones((25, 3), np.uint8) * 7)
    assert info["count"] == 35 and (tmp_path / "p.bin").stat().st_size == 35 * 16
    pts, cols, layer = read_points(tmp_path / "p.bin")
    assert (layer == 0).sum() == 10 and (layer == 1).sum() == 25
    assert np.all(cols[layer == 1] == 7)
    assert np.allclose(np.sort(pts[layer == 0][:, 0]), np.sort(sparse[:, 0]))


def test_depth_png_encoding_roundtrip(tmp_path):
    depth = np.zeros((20, 30), np.float32)
    depth[5:15, 5:25] = np.linspace(2.0, 40.0, 200).reshape(10, 20)
    conf = np.where(depth > 0, 0.5, 0).astype(np.float32)
    info = write_depth_png(tmp_path / "d.png", depth, conf)
    bgr = cv2.imread(str(tmp_path / "d.png"), cv2.IMREAD_COLOR)
    q = bgr[..., 2].astype(np.int64) * 256 + bgr[..., 1]
    decoded = q * info["encoding"]["step"]
    assert np.all((q > 0) == (depth > 0))
    assert np.abs(decoded - depth).max() < info["encoding"]["step"]
    assert abs(bgr[8, 8, 0] / 255 - 0.5) < 0.01


def test_yolo_output_decoding():
    labels = ["person", "car"]
    out = np.zeros((1, 6, 3), np.float32)
    # anchor 0: car at (100, 100) 40x20; anchor 1: overlapping weaker car; anchor 2: low score
    out[0, :, 0] = [100, 100, 40, 20, 0.1, 0.9]
    out[0, :, 1] = [102, 101, 40, 20, 0.1, 0.6]
    out[0, :, 2] = [300, 300, 10, 10, 0.2, 0.1]
    dets = decode_yolo_output(out, labels, scale=0.5, pad=(0, 20), conf_threshold=0.3, nms_threshold=0.5)
    assert len(dets) == 1
    d = dets[0]
    assert d.cls == "car" and d.confidence == pytest.approx(0.9)
    assert d.box == pytest.approx((160.0, 140.0, 240.0, 180.0))
