import cv2
import numpy as np

from tests.conftest import API, png_bytes


def _add_camera(client, project_id, name=None):
    res = client.post(f"{API}/projects/{project_id}/cameras", json={"name": name} if name else {})
    assert res.status_code == 201, res.text
    return res.json()


def test_camera_labels_and_limit(client, project):
    labels = [_add_camera(client, project["id"])["label"] for _ in range(4)]
    assert labels == ["CAM-01", "CAM-02", "CAM-03", "CAM-04"]
    res = client.post(f"{API}/projects/{project['id']}/cameras", json={})
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "camera_limit"


def test_rename_and_delete_camera(client, project):
    cam = _add_camera(client, project["id"], "North pole")
    assert cam["name"] == "North pole" and cam["status"] == "empty"
    res = client.patch(f"{API}/cameras/{cam['id']}", json={"name": "Gate"})
    assert res.json()["name"] == "Gate"
    assert client.patch(f"{API}/cameras/{cam['id']}", json={"name": " "}).status_code == 422
    assert client.delete(f"{API}/cameras/{cam['id']}").status_code == 204
    assert client.get(f"{API}/cameras/{cam['id']}").status_code == 404


def test_upload_images_and_read_back(client, project):
    cam = _add_camera(client, project["id"])
    files = [("files", (f"f{i}.png", png_bytes(seed=i), "image/png")) for i in range(3)]
    res = client.post(f"{API}/cameras/{cam['id']}/frames", files=files)
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["added"] == 3 and body["skipped"] == []
    assert body["camera"]["frameCount"] == 3
    assert (body["camera"]["width"], body["camera"]["height"]) == (320, 240)

    img = client.get(f"{API}/cameras/{cam['id']}/frames/2/image")
    assert img.status_code == 200 and img.headers["content-type"] == "image/jpeg"
    decoded = cv2.imdecode(np.frombuffer(img.content, np.uint8), cv2.IMREAD_COLOR)
    assert decoded.shape == (240, 320, 3)
    assert client.get(f"{API}/cameras/{cam['id']}/frames/3/image").status_code == 404


def test_bad_files_are_reported_individually(client, project):
    cam = _add_camera(client, project["id"])
    files = [
        ("files", ("good.png", png_bytes(), "image/png")),
        ("files", ("notes.txt", b"hello", "text/plain")),
        ("files", ("broken.jpg", b"\xff\xd8\xff garbage", "image/jpeg")),
        ("files", ("empty.png", b"", "image/png")),
        ("files", ("other-size.png", png_bytes(200, 100), "image/png")),
    ]
    res = client.post(f"{API}/cameras/{cam['id']}/frames", files=files)
    assert res.status_code == 201
    body = res.json()
    assert body["added"] == 1
    reasons = {s["file"]: s["code"] for s in body["skipped"]}
    assert reasons == {
        "notes.txt": "unsupported_media_type",
        "broken.jpg": "invalid_image",
        "empty.png": "validation_failed",
        "other-size.png": "resolution_mismatch",
    }


def test_all_invalid_upload_fails(client, project):
    cam = _add_camera(client, project["id"])
    res = client.post(f"{API}/cameras/{cam['id']}/frames", files=[("files", ("x.gif", b"GIF89a", "image/gif"))])
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "no_valid_images"


def test_oversized_image_is_rejected(client, project):
    cam = _add_camera(client, project["id"])
    big = b"\x89PNG" + b"0" * (3 * 1024 * 1024)  # limit is 2 MB in tests
    res = client.post(f"{API}/cameras/{cam['id']}/frames", files=[("files", ("big.png", big, "image/png"))])
    assert res.status_code == 422
    assert res.json()["error"]["details"]["skipped"][0]["code"] == "payload_too_large"


def test_upload_path_traversal_filename_is_harmless(client, project):
    cam = _add_camera(client, project["id"])
    res = client.post(f"{API}/cameras/{cam['id']}/frames", files=[("files", ("../../evil.png", png_bytes(), "image/png"))])
    assert res.status_code == 201
    # stored under a generated name; the client-supplied path is never used
    assert client.get(f"{API}/cameras/{cam['id']}/frames/0/image").status_code == 200


def test_corrupted_video_is_rejected(client, project):
    cam = _add_camera(client, project["id"])
    res = client.post(f"{API}/cameras/{cam['id']}/video", files={"file": ("clip.mp4", b"not a video" * 100, "video/mp4")})
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "invalid_video"
    assert "hint" in res.json()["error"]


def test_video_upload_extracts_frames(client, project, tmp_path):
    path = tmp_path / "clip.avi"
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"MJPG"), 10, (160, 120))
    for i in range(12):
        frame = np.full((120, 160, 3), i * 20, np.uint8)
        cv2.putText(frame, str(i), (40, 80), cv2.FONT_HERSHEY_SIMPLEX, 2, (255, 255, 255), 3)
        writer.write(frame)
    writer.release()
    cam = _add_camera(client, project["id"])
    with open(path, "rb") as fh:
        res = client.post(f"{API}/cameras/{cam['id']}/video", files={"file": ("clip.avi", fh, "video/x-msvideo")}, data={"stride": "2"})
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["added"] == 6
    assert body["camera"]["sourceKind"] == "video"
    assert abs(body["camera"]["fps"] - 5.0) < 0.01  # 10 fps with stride 2

    again = client.post(f"{API}/cameras/{cam['id']}/frames", files=[("files", ("a.png", png_bytes(160, 120), "image/png"))])
    assert again.status_code == 409


def test_manual_calibration_validation(client, project):
    cam = _add_camera(client, project["id"])
    client.post(f"{API}/cameras/{cam['id']}/frames", files=[("files", ("a.png", png_bytes(), "image/png"))])
    bad_pp = client.post(f"{API}/cameras/{cam['id']}/calibration", json={"method": "manual", "fx": 300, "fy": 300, "cx": 999, "cy": 120})
    assert bad_pp.status_code == 422
    assert "principal point" in bad_pp.json()["error"]["message"]
    missing = client.post(f"{API}/cameras/{cam['id']}/calibration", json={"method": "manual", "fx": 300})
    assert missing.status_code == 422
    ok = client.post(
        f"{API}/cameras/{cam['id']}/calibration",
        json={"method": "manual", "fx": 300, "fy": 301, "cx": 160, "cy": 120, "dist": [0.01, 0, 0, 0]},
    )
    assert ok.status_code == 200
    assert ok.json()["calibration"]["intrinsics"]["dist"] == [0.01, 0, 0, 0, 0]


def test_checkerboard_calibration_needs_visible_board(client, project):
    cam = _add_camera(client, project["id"])
    client.post(f"{API}/cameras/{cam['id']}/frames", files=[("files", (f"{i}.png", png_bytes(seed=i), "image/png")) for i in range(3)])
    res = client.post(
        f"{API}/cameras/{cam['id']}/calibration",
        json={"method": "checkerboard", "patternCols": 9, "patternRows": 6, "squareSizeM": 0.025},
    )
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "calibration_failed"
