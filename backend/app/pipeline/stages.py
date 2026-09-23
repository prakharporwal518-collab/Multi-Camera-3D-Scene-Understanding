"""The eleven pipeline stages. Each takes the shared state and returns (message, warnings).

A stage signals failure by raising :class:`app.core.errors.AppError`; the runner turns that
into a failed stage with the error's message and hint. A stage that cannot run for a
legitimate reason (e.g. no detector configured) raises :class:`StageSkipped`.
"""

from __future__ import annotations

import cv2
import numpy as np

from app.core.config import get_settings
from app.core.errors import ProcessingError
from app.detection.multiview import CameraView, lift_detections
from app.pipeline.context import CameraState, FrameObjects, PipelineInput, PipelineState, Reporter
from app.reconstruction.alignment import Similarity, align_to_ground, to_y_up
from app.reconstruction.dense import DepthOptions, choose_partners, plane_sweep_depth
from app.reconstruction.fusion import filter_consistent, voxel_downsample
from app.reconstruction.sfm import IncrementalSfm, View
from app.scene.relations import Region, SceneObject, compute_relations
from app.tracking.tracker import Tracker3D, TrackInput
from app.vision.camera_model import Intrinsics
from app.vision.features import detect_features, match_features

MIN_FEATURES = 100
BLUR_THRESHOLD = 25.0


class StageSkipped(Exception):
    """Raised when a stage has nothing to do; the message explains why."""


def _plural(n: int, word: str) -> str:
    return f"{n} {word}{'' if n == 1 else 's'}"


# 1 ------------------------------------------------------------------------------------------
def stage_input(inp: PipelineInput, st: PipelineState, rep: Reporter) -> tuple[str, list[str]]:
    warnings = []
    usable = []
    for cam in inp.cameras:
        if cam.frame_count == 0:
            warnings.append(f"{cam.label} has no frames and was excluded.")
        else:
            usable.append(cam)
    if len(usable) < 2:
        raise ProcessingError(
            f"Reconstruction needs at least two cameras with frames; {_plural(len(usable), 'camera')} "
            "currently have frames.",
            code="missing_camera_input",
            hint="Upload images or a video for at least two cameras on the Camera Inputs page.",
        )
    counts = {c.label: c.frame_count for c in usable}
    ref = inp.config.reference_frame
    shortest = min(counts.values())
    if ref >= shortest:
        raise ProcessingError(
            f"The reference frame index ({ref}) is beyond the shortest camera sequence ({shortest} frames).",
            code="invalid_configuration",
            hint="Lower the reference frame in Settings or upload more frames.",
        )
    if len(set(counts.values())) > 1:
        warnings.append(
            "Cameras have different frame counts ("
            + ", ".join(f"{k}: {v}" for k, v in counts.items())
            + f"). Frames are paired by index, so only the first {shortest} are used as synchronized timesteps."
        )
    fps_values = {c.fps for c in usable if c.fps}
    if len(fps_values) > 1:
        warnings.append("Cameras report different frame rates; index-based synchronization may drift over time.")

    stride = inp.config.timestep_stride
    indices = list(range(0, shortest, stride))[: inp.config.max_timesteps]
    fps = min(fps_values) if fps_values else None
    st.timestamps = [(i, i / fps if fps else float(i)) for i in indices]
    st.cameras = [
        CameraState(
            source=c,
            intr_native=Intrinsics.assumed(c.width, c.height),
            intr=Intrinsics.assumed(c.width, c.height),
            calibration_method="assumed",
            calibration_error=None,
        )
        for c in usable
    ]
    return f"{_plural(len(usable), 'camera')}, {_plural(len(indices), 'synchronized timestep')}.", warnings


