"""End-to-end: upload rendered frames for three cameras, run the pipeline, read the scene."""

import cv2
import numpy as np
import pytest

from app.synthetic.render import render
from app.synthetic.scene import build_street_scene, street_cameras
from tests.conftest import API, wait_for_run


@pytest.fixture(scope="module")
def rendered_frames():
    scene, _ = build_street_scene()
    frames = []
    for _, intr, pose in street_cameras(800, 450)[:3]:
        rgb = render(scene, intr, pose, supersample=1).rgb
        ok, buf = cv2.imencode(".png", cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR))
        frames.append(buf.tobytes())
    return frames


def test_full_pipeline_on_synthetic_frames(client, project, rendered_frames):
    pid = project["id"]
    cam_ids = []
    for i, png in enumerate(rendered_frames):
        cam = client.post(f"{API}/projects/{pid}/cameras", json={}).json()
        res = client.post(f"{API}/cameras/{cam['id']}/frames", files=[("files", (f"cam{i}.png", png, "image/png"))])
        assert res.status_code == 201
        cam_ids.append(cam["id"])

    config = project["config"] | {"depth": project["config"]["depth"] | {"numPlanes": 48, "workingWidth": 320}}
    assert client.patch(f"{API}/projects/{pid}", json={"config": config}).status_code == 200

    assert client.post(f"{API}/projects/{pid}/runs", json={}).status_code == 202
    # a second run while one is active is refused
    second = client.post(f"{API}/projects/{pid}/runs", json={})
    assert second.status_code in (202, 409)
    run = wait_for_run(client, pid)
    assert run["status"] == "completed", run
    status = {s["id"]: s["status"] for s in run["stages"]}
    assert status["pose_estimation"] in ("completed", "warning")
    # nothing is simulated in real projects: without a detector these stages are skipped
    assert status["object_detection"] == "skipped"
    assert status["tracking"] == "skipped"

    scene = client.get(f"{API}/scene/{pid}").json()
    assert scene["source"] == "pipeline"
    assert scene["provenance"]["detections"] == "none"
    assert scene["stats"]["registeredCameras"] == 3
    assert scene["pointCloud"]["sparseCount"] > 100
    assert scene["stale"] is False
    assert all(c["calibration"]["method"] == "assumed" for c in scene["cameras"])

    points = client.get(f"{API}/scene/{pid}/files/points.bin")
    assert points.status_code == 200 and len(points.content) == scene["pointCloud"]["count"] * 16
    ply = client.get(f"{API}/projects/{pid}/export", params={"format": "ply"})
    assert ply.status_code == 200 and ply.content.startswith(b"ply\n")
    assert client.get(f"{API}/scene/{pid}/files/secret.txt").status_code == 404

    # changing inputs marks the scene as stale
    client.patch(f"{API}/cameras/{cam_ids[0]}", json={"name": "renamed"})  # renaming does not
    assert client.get(f"{API}/projects/{pid}").json()["sceneStale"] is False
    client.delete(f"{API}/cameras/{cam_ids[2]}")
    assert client.get(f"{API}/projects/{pid}").json()["sceneStale"] is True

    match = client.post(f"{API}/projects/{pid}/feature-matching", json={"cameraA": cam_ids[0], "cameraB": cam_ids[1], "detector": "orb", "ratio": 0.8})
    assert match.status_code == 200
    body = match.json()
    assert body["inliers"] > 20 and len(body["matches"]) == body["tentative"]
    same = client.post(f"{API}/projects/{pid}/feature-matching", json={"cameraA": cam_ids[0], "cameraB": cam_ids[0]})
    assert same.status_code == 422
