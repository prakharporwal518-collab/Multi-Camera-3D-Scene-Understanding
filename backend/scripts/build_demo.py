"""Build the demo dataset served by the frontend (frontend/public/demo).

    python -m scripts.build_demo            # from the backend/ directory

1. Renders a procedural street scene from four cameras over several timesteps.
2. Runs the real reconstruction pipeline on the rendered JPEG frames.
3. Adds simulated detections (labelled as such) and runs tracking + scene graph.
4. Evaluates cameras, depth and objects against the synthetic ground truth.
5. Precomputes feature matches for every camera pair / detector / ratio combination.
"""

from __future__ import annotations

import argparse
import json
import logging
import shutil
import time
from pathlib import Path

import cv2
import numpy as np

from app.pipeline.config import ProjectConfig
from app.pipeline.context import CameraSource, PipelineInput
from app.pipeline.runner import run_pipeline
from app.reconstruction.geometry import umeyama
from app.synthetic.detections import simulate
from app.synthetic.render import render
from app.synthetic.scene import build_street_scene, street_cameras
from app.vision.features import detect_features, match_features

log = logging.getLogger("build_demo")
OUT_DEFAULT = Path(__file__).resolve().parents[2] / "frontend" / "public" / "demo"
TIMESTEPS = 12
DT = 0.5
DISPLAY_WIDTH = 960
RATIOS = [0.6, 0.7, 0.75, 0.8, 0.9]
DETECTORS = ["sift", "orb", "akaze"]


class PrintReporter:
    def stage_started(self, stage):
        self._t = time.perf_counter()
        log.info("-> %s", stage)

    def stage_progress(self, stage, fraction, message=None):
        pass

    def stage_finished(self, stage, status, message, warnings, duration_ms, error=None):
        log.info("   %s [%s] %s (%.0f ms)", stage, status, message, duration_ms or 0)
        for w in warnings:
            log.info("   ! %s", w)

    def check_cancelled(self):
        pass


def render_frames(work: Path, out: Path):
    scene, trajectories = build_street_scene()
    cams = street_cameras()
    gt_boxes, instances = {}, {}
    rng = np.random.default_rng(11)
    for step in range(TIMESTEPS):
        t = step * DT
        snapshot = scene.at_time(trajectories, t)
        gt_boxes[step] = snapshot.boxes
        for c, (label, intr, pose) in enumerate(cams):
            cam_id = f"cam0{c + 1}"
            res = render(snapshot, intr, pose, supersample=2 if step == 0 else 1, seed=100 * step + c)
            bgr = cv2.cvtColor(res.rgb, cv2.COLOR_RGB2BGR)
            (work / cam_id).mkdir(parents=True, exist_ok=True)
            cv2.imwrite(str(work / cam_id / f"{step:03d}.jpg"), bgr, [cv2.IMWRITE_JPEG_QUALITY, 92])
            small = cv2.resize(bgr, (DISPLAY_WIDTH, round(intr.height * DISPLAY_WIDTH / intr.width)), interpolation=cv2.INTER_AREA)
            (out / "frames" / cam_id).mkdir(parents=True, exist_ok=True)
            cv2.imwrite(str(out / "frames" / cam_id / f"{step:03d}.jpg"), small, [cv2.IMWRITE_JPEG_QUALITY, 82])
            instances[(cam_id, step)] = res.instance
            if step == 0:
                np.save(work / f"gt_depth_{cam_id}.npy", res.depth)
        log.info("rendered timestep %d/%d", step + 1, TIMESTEPS)
    detections = {}
    for (cam_id, step), inst in instances.items():
        c = int(cam_id[-1]) - 1
        _, intr, pose = cams[c]
        detections[(cam_id, step)] = simulate(gt_boxes[step], inst, intr, pose, rng)
    return scene, trajectories, cams, gt_boxes, detections


def make_sources(cams, work: Path) -> list[CameraSource]:
    sources = []
    for c, (label, intr, _) in enumerate(cams):
        cam_id = f"cam0{c + 1}"

        def loader(index: int, cam_id=cam_id):
            return cv2.cvtColor(cv2.imread(str(work / cam_id / f"{index:03d}.jpg")), cv2.COLOR_BGR2RGB)

        sources.append(
            CameraSource(
                id=cam_id,
                label=label,
                name=["North-west pole", "West pole", "East pole", "North-east pole"][c],
                width=intr.width,
                height=intr.height,
                frame_count=TIMESTEPS,
                fps=1 / DT,
                calibration={"method": "synthetic", "intrinsics": intr.to_dict(), "reprojectionErrorPx": None},
                load_frame=loader,
                frame_url=f"frames/{cam_id}/{{index:03d}}.jpg",
            )
        )
    return sources