# 2 ------------------------------------------------------------------------------------------
def stage_preprocessing(inp: PipelineInput, st: PipelineState, rep: Reporter) -> tuple[str, list[str]]:
    warnings = []
    max_dim = get_settings().processing_max_dimension
    for n, cam in enumerate(st.cameras):
        rep.check_cancelled()
        rgb = cam.source.load_frame(inp.config.reference_frame)
        h, w = rgb.shape[:2]
        scale = min(1.0, max_dim / max(h, w))
        if scale < 1.0:
            rgb = cv2.resize(rgb, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA)
        gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
        cam.image_rgb, cam.image_gray = rgb, gray
        sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
        brightness = float(gray.mean())
        if sharpness < BLUR_THRESHOLD:
            warnings.append(f"{cam.source.label}: reference frame looks blurred (Laplacian variance {sharpness:.0f}).")
        if brightness < 35 or brightness > 225:
            warnings.append(f"{cam.source.label}: reference frame is {'under' if brightness < 35 else 'over'}exposed.")
        rep.stage_progress("preprocessing", (n + 1) / len(st.cameras))
    h, w = st.cameras[0].image_gray.shape
    return f"Reference frame {inp.config.reference_frame} loaded; processing at up to {w}×{h} px.", warnings


# 3 ------------------------------------------------------------------------------------------
def stage_calibration(inp: PipelineInput, st: PipelineState, rep: Reporter) -> tuple[str, list[str]]:
    assumed = []
    for cam in st.cameras:
        calib = cam.source.calibration
        if calib and calib.get("intrinsics"):
            intr = Intrinsics.from_dict(calib["intrinsics"])
            if (intr.width, intr.height) != (cam.source.width, cam.source.height):
                intr = intr.scaled(cam.source.width, cam.source.height)
            cam.calibration_method = calib.get("method", "manual")
            cam.calibration_error = calib.get("reprojectionErrorPx")
        else:
            intr = Intrinsics.assumed(cam.source.width, cam.source.height)
            cam.calibration_method = "assumed"
            assumed.append(cam.source.label)
        cam.intr_native = intr
        h, w = cam.image_gray.shape
        cam.intr = intr.scaled(w, h)
    warnings = []
    if assumed:
        warnings.append(
            f"No calibration for {', '.join(assumed)}; focal length assumed from image size. "
            "Poses and depth will be approximate."
        )
    calibrated = len(st.cameras) - len(assumed)
    return f"{calibrated} of {len(st.cameras)} cameras calibrated.", warnings


# 4 ------------------------------------------------------------------------------------------
def stage_feature_extraction(inp: PipelineInput, st: PipelineState, rep: Reporter) -> tuple[str, list[str]]:
    cfg = inp.config
    warnings = []
    st.views = []
    for n, cam in enumerate(st.cameras):
        rep.check_cancelled()
        feats = detect_features(cam.image_gray, cfg.detector, cfg.max_features)
        if len(feats) < MIN_FEATURES:
            warnings.append(
                f"{cam.source.label}: only {len(feats)} features detected. The view may be textureless or out of focus."
            )
        st.views.append(View(cam.source.id, cam.source.label, cam.intr, feats, cam.image_rgb))
        rep.stage_progress("feature_extraction", (n + 1) / len(st.cameras))
    counts = [len(v.features) for v in st.views]
    if sum(c >= MIN_FEATURES for c in counts) < 2:
        raise ProcessingError(
            "Fewer than two cameras produced enough features for matching.",
            code="insufficient_features",
            hint="Use sharper, well-lit frames with visible texture, or switch the feature detector in Settings.",
        )
    return f"{cfg.detector.upper()}: {min(counts)}–{max(counts)} keypoints per camera.", warnings


