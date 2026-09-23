# Architecture

```
frontend/  React + TypeScript SPA         ──REST──▶  backend/  FastAPI
  pages/       one folder per workspace page             api/routes/   HTTP layer, validation
  three/       react-three-fiber viewport                services/     projects, uploads, run manager
  services/    API client, data sources, codecs          pipeline/     stage orchestration + scene writer
  workers/     depth-map decoding off the main thread    vision/       features, matching, calibration
  context/     workspace state (project, scene, run)     reconstruction/  SfM, bundle adjustment, MVS, fusion
                                                         detection/    ONNX detector, multi-view lifting
                                                         tracking/     3D multi-object tracker
                                                         scene/        spatial relations
                                                         synthetic/    demo scene renderer (not used by the API)
                                                         database/     SQLAlchemy models (SQLite / PostgreSQL)
```

## Request flow for a run

1. `POST /projects/{id}/runs` creates a `PipelineRun` row and submits it to a small thread pool (`RunManager`).
2. The worker builds a `PipelineInput` (camera sources with lazy frame loaders, config, optional detector) and calls `run_pipeline`.
3. Each stage updates its record through `DbReporter` (status, progress, message, warnings, error). Progress writes are throttled.
4. Between and inside stages the reporter checks for cancellation and the processing timeout.
5. On success the scene document, `points.bin` and depth PNGs are written to a staging directory that then replaces the previous results atomically.
6. The frontend polls `GET /runs/latest` while a run is active and reloads the project and scene when it finishes.

## Pipeline stages

| # | Stage | Implementation |
| --- | --- | --- |
| 1 | Input | Excludes cameras without frames, checks frame counts and rates, picks synchronized timesteps (by index) |
| 2 | Preprocessing | Loads the reference frame, resizes to `PROCESSING_MAX_DIMENSION`, blur/exposure checks |
| 3 | Calibration | Stored checkerboard/manual intrinsics, otherwise `f = max(w, h)` with a warning |
| 4 | Feature extraction | SIFT / ORB / AKAZE (`vision/features.py`) |
| 5 | Feature matching | All pairs; ratio test + mutual check, fundamental matrix with USAC MAGSAC++ |
| 6 | Pose estimation | Union-find feature tracks; essential-matrix initialisation on the best-conditioned pair; PnP-RANSAC registration; Schur-complement Levenberg–Marquardt bundle adjustment after every registration (`reconstruction/sfm.py`, `bundle_adjustment.py`) |
| 7 | Depth estimation | Plane-sweep stereo per camera against up to three neighbours, ZNCC cost, sub-plane refinement; cross-view depth consistency filter (`dense.py`, `fusion.py`) |
| 8 | 3D reconstruction | Voxel fusion of dense points, ground plane by constrained RANSAC, metric scale from a known baseline |
| 9 | Object detection | Optional ONNX detector per camera and timestep; multi-view association and triangulation (`detection/`) |
| 10 | Tracking | Alpha–beta filter with two-point initialisation, class-gated nearest-neighbour association (`tracking/tracker.py`) |
| 11 | Scene understanding | `near`, `on`, `inside`, `behind` relations with the measured value attached (`scene/relations.py`) |

A stage signals a problem in one of three ways: warnings (it produced a result but something
deserves attention), `StageSkipped` (it legitimately had nothing to do), or an `AppError`
whose message and hint are shown to the user. Unexpected exceptions are logged and reported
as a generic internal error without leaking internals.

## Frontend data sources

Pages never call `fetch` directly. `WorkspaceContext` exposes the project, the scene and the
active run; `SceneSource` hides whether data comes from the API or from the static demo
files. The demo is therefore a first-class data source rather than a separate code path.

Heavy parts are loaded on demand: each page is a lazy route, three.js/R3F load with the first
3D view, Recharts with the first chart. The landing page ships about 140 KB gzipped.

## Viewer

* `frameloop="demand"`: frames render only when something changes.
* Points are drawn with `THREE.Points` from typed arrays; the density slider changes the draw range of a pre-shuffled buffer, so there is no per-frame work.
* Geometries and materials created in `useMemo` are disposed in effect clean-ups.
* Labels are plain DOM elements positioned from the render loop (no extra React roots).
* WebGL is feature-detected before loading the renderer; context loss shows a restart button.
