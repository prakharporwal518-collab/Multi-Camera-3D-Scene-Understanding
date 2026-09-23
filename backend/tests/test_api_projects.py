from tests.conftest import API


def test_health_reports_database_and_detector(client):
    body = client.get(f"{API}/health").json()
    assert body["status"] == "ok"
    assert body["database"] == "ok"
    assert body["detector"]["status"] == "not_configured"
    assert body["limits"]["maxCameras"] == 4


def test_project_crud_roundtrip(client):
    created = client.post(f"{API}/projects", json={"name": "  Parking   lot ", "description": "north side"})
    assert created.status_code == 201
    p = created.json()
    assert p["name"] == "Parking lot"  # whitespace normalised
    assert p["cameraCount"] == 0 and p["hasScene"] is False
    assert p["config"]["detector"] == "sift"

    listed = client.get(f"{API}/projects").json()
    assert any(x["id"] == p["id"] for x in listed)

    patched = client.patch(f"{API}/projects/{p['id']}", json={"name": "Renamed"})
    assert patched.status_code == 200 and patched.json()["name"] == "Renamed"

    assert client.delete(f"{API}/projects/{p['id']}").status_code == 204
    missing = client.get(f"{API}/projects/{p['id']}")
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "not_found"


def test_project_name_validation(client):
    for bad in ["", "   ", "a" * 200, "bad\x00name"]:
        res = client.post(f"{API}/projects", json={"name": bad})
        assert res.status_code == 422, bad
        err = res.json()["error"]
        assert err["code"] == "validation_failed"
        assert err["message"]


def test_unknown_fields_are_rejected(client):
    res = client.post(f"{API}/projects", json={"name": "x", "admin": True})
    assert res.status_code == 422


def test_config_ranges_are_enforced(client, project):
    config = project["config"] | {"matchRatio": 1.5}
    res = client.patch(f"{API}/projects/{project['id']}", json={"config": config})
    assert res.status_code == 422
    assert "matchRatio" in res.json()["error"]["message"]

    ok = project["config"] | {"matchRatio": 0.8, "baselineMeters": 2.5}
    res = client.patch(f"{API}/projects/{project['id']}", json={"config": ok})
    assert res.status_code == 200
    assert res.json()["config"]["baselineMeters"] == 2.5


def test_scene_missing_is_a_clear_404(client, project):
    res = client.get(f"{API}/scene/{project['id']}")
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "scene_not_found"
    assert "hint" in res.json()["error"]


def test_run_without_cameras_fails_with_explanation(client, project):
    from tests.conftest import wait_for_run

    res = client.post(f"{API}/projects/{project['id']}/runs", json={"fromStage": "input"})
    assert res.status_code == 202
    run = wait_for_run(client, project["id"])
    assert run["status"] == "failed"
    stage = run["stages"][0]
    assert stage["id"] == "input" and stage["status"] == "failed"
    assert stage["error"]["code"] == "missing_camera_input"
    assert "two cameras" in stage["error"]["message"]
    assert all(s["status"] == "waiting" for s in run["stages"][1:])


def test_restarting_later_stage_without_reconstruction_fails(client, project):
    from tests.conftest import wait_for_run

    client.post(f"{API}/projects/{project['id']}/cameras", json={})
    client.post(f"{API}/projects/{project['id']}/cameras", json={})
    res = client.post(f"{API}/projects/{project['id']}/detection")
    assert res.status_code == 202
    run = wait_for_run(client, project["id"])
    assert run["status"] == "failed"


def test_path_like_ids_are_rejected(client):
    res = client.get(f"{API}/scene/..%2F..%2Fetc/files/points.bin")
    assert res.status_code in (404, 422)


def test_failed_rerun_keeps_previous_results(client, project, tmp_path):
    """A re-run that fails must not delete the last good reconstruction."""
    from app.services import storage
    from tests.conftest import wait_for_run

    results = storage.results_dir(project["id"])
    results.mkdir(parents=True, exist_ok=True)
    storage.write_json(results / "scene.json", {"marker": True})
    client.post(f"{API}/projects/{project['id']}/runs", json={})
    run = wait_for_run(client, project["id"])
    assert run["status"] == "failed"  # no cameras
    assert storage.read_json(results / "scene.json") == {"marker": True}
    assert not list(storage.project_dir(project["id"]).glob("staging-*"))