# 5 ------------------------------------------------------------------------------------------
def stage_feature_matching(inp: PipelineInput, st: PipelineState, rep: Reporter) -> tuple[str, list[str]]:
    n = len(st.views)
    pairs = [(i, j) for i in range(n) for j in range(i + 1, n)]
    st.matches = {}
    for k, (i, j) in enumerate(pairs):
        rep.check_cancelled()
        st.matches[(i, j)] = match_features(st.views[i].features, st.views[j].features, inp.config.match_ratio)
        rep.stage_progress("feature_matching", (k + 1) / len(pairs))
    warnings = []
    for i in range(n):
        best = max(m.num_inliers for (a, b), m in st.matches.items() if i in (a, b))
        if best < 30:
            warnings.append(
                f"{st.views[i].label} shares at most {best} verified matches with any other camera; it may not register."
            )
    total = sum(m.num_inliers for m in st.matches.values())
    return f"{_plural(len(pairs), 'pair')} matched, {total} RANSAC inliers in total.", warnings


# 6 ------------------------------------------------------------------------------------------
def stage_pose_estimation(inp: PipelineInput, st: PipelineState, rep: Reporter) -> tuple[str, list[str]]:
    sparse = IncrementalSfm(st.views, st.matches).run()
    st.sparse = sparse
    st.ba_reports = sparse.ba_reports
    warnings = list(sparse.warnings)

    registered = sorted(sparse.poses)
    similarity = to_y_up()

    baseline = inp.config.baseline_meters
    st.units = "relative"
    if baseline:
        if 0 in sparse.poses and 1 in sparse.poses:
            dist = float(np.linalg.norm(sparse.poses[0].center - sparse.poses[1].center))
            similarity = similarity.then(Similarity(baseline / dist, np.eye(3), np.zeros(3)))
            st.units = "m"
        else:
            warnings.append(
                f"The known baseline refers to {st.cameras[0].source.label} and {st.cameras[1].source.label}, "
                "but one of them was not registered; the scale stays relative."
            )

    _apply_similarity(st, similarity)
    for v, cam in enumerate(st.cameras):
        if v not in sparse.poses:
            cam.registration_note = sparse.unregistered.get(v, "Not registered.")
    rms = st.ba_reports[-1].final_rms_px if st.ba_reports else float("nan")
    msg = (
        f"{len(registered)} of {len(st.cameras)} cameras registered, {len(sparse.points)} sparse points, "
        f"bundle adjustment RMS {rms:.2f} px."
    )
    return msg, warnings


def _apply_similarity(st: PipelineState, sim: Similarity) -> None:
    assert st.sparse is not None
    st.sparse_points = sim.apply(st.sparse.points)
    st.sparse_colors = st.sparse.colors
    for v, cam in enumerate(st.cameras):
        pose = st.sparse.poses.get(v)
        cam.pose = sim.apply_pose(pose) if pose is not None else None


def _align_ground(st: PipelineState) -> str | None:
    """Rigidly move everything so the ground plane is y = 0. Depth maps are unaffected."""
    reg = st.registered()
    up_hint = -reg[0].pose.R[1]  # camera "up" is -y in OpenCV
    centers = np.array([c.pose.center for c in reg])
    cloud = np.concatenate([st.sparse_points, st.dense_points]) if len(st.dense_points) else st.sparse_points
    sim, warn = align_to_ground(cloud, centers, up_hint)
    st.ground_aligned = warn is None
    if warn is None:
        st.sparse_points = sim.apply(st.sparse_points)
        st.dense_points = sim.apply(st.dense_points)
        for cam in reg:
            cam.pose = sim.apply_pose(cam.pose)
        for d in st.depth:
            d.points = sim.apply(d.points)
    return warn


