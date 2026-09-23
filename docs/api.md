# REST API

Base URL: `/api/v1`. Interactive docs (Swagger UI) are served at `/api/v1/docs` when the backend runs.

All request and response bodies are JSON with camelCase keys, except uploads (multipart) and binary result files.

## Errors

Every error has the same shape and a status code that matches the problem:

```json
{
  "error": {
    "code": "insufficient_matches",
    "message": "Reconstruction could not start: the best camera pair (CAM-01 / CAM-03) has only 12 verified feature matches, and at least 40 are needed.",
    "hint": "Use frames with more visual overlap between cameras, add texture to the scene, or relax the matching ratio in the project settings.",
    "details": {}
  }
}
```

| Status | Typical codes |
| --- | --- |
| 404 | `not_found`, `scene_not_found` |
| 409 | `conflict` (e.g. a run is already in progress) |
| 413 | `payload_too_large` |
| 415 | `unsupported_media_type` |
| 422 | `validation_failed`, `invalid_image`, `invalid_video`, `resolution_mismatch`, `calibration_failed`, `no_valid_images` |
| 500 | `internal_error` (message is generic; details stay in the server log) |
| 503 | `service_unavailable`, `detector_unavailable` |

Pipeline stage failures are not HTTP errors (runs are asynchronous); they are stored on the run and returned by `GET /projects/{id}/runs/latest` with the same `{code, message, hint}` fields.

## Health

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/health` | Database status, detector status, upload limits, version |

## Projects

| Method | Path | Body / notes |
| --- | --- | --- |
| GET | `/projects` | List, most recently updated first |
| POST | `/projects` | `{name, description?}` → 201 |
| GET | `/projects/{id}` | Includes `cameraCount`, `frameCount`, `hasScene`, `sceneStale`, `lastRun` |
| PATCH | `/projects/{id}` | `{name?, description?, config?}`. Config ranges are validated (see below) |
| DELETE | `/projects/{id}` | 204. Removes cameras, frames and results |

Processing config (all fields required when `config` is sent):

| Field | Range | Default |
| --- | --- | --- |
| `detector` | `sift` \| `orb` \| `akaze` | `sift` |
| `maxFeatures` | 500–20000 | 6000 |
| `matchRatio` | 0.5–0.95 | 0.75 |
| `referenceFrame` | ≥ 0 | 0 |
| `baselineMeters` | > 0 or `null` | `null` (relative scale) |
| `maxTimesteps` | 1–120 | 20 |
| `timestepStride` | 1–100 | 1 |
| `nearDistance` | > 0, ≤ 50 | 2.0 |
| `voxelSize` | > 0, ≤ 1 | 0.04 |
| `depth.numPlanes` | 16–256 | 128 |
| `depth.window` | 3–21 | 9 |
| `depth.workingWidth` | 256–1920 | 640 |
| `depth.minScore` | 0.1–0.95 | 0.6 |

## Cameras and frames

| Method | Path | Body / notes |
| --- | --- | --- |
| GET | `/projects/{id}/cameras` | |
| POST | `/projects/{id}/cameras` | `{name?}` → 201. Labels `CAM-01…` are assigned by the server |
| GET | `/cameras/{cid}` | |
| PATCH | `/cameras/{cid}` | `{name}` |
| DELETE | `/cameras/{cid}` | 204 |
| POST | `/cameras/{cid}/frames` | multipart `files` (≤ 60 per request). Returns `{camera, added, skipped[]}`; bad files are reported per file |
| POST | `/cameras/{cid}/video` | multipart `file`, form field `stride` (1–100) |
| DELETE | `/cameras/{cid}/frames` | Clears frames and calibration |
| GET | `/cameras/{cid}/frames/{index}/image` | JPEG |
| POST | `/cameras/{cid}/calibration` | See below |

Calibration bodies:

```json
{ "method": "checkerboard", "patternCols": 9, "patternRows": 6, "squareSizeM": 0.025 }
{ "method": "manual", "fx": 1100, "fy": 1100, "cx": 640, "cy": 360, "dist": [0, 0, 0, 0, 0] }
{ "method": "assumed" }
```

## Processing

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/projects/{id}/runs` | `{fromStage}`: `input` (full run), `object_detection`, `tracking` or `scene_understanding`. 202, or 409 if a run is active |
| POST | `/projects/{id}/reconstruction` | Same as `runs` with `input` |
| POST | `/projects/{id}/detection` | Re-runs detection → scene graph on the existing reconstruction |
| POST | `/projects/{id}/tracking` | Re-runs tracking and scene graph |
| GET | `/projects/{id}/runs/latest` | Run status with per-stage `status`, `progress`, `durationMs`, `message`, `warnings`, `error` |
| POST | `/projects/{id}/runs/cancel` | Cooperative cancellation at the next checkpoint |
| POST | `/projects/{id}/feature-matching` | `{cameraA, cameraB, detector, ratio, frameIndex?, maxFeatures?}`; runs synchronously and returns every tentative match with its inlier flag |

A full run writes into a staging directory and replaces the previous results only when it succeeds.

## Results

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/scene/{id}` | Scene document (see [scene-format.md](scene-format.md)); adds `stale: true` when inputs changed after the run |
| GET | `/scene/{id}/objects?frame=` | Objects of one timestep (default: last) |
| GET | `/scene/{id}/files/points.bin` | Binary point cloud |
| GET | `/scene/{id}/files/depth_{cameraId}.png` | Encoded depth map |
| GET | `/projects/{id}/export?format=` | `ply`, `scene-json`, `cameras-json`, `tracks-csv` (attachment) |
| POST | `/projects/{id}/export` | Same, with `{format}` in the body |