def evaluate(scene_doc: dict, cams, gt_boxes, work: Path, out: Path) -> tuple[dict, tuple]:
    est = {c["id"]: c for c in scene_doc["cameras"] if c["pose"]}
    ids = [f"cam0{i + 1}" for i in range(len(cams))]
    reg = [i for i, cid in enumerate(ids) if cid in est]
    est_c = np.array([est[ids[i]]["pose"]["position"] for i in reg])
    gt_c = np.array([cams[i][2].center for i in reg])
    # Camera centres on a line leave the rotation about that line unconstrained, so points
    # along each optical axis are added to the alignment (5 units / 5 m in front of the camera).
    s0, _, _ = umeyama(est_c, gt_c)
    est_fwd = np.array([est[ids[i]]["pose"]["position"] + 5 / s0 * np.asarray(est[ids[i]]["pose"]["R"])[6:9] for i in reg])
    gt_fwd = np.array([cams[i][2].center + 5 * cams[i][2].R[2] for i in reg])
    s, R, t = umeyama(np.vstack([est_c, est_fwd]), np.vstack([gt_c, gt_fwd]))
    aligned = s * est_c @ R.T + t
    cam_err = np.linalg.norm(aligned - gt_c, axis=1)
    rot_err = []
    for k, i in enumerate(reg):
        R_est = np.asarray(est[ids[i]]["pose"]["R"]).reshape(3, 3) @ R.T  # world(gt) -> cam
        R_gt = cams[i][2].R
        rot_err.append(float(np.degrees(np.arccos(np.clip((np.trace(R_gt.T @ R_est) - 1) / 2, -1, 1)))))

    depth_stats = []
    for dm in scene_doc["depthMaps"]:
        gt = np.load(work / f"gt_depth_{dm['cameraId']}.npy")
        png = cv2.imread(str(out / dm["url"]), cv2.IMREAD_COLOR)  # BGR = conf, lo, hi
        q = png[..., 2].astype(np.uint32) * 256 + png[..., 1]
        depth = q * dm["encoding"]["step"] * s
        gt_small = cv2.resize(gt, (dm["width"], dm["height"]), interpolation=cv2.INTER_NEAREST)
        ok = (q > 0) & (gt_small > 0)
        rel = np.abs(depth[ok] - gt_small[ok]) / gt_small[ok]
        depth_stats.append({"camera": dm["cameraId"], "medianRelError": round(float(np.median(rel)), 4),
                            "within5Percent": round(float((rel < 0.05).mean()), 4)})

    obj_err = []
    names = {"car": "car", "truck": "truck", "person": "person", "bench": "bench"}
    for frame in scene_doc["frames"]:
        step = frame["index"]
        for o in frame["objects"]:
            pos = s * np.asarray(o["center"]) @ R.T + t
            cands = [np.linalg.norm((b.center - pos)[[0, 2]]) for b in gt_boxes[step] if names.get(b.cls) == o["class"]]
            if cands:
                obj_err.append(min(cands))

    evaluation = {
        "note": "Computed against the synthetic ground truth after a similarity alignment (Umeyama) of camera centres and optical axes.",
        "cameraPositionErrorM": {ids[i]: round(float(e), 4) for i, e in zip(reg, cam_err)},
        "cameraRotationErrorDeg": {ids[i]: round(e, 3) for i, e in zip(reg, rot_err)},
        "depth": depth_stats,
        "objectCenterErrorM": {"mean": round(float(np.mean(obj_err)), 3), "median": round(float(np.median(obj_err)), 3),
                               "count": len(obj_err)} if obj_err else None,
    }
    return evaluation, (s, R, t)


def transform_regions(regions: list[dict], sim) -> list[dict]:
    """Regions are annotated in the synthetic frame; map them into the reconstruction frame."""
    s, R, t = sim
    out = []
    for r in regions:
        poly = []
        for x, z in r["polygon"]:
            gt = np.array([x, 0.0, z])
            est = R.T @ (gt - t) / s
            poly.append([round(float(est[0]), 3), round(float(est[2]), 3)])
        out.append({**r, "polygon": poly})
    return out