# 7 ------------------------------------------------------------------------------------------
def stage_depth(inp: PipelineInput, st: PipelineState, rep: Reporter) -> tuple[str, list[str]]:
    cfg = inp.config.depth
    opt = DepthOptions(num_planes=cfg.num_planes, window=cfg.window, working_width=cfg.working_width, min_score=cfg.min_score)
    shared = _shared_point_counts(st)
    reg = {v: c for v, c in enumerate(st.cameras) if c.pose is not None}
    poses = {v: c.pose for v, c in reg.items()}
    intr = {v: c.intr for v, c in reg.items()}
    gray = {v: c.image_gray for v, c in reg.items()}
    rgb = {v: c.image_rgb for v, c in reg.items()}
    warnings, results = [], []
    for n, v in enumerate(reg):
        rep.check_cancelled()
        partners = choose_partners(v, poses, shared, opt)
        result = plane_sweep_depth(v, partners, intr, poses, gray, rgb, st.sparse_points, opt)
        if result is None:
            warnings.append(f"{reg[v].source.label}: no suitable neighbouring camera for dense stereo.")
        else:
            results.append(result)
        rep.stage_progress("depth_estimation", (n + 1) / len(reg), f"{reg[v].source.label} done")
    min_views = 2 if len(results) >= 3 else 1
    st.depth = filter_consistent(results, poses, 0.01, min_views) if len(results) >= 2 else results
    if not st.depth:
        warnings.append("Dense depth could not be estimated for any camera; the point cloud will be sparse only.")
        return "Skipped dense depth.", warnings
    cov = np.mean([d.coverage for d in st.depth])
    return f"{_plural(len(st.depth), 'depth map')}, mean coverage {cov * 100:.0f}% after cross-view filtering.", warnings


def _shared_point_counts(st: PipelineState) -> dict[tuple[int, int], int]:
    shared: dict[tuple[int, int], int] = {}
    for obs in st.sparse.observations:
        keys = sorted(obs)
        for i, a in enumerate(keys):
            for b in keys[i + 1 :]:
                shared[(a, b)] = shared.get((a, b), 0) + 1
    return shared


# 8 ------------------------------------------------------------------------------------------
def stage_reconstruction(inp: PipelineInput, st: PipelineState, rep: Reporter) -> tuple[str, list[str]]:
    warnings = []
    if st.depth:
        pts = np.concatenate([d.points for d in st.depth])
        cols = np.concatenate([d.colors for d in st.depth])
        extent = np.linalg.norm(np.percentile(st.sparse_points, 95, 0) - np.percentile(st.sparse_points, 5, 0))
        voxel = inp.config.voxel_size if st.units == "m" else extent * 0.002
        st.dense_points, st.dense_colors = voxel_downsample(pts, cols, voxel)
    else:
        st.dense_points = np.zeros((0, 3), np.float32)
        st.dense_colors = np.zeros((0, 3), np.uint8)
    warn = _align_ground(st)
    if warn:
        if any(c.calibration_method == "assumed" for c in st.registered()):
            warn += " Assumed intrinsics distort the geometry; calibrating the cameras usually fixes this."
        warnings.append(warn)
    total = len(st.sparse_points) + len(st.dense_points)
    if total < 50:
        raise ProcessingError(
            f"The reconstruction contains only {total} points, which is too few to be useful.",
            code="reconstruction_failed",
            hint="Add frames with more overlap between cameras.",
        )
    if st.units == "relative":
        warnings.append("Scale is relative (initial camera baseline = 1). Set a known baseline in Settings for metres.")
    return f"{len(st.sparse_points)} sparse + {len(st.dense_points)} dense points.", warnings


# 9 ------------------------------------------------------------------------------------------
def stage_detection(inp: PipelineInput, st: PipelineState, rep: Reporter) -> tuple[str, list[str]]:
    if inp.detection_provider is None:
        raise StageSkipped(
            "No object detector is configured (DETECTOR_MODEL_PATH is unset), so detection was skipped. "
            "No detections are simulated."
        )
    reg = st.registered()
    views = {c.source.id: CameraView(c.source.id, c.intr_native, c.pose) for c in reg}
    st.frames = []
    total_2d = 0
    for n, (index, t) in enumerate(st.timestamps):
        rep.check_cancelled()
        raw = {}
        for cam in reg:
            image = cam.source.load_frame(index)
            raw[cam.source.id] = inp.detection_provider(cam.source.id, index, image)
            total_2d += len(raw[cam.source.id])
        objects = lift_detections(raw, views, st.ground_aligned)
        st.frames.append(FrameObjects(index, t, objects, raw))
        rep.stage_progress("object_detection", (n + 1) / len(st.timestamps))
    warnings = []
    if total_2d == 0:
        warnings.append("The detector returned no objects in any frame.")
    lifted = sum(len(f.objects) for f in st.frames)
    return f"{total_2d} 2D detections across {_plural(len(st.frames), 'timestep')}, {lifted} lifted to 3D.", warnings


