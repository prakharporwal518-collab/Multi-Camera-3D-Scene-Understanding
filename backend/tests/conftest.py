"""Test configuration: an isolated SQLite database and storage directory per session.

Environment variables must be set before the app modules are imported, because the
settings and the database engine are created at import time.
"""

import os
import shutil
import tempfile
import time
from pathlib import Path

_TMP = Path(tempfile.mkdtemp(prefix="mc3d-tests-"))
os.environ["DATABASE_URL"] = f"sqlite:///{_TMP / 'test.db'}"
os.environ["STORAGE_DIR"] = str(_TMP / "storage")
os.environ["MAX_IMAGE_MB"] = "2"
os.environ["MAX_CAMERAS"] = "4"
os.environ["PROCESSING_TIMEOUT_S"] = "300"
os.environ["DETECTOR_MODEL_PATH"] = ""

import cv2  # noqa: E402
import numpy as np  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import create_app  # noqa: E402

API = "/api/v1"


@pytest.fixture(scope="session")
def client():
    with TestClient(create_app()) as c:
        yield c
    shutil.rmtree(_TMP, ignore_errors=True)


@pytest.fixture
def project(client):
    res = client.post(f"{API}/projects", json={"name": "Test project"})
    assert res.status_code == 201, res.text
    yield res.json()
    client.delete(f"{API}/projects/{res.json()['id']}")


def png_bytes(width=320, height=240, seed=0) -> bytes:
    rng = np.random.default_rng(seed)
    img = rng.integers(0, 255, (height, width, 3), dtype=np.uint8)
    ok, buf = cv2.imencode(".png", img)
    assert ok
    return buf.tobytes()


def wait_for_run(client, project_id: str, timeout: float = 240) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        run = client.get(f"{API}/projects/{project_id}/runs/latest").json()
        if run and run["status"] not in ("queued", "running"):
            return run
        time.sleep(0.5)
    raise AssertionError("pipeline run did not finish in time")
