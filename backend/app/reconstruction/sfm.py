"""Incremental sparse reconstruction (a compact structure-from-motion).

Steps:
1. Link pairwise inlier matches into multi-view feature tracks (union-find).
2. Initialise from the pair with the most well-conditioned matches (essential matrix).
3. Register the remaining cameras one at a time with PnP + RANSAC and triangulate new tracks.
4. Refine cameras and points jointly with bundle adjustment after every registration.

The reconstruction is defined up to scale: the baseline of the initial pair is 1 unit.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

import cv2
import numpy as np

from app.core.errors import ProcessingError
from app.reconstruction.bundle_adjustment import BAReport, bundle_adjust
from app.reconstruction.geometry import normalize_points, project, ray_angle_deg, triangulate_multiview
from app.vision.camera_model import Intrinsics, Pose
from app.vision.features import Features, MatchResult

log = logging.getLogger(__name__)


@dataclass
class View:
    camera_id: str
    label: str
    intr: Intrinsics
    features: Features
    image_rgb: np.ndarray


@dataclass
class SfmOptions:
    min_init_inliers: int = 40
    min_pnp_correspondences: int = 12
    max_reprojection_px: float = 3.0
    min_parallax_deg: float = 1.0
    refinement_rounds: int = 2


@dataclass
class SparseResult:
    poses: dict[int, Pose]
    points: np.ndarray
    colors: np.ndarray
    observations: list[dict[int, int]]  # per point: view index -> keypoint index
    point_errors: np.ndarray  # mean reprojection error per point (px)
    initial_pair: tuple[int, int]
    unregistered: dict[int, str] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    ba_reports: list[BAReport] = field(default_factory=list)

    def camera_error(self, view_idx: int) -> tuple[int, float]:
        errs = [self.point_errors[i] for i, obs in enumerate(self.observations) if view_idx in obs]
        return len(errs), float(np.mean(errs)) if errs else float("nan")


def build_tracks(num_views: int, sizes: list[int], matches: dict[tuple[int, int], MatchResult]) -> list[dict[int, int]]:
    offsets = np.concatenate([[0], np.cumsum(sizes)]).astype(int)
    parent = np.arange(offsets[-1])

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for (i, j), m in matches.items():
        for a, b in zip(m.idx_a[m.inlier_mask], m.idx_b[m.inlier_mask]):
            ra, rb = find(offsets[i] + a), find(offsets[j] + b)
            if ra != rb:
                parent[ra] = rb

    groups: dict[int, dict[int, int]] = {}
    conflicted: set[int] = set()
    used = set()
    for (i, j), m in matches.items():
        for a, b in zip(m.idx_a[m.inlier_mask], m.idx_b[m.inlier_mask]):
            used.add((i, int(a)))
            used.add((j, int(b)))
    for view, kp in used:
        root = find(offsets[view] + kp)
        track = groups.setdefault(root, {})
        if view in track and track[view] != kp:
            conflicted.add(root)
        track[view] = kp
    return [t for root, t in groups.items() if root not in conflicted and len(t) >= 2]


def _pair_score(m: MatchResult, fa: Features, fb: Features) -> float:
    """Prefer pairs with many inliers that are *not* explained by a homography (enough baseline)."""
    if m.num_inliers < 8:
        return 0.0
    pa, pb = fa.points[m.idx_a[m.inlier_mask]], fb.points[m.idx_b[m.inlier_mask]]
    _, hmask = cv2.findHomography(pa, pb, cv2.RANSAC, 4.0)
    h_ratio = float(hmask.mean()) if hmask is not None else 0.0
    return m.num_inliers * (1.0 - 0.8 * h_ratio)


class IncrementalSfm:
    def __init__(self, views: list[View], matches: dict[tuple[int, int], MatchResult], options: SfmOptions | None = None):
        if len(views) < 2:
            raise ProcessingError("Sparse reconstruction needs at least two views.")
        self.views = views
        self.matches = matches
        self.opt = options or SfmOptions()
        self.tracks = build_tracks(len(views), [len(v.features) for v in views], matches)
        self.norm = [normalize_points(v.features.points, v.intr) for v in views]
        self.poses: dict[int, Pose] = {}
        self.track_point: dict[int, np.ndarray] = {}
        self.warnings: list[str] = []
        self.unregistered: dict[int, str] = {}
        self.ba_reports: list[BAReport] = []

    # -- initialisation --------------------------------------------------------------------
    def _choose_initial_pair(self) -> tuple[int, int]:
        scored = []
        for (i, j), m in self.matches.items():
            scored.append((_pair_score(m, self.views[i].features, self.views[j].features), m.num_inliers, i, j))
        scored.sort(reverse=True)
        if not scored or scored[0][1] < self.opt.min_init_inliers:
            best = scored[0] if scored else (0, 0, 0, 1)
            a, b = self.views[best[2]].label, self.views[best[3]].label
            raise ProcessingError(
                f"Reconstruction could not start: the best camera pair ({a} / {b}) has only {best[1]} verified "
                f"feature matches, and at least {self.opt.min_init_inliers} are needed.",
                code="insufficient_matches",
                hint="Use frames with more visual overlap between cameras, add texture to the scene, "
                "or relax the matching ratio in the project settings.",
            )
        return scored[0][2], scored[0][3]

    def _initialise(self, i: int, j: int) -> None:
        m = self.matches[(i, j)]
        ia, ib = m.idx_a[m.inlier_mask], m.idx_b[m.inlier_mask]
        xa, xb = self.norm[i][ia], self.norm[j][ib]
        focal = np.mean([self.views[i].intr.fx, self.views[j].intr.fx])
        E, mask = cv2.findEssentialMat(xa, xb, np.eye(3), cv2.RANSAC, 0.999, 1.5 / focal)
        if E is None or E.shape != (3, 3):
            raise ProcessingError(
                f"The relative pose between {self.views[i].label} and {self.views[j].label} could not be estimated.",
                code="pose_estimation_failed",
                hint="The two views may be related by a pure rotation or show a single plane. "
                "Cameras need a physical baseline between them.",
            )
        n_good, R, t, _ = cv2.recoverPose(E, xa, xb, np.eye(3), mask=mask)
        if n_good < self.opt.min_init_inliers // 2:
            raise ProcessingError(
                f"Only {n_good} matches between {self.views[i].label} and {self.views[j].label} are in front of both cameras.",
                code="pose_estimation_failed",
                hint="Check that both cameras observe the same part of the scene.",
            )
        self.poses[i] = Pose.identity()
        self.poses[j] = Pose(R, t.ravel())
        self._triangulate_new_tracks()
        if len(self.track_point) < 20:
            raise ProcessingError(
                f"Initial triangulation produced only {len(self.track_point)} points.",
                code="reconstruction_failed",
                hint="The initial camera pair has too little parallax. Increase the distance between cameras.",
            )

    # -- triangulation ---------------------------------------------------------------------
    def _triangulate_track(self, track: dict[int, int]) -> np.ndarray | None:
        views = [v for v in track if v in self.poses]
        if len(views) < 2:
            return None
        poses = [self.poses[v] for v in views]
        X = triangulate_multiview([self.norm[v][track[v]] for v in views], poses)
        if not np.all(np.isfinite(X)):
            return None
        for v, pose in zip(views, poses):
            if (pose.R @ X + pose.t)[2] <= 0:
                return None
        if ray_angle_deg(X, [p.center for p in poses]) < self.opt.min_parallax_deg:
            return None
        if self._track_error(X, track) > self.opt.max_reprojection_px:
            return None
        return X

    def _track_error(self, X: np.ndarray, track: dict[int, int]) -> float:
        errs = []
        for v, kp in track.items():
            if v not in self.poses:
                continue
            px, _ = project(X[None], self.poses[v], self.views[v].intr)
            errs.append(np.linalg.norm(px[0] - self.views[v].features.points[kp]))
        return float(np.mean(errs)) if errs else float("inf")

    def _triangulate_new_tracks(self) -> None:
        for t_idx, track in enumerate(self.tracks):
            if t_idx in self.track_point:
                continue
            X = self._triangulate_track(track)
            if X is not None:
                self.track_point[t_idx] = X

    # -- registration ----------------------------------------------------------------------
    def _correspondences(self, view: int) -> tuple[np.ndarray, np.ndarray]:
        obj, img = [], []
        for t_idx, X in self.track_point.items():
            kp = self.tracks[t_idx].get(view)
            if kp is not None:
                obj.append(X)
                img.append(self.views[view].features.points[kp])
        return np.asarray(obj, np.float64).reshape(-1, 3), np.asarray(img, np.float64).reshape(-1, 2)

    def _register(self, view: int) -> bool:
        obj, img = self._correspondences(view)
        label = self.views[view].label
        need = self.opt.min_pnp_correspondences
        if len(obj) < need:
            self.unregistered[view] = (
                f"{label} could not be registered: only {len(obj)} of its features match reconstructed points "
                f"(need {need}). Add frames with more overlap with the other cameras."
            )
            return False
        intr = self.views[view].intr
        ok, rvec, tvec, inliers = cv2.solvePnPRansac(
            obj, img, intr.K, intr.dist_coeffs,
            reprojectionError=self.opt.max_reprojection_px * 1.5, iterationsCount=2000, confidence=0.999,
            flags=cv2.SOLVEPNP_SQPNP,
        )
        if not ok or inliers is None or len(inliers) < need:
            n = 0 if inliers is None else len(inliers)
            self.unregistered[view] = f"{label} could not be registered: PnP found only {n} consistent correspondences."
            return False
        inl = inliers.ravel()
        rvec, tvec = cv2.solvePnPRefineLM(obj[inl], img[inl], intr.K, intr.dist_coeffs, rvec, tvec)
        self.poses[view] = Pose(cv2.Rodrigues(rvec)[0], tvec.ravel())
        self.unregistered.pop(view, None)
        return True

    def _bundle_adjust(self, iterations: int) -> None:
        if len(self.track_point) < 10:
            return
        views = sorted(self.poses)
        slot = {v: n for n, v in enumerate(views)}
        track_ids = list(self.track_point)
        cam_idx, pt_idx, obs, focal = [], [], [], []
        for p, t_idx in enumerate(track_ids):
            for v, kp in self.tracks[t_idx].items():
                if v in slot:
                    cam_idx.append(slot[v])
                    pt_idx.append(p)
                    obs.append(self.norm[v][kp])
                    focal.append(self.views[v].intr.fx)
        poses, points, report = bundle_adjust(
            [self.poses[v] for v in views],
            np.array([self.track_point[t] for t in track_ids]),
            np.array(cam_idx),
            np.array(pt_idx),
            np.array(obs),
            np.array(focal, dtype=np.float64),
            fixed_cameras=(slot[self.reference],),
            iterations=iterations,
        )
        self.ba_reports.append(report)
        for v, pose in zip(views, poses):
            self.poses[v] = pose
        for t_idx, X in zip(track_ids, points):
            if self._track_error(X, self.tracks[t_idx]) > self.opt.max_reprojection_px:
                del self.track_point[t_idx]
            else:
                self.track_point[t_idx] = X

    # -- driver -----------------------------------------------------------------------------
    def run(self) -> SparseResult:
        if not self.tracks:
            raise ProcessingError(
                "No feature tracks connect the cameras.",
                code="insufficient_matches",
                hint="The cameras do not appear to observe a common part of the scene.",
            )
        i, j = self._choose_initial_pair()
        self.reference = i
        self._initialise(i, j)
        self._bundle_adjust(iterations=15)

        pending = set(range(len(self.views))) - set(self.poses)
        while pending:
            ranked = sorted(pending, key=lambda v: len(self._correspondences(v)[0]), reverse=True)
            progressed = False
            for view in ranked:
                if self._register(view):
                    pending.discard(view)
                    self._triangulate_new_tracks()
                    self._bundle_adjust(iterations=10)
                    progressed = True
                    break
            if not progressed:
                break

        for _ in range(self.opt.refinement_rounds):
            self._bundle_adjust(iterations=25)
            self._triangulate_new_tracks()

        for view in pending:
            self.warnings.append(self.unregistered.get(view, f"{self.views[view].label} was not registered."))
        return self._result((i, j))

    def _result(self, initial_pair: tuple[int, int]) -> SparseResult:
        items = sorted(self.track_point.items())
        points = np.array([X for _, X in items]).reshape(-1, 3)
        observations = [{v: kp for v, kp in self.tracks[t].items() if v in self.poses} for t, _ in items]
        errors = np.array([self._track_error(X, self.tracks[t]) for t, X in items])
        colors = np.zeros((len(points), 3), np.uint8)
        for n, obs in enumerate(observations):
            v, kp = next(iter(obs.items()))
            x, y = self.views[v].features.points[kp]
            img = self.views[v].image_rgb
            colors[n] = img[min(int(round(y)), img.shape[0] - 1), min(int(round(x)), img.shape[1] - 1)]
        return SparseResult(
            poses=dict(self.poses),
            points=points,
            colors=colors,
            observations=observations,
            point_errors=errors,
            initial_pair=initial_pair,
            unregistered=dict(self.unregistered),
            warnings=list(self.warnings),
            ba_reports=list(self.ba_reports),
        )