# 10 -----------------------------------------------------------------------------------------
def stage_tracking(inp: PipelineInput, st: PipelineState, rep: Reporter) -> tuple[str, list[str]]:
    if not st.frames:
        raise StageSkipped("Tracking needs object detections, and none are available.")
    if len(st.frames) < 2:
        raise StageSkipped("Tracking needs at least two synchronized timesteps; only one is available.")
    gate = 2.5 if st.units == "m" else 0.25 * _scene_extent(st)
    tracker = Tracker3D(gate=gate)
    for frame in st.frames:
        tracker.update(
            frame.t,
            [TrackInput(o.cls, o.confidence, o.center, o.size, o.cameras) for o in frame.objects],
        )
    st.tracks = tracker.confirmed_tracks()
    _assign_track_ids(st)
    return f"{_plural(len(st.tracks), 'confirmed track')}.", []


def _scene_extent(st: PipelineState) -> float:
    pts = st.sparse_points
    return float(np.linalg.norm(np.percentile(pts, 95, 0) - np.percentile(pts, 5, 0)))


def _assign_track_ids(st: PipelineState) -> None:
    """Map each lifted object back to the track whose observed state matches it."""
    for frame in st.frames:
        frame.track_ids = [None] * len(frame.objects)
        for tr in st.tracks:
            for s in tr.states:
                if not s.observed or s.t != frame.t:
                    continue
                dists = [np.linalg.norm(o.center - s.position) if o.cls == tr.cls else np.inf for o in frame.objects]
                if dists and np.isfinite(min(dists)):
                    frame.track_ids[int(np.argmin(dists))] = tr.id


# 11 -----------------------------------------------------------------------------------------
def stage_scene(inp: PipelineInput, st: PipelineState, rep: Reporter) -> tuple[str, list[str]]:
    if not st.frames:
        raise StageSkipped("The scene graph is built from detected objects, and none are available.")
    frame = st.frames[-1]
    objects = [
        SceneObject(object_id(frame, k), o.cls, o.center, o.size) for k, o in enumerate(frame.objects)
    ]
    regions = [Region(r["id"], r["name"], np.asarray(r["polygon"], float)) for r in inp.regions]
    reg = st.registered()
    viewpoint = reg[0].pose.center if reg else None
    st.viewpoint_camera = reg[0].source.label if reg else None
    near = inp.config.near_distance if st.units == "m" else 0.1 * _scene_extent(st)
    st.relations = compute_relations(objects, regions, viewpoint, near, st.units, st.ground_aligned)
    return f"{_plural(len(st.relations), 'relation')} between {_plural(len(objects), 'object')}.", []


def object_id(frame: FrameObjects, k: int) -> str:
    track = frame.track_ids[k] if k < len(frame.track_ids) else None
    return f"T{track}" if track is not None else f"D{frame.index}-{k}"


STAGE_FUNCTIONS = {
    "input": stage_input,
    "preprocessing": stage_preprocessing,
    "calibration": stage_calibration,
    "feature_extraction": stage_feature_extraction,
    "feature_matching": stage_feature_matching,
    "pose_estimation": stage_pose_estimation,
    "depth_estimation": stage_depth,
    "reconstruction": stage_reconstruction,
    "object_detection": stage_detection,
    "tracking": stage_tracking,
    "scene_understanding": stage_scene,
}
