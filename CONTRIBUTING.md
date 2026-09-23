# Contributing

Issues and pull requests are welcome. For anything larger than a bug fix, open an issue
first so we can agree on the approach.

## Setup

See "Running locally" in the README. Both halves have fast checks that CI also runs:

```bash
# backend
cd backend && python -m pytest -q

# frontend
cd frontend && npm run lint && npm run typecheck && npm test && npm run build
```

## Guidelines

* Keep results honest. Anything that is not computed from the user's data (demo data,
  simulated detections, assumed intrinsics) must be labelled in the scene document's
  `provenance` and in the UI.
* Errors shown to users need a message that says what went wrong and, where possible, a
  hint about what to do next. Raise `AppError` subclasses in the backend.
* Changes to the scene document must be made in `backend/app/pipeline/scene_writer.py`,
  `frontend/src/types/scene.ts` and `docs/scene-format.md` together.
* After changing pipeline code, rebuild the demo with `python -m scripts.build_demo` so the
  bundled results match the code.
* Add a test for bug fixes where practical. The synthetic renderer in `app/synthetic` makes it
  easy to create image-based test cases with known ground truth.
