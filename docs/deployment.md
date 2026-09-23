# Deployment

The frontend and backend deploy separately. The frontend works on its own (demo only) when
`VITE_API_URL` is not set.

## Frontend on Vercel or Netlify

* Root directory: `frontend`
* Build command: `npm run build`, output directory: `dist`
* Environment variable: `VITE_API_URL=https://<your-backend>/api/v1`
* SPA routing is configured in `frontend/vercel.json` and `frontend/netlify.toml`.

The demo dataset in `frontend/public/demo` is part of the build output.

## Backend on Render

`render.yaml` at the repository root defines a Docker web service and a PostgreSQL database.

1. Create a Blueprint from the repository in the Render dashboard.
2. Set `CORS_ORIGINS` to the frontend URL (for example `https://mc3d.vercel.app`).
3. Deploy. The health check is `GET /api/v1/health`.

Uploaded frames and results are stored on disk under `STORAGE_DIR`. The blueprint mounts a
persistent disk at `/data`; Render only offers disks on paid instance types. On a free
instance the service still works, but files disappear on every restart while the database
rows remain; projects then need their frames uploaded again.

## Backend on Railway or another container host

Build `backend/Dockerfile`. The container listens on `$PORT` (default 8000). Provide:

| Variable | Example |
| --- | --- |
| `DATABASE_URL` | `postgresql://user:pass@host:5432/db` (a `postgres://` URL is converted automatically) |
| `STORAGE_DIR` | `/data/storage` on a mounted volume |
| `CORS_ORIGINS` | `https://your-frontend.example` |
| `WORKER_THREADS` | `1` on small instances (dense stereo is memory hungry) |

Tables are created on start-up. There is no migration tool yet; see the README's future work.

## Sizing

Measured with the default settings on a CPU-only container: three 960×540 cameras took 13 s
(16 s CPU time) with the server process peaking at about 360 MB; the four-camera 1280×720
demo scene takes about 19 s. Dense depth estimation dominates the run time. Lower `depth.workingWidth` or `depth.numPlanes` in the
project settings for small instances, or raise `PROCESSING_TIMEOUT_S`.