def precompute_matches(cams, work: Path, out: Path) -> list[dict]:
    grays = [cv2.cvtColor(cv2.imread(str(work / f"cam0{c + 1}" / "000.jpg")), cv2.COLOR_BGR2GRAY) for c in range(len(cams))]
    index = []
    (out / "matches").mkdir(parents=True, exist_ok=True)
    for det in DETECTORS:
        feats = [detect_features(g, det, 6000) for g in grays]
        for i in range(len(cams)):
            for j in range(i + 1, len(cams)):
                loose = match_features(feats[i], feats[j], max(RATIOS))
                pts_a, pts_b = feats[i].points[loose.idx_a], feats[j].points[loose.idx_b]
                inliers = {}
                for r in RATIOS:
                    sel = np.flatnonzero(loose.ratios < r)
                    if len(sel) >= 8:
                        _, mask = cv2.findFundamentalMat(pts_a[sel], pts_b[sel], cv2.USAC_MAGSAC, 1.5, 0.999, 10000)
                        inliers[str(r)] = sel[mask.ravel().astype(bool)].tolist() if mask is not None else []
                    else:
                        inliers[str(r)] = []
                name = f"cam0{i + 1}_cam0{j + 1}_{det}.json"
                payload = {
                    "cameraA": f"cam0{i + 1}",
                    "cameraB": f"cam0{j + 1}",
                    "detector": det,
                    "featuresA": len(feats[i]),
                    "featuresB": len(feats[j]),
                    "detectMsA": round(feats[i].elapsed_ms, 1),
                    "detectMsB": round(feats[j].elapsed_ms, 1),
                    "matchMs": round(loose.elapsed_ms, 1),
                    "matches": [[round(float(a[0]), 1), round(float(a[1]), 1), round(float(b[0]), 1), round(float(b[1]), 1), round(float(r), 3)]
                                for a, b, r in zip(pts_a, pts_b, loose.ratios)],
                    "inliersByRatio": inliers,
                }
                (out / "matches" / name).write_text(json.dumps(payload, separators=(",", ":")))
                index.append({"a": payload["cameraA"], "b": payload["cameraB"], "detector": det, "file": f"matches/{name}"})
        log.info("matches precomputed for %s", det)
    return index


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", type=Path, default=OUT_DEFAULT)
    parser.add_argument("--work", type=Path, default=Path("data/demo-build"))
    parser.add_argument("--skip-matches", action="store_true")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    out, work = args.out.resolve(), args.work.resolve()
    shutil.rmtree(out, ignore_errors=True)
    out.mkdir(parents=True)
    work.mkdir(parents=True, exist_ok=True)

    scene, trajectories, cams, gt_boxes, detections = render_frames(work, out)
    sources = make_sources(cams, work)
    # Metric scale comes from the distance between the CAM-01 and CAM-02 poles, which on a
    # real site would be measured with a tape; here it is read from the synthetic layout.
    baseline = float(np.linalg.norm(cams[0][2].center - cams[1][2].center))
    config = ProjectConfig(baseline_meters=round(baseline, 3), max_timesteps=TIMESTEPS)

    inp = PipelineInput(
        project_id="demo",
        cameras=sources,
        config=config,
        detection_provider=None,
        detection_source="simulated",
        image_source="synthetic-render",
        source="demo",
    )
    log.info("pass 1: geometry")
    doc = run_pipeline(inp, PrintReporter(), out)
    (out / "scene.json").write_text(json.dumps(doc))

    # Regions are annotated in the synthetic frame; map them into the reconstructed frame.
    _, sim = evaluate(doc, cams, gt_boxes, work, out)
    inp.regions = transform_regions(scene.regions, sim)
    inp.detection_provider = lambda cam_id, index, _image: detections[(cam_id, index)]

    log.info("pass 2: detection, tracking, scene graph")
    doc = run_pipeline(inp, PrintReporter(), out, from_stage="object_detection")
    doc["evaluation"], _ = evaluate(doc, cams, gt_boxes, work, out)
    doc["matching"]["precomputed"] = [] if args.skip_matches else precompute_matches(cams, work, out)
    (out / "scene.json").write_text(json.dumps(doc, separators=(",", ":")))
    log.info("demo written to %s", out)
    log.info("evaluation: %s", json.dumps(doc["evaluation"], indent=1))


if __name__ == "__main__":
    main()
