"""Keypoint detection, descriptor matching and geometric verification."""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Literal

import cv2
import numpy as np

from app.core.errors import ValidationFailed

DetectorName = Literal["sift", "orb", "akaze"]
SUPPORTED_DETECTORS: tuple[DetectorName, ...] = ("sift", "orb", "akaze")


@dataclass
class Features:
    points: np.ndarray  # (N, 2) float32 pixel coordinates
    descriptors: np.ndarray | None
    detector: DetectorName
    elapsed_ms: float

    def __len__(self) -> int:
        return len(self.points)


@dataclass
class MatchResult:
    idx_a: np.ndarray  # indices into features A
    idx_b: np.ndarray  # indices into features B
    ratios: np.ndarray  # Lowe ratio of each tentative match (lower is more distinctive)
    inlier_mask: np.ndarray  # bool, RANSAC inliers of the fundamental matrix
    F: np.ndarray | None
    elapsed_ms: float

    @property
    def num_tentative(self) -> int:
        return len(self.idx_a)

    @property
    def num_inliers(self) -> int:
        return int(self.inlier_mask.sum())

    @property
    def inlier_ratio(self) -> float:
        return self.num_inliers / self.num_tentative if self.num_tentative else 0.0


def _create_detector(name: DetectorName, max_features: int):
    if name == "sift":
        return cv2.SIFT_create(nfeatures=max_features, contrastThreshold=0.02)
    if name == "orb":
        return cv2.ORB_create(nfeatures=max_features, scaleFactor=1.2, nlevels=8, fastThreshold=10)
    if name == "akaze":
        if not hasattr(cv2, "AKAZE_create"):
            raise ValidationFailed(
                "AKAZE is not available in the installed OpenCV build.",
                hint="Install opencv-python-headless 4.x (see requirements.txt) or choose SIFT/ORB.",
            )
        return cv2.AKAZE_create(threshold=0.0008)
    raise ValidationFailed(
        f"Unknown feature detector '{name}'.",
        hint=f"Use one of: {', '.join(SUPPORTED_DETECTORS)}.",
    )


def detect_features(gray: np.ndarray, detector: DetectorName = "sift", max_features: int = 4000) -> Features:
    if gray.ndim != 2:
        raise ValueError("detect_features expects a single-channel image")
    start = time.perf_counter()
    engine = _create_detector(detector, max_features)
    keypoints, descriptors = engine.detectAndCompute(gray, None)
    if detector == "akaze" and len(keypoints) > max_features:
        order = np.argsort([-kp.response for kp in keypoints])[:max_features]
        keypoints = [keypoints[i] for i in order]
        descriptors = descriptors[order]
    points = np.array([kp.pt for kp in keypoints], dtype=np.float32).reshape(-1, 2)
    return Features(points, descriptors, detector, (time.perf_counter() - start) * 1000)


def _norm_for(detector: DetectorName) -> int:
    return cv2.NORM_L2 if detector == "sift" else cv2.NORM_HAMMING


def match_features(
    a: Features,
    b: Features,
    ratio: float = 0.75,
    ransac_threshold_px: float = 1.5,
) -> MatchResult:
    """Ratio-test matching followed by fundamental-matrix RANSAC.

    Mutual (cross-checked) matches only: a match is kept if it passes the ratio test
    in the A→B direction and B's best neighbour is the same point in A.
    """
    if not 0.3 <= ratio <= 0.99:
        raise ValidationFailed("Matching ratio must be between 0.30 and 0.99.", details={"ratio": ratio})
    start = time.perf_counter()
    empty = np.empty(0, dtype=np.int64)
    if a.descriptors is None or b.descriptors is None or len(a) < 2 or len(b) < 2:
        return MatchResult(empty, empty, np.empty(0), np.zeros(0, bool), None, 0.0)

    matcher = cv2.BFMatcher(_norm_for(a.detector))
    forward = matcher.knnMatch(a.descriptors, b.descriptors, k=2)
    backward = matcher.match(b.descriptors, a.descriptors)
    best_back = {m.queryIdx: m.trainIdx for m in backward}

    idx_a, idx_b, ratios = [], [], []
    for pair in forward:
        if len(pair) < 2:
            continue
        best, second = pair
        if second.distance <= 0:
            continue
        r = best.distance / second.distance
        if r < ratio and best_back.get(best.trainIdx) == best.queryIdx:
            idx_a.append(best.queryIdx)
            idx_b.append(best.trainIdx)
            ratios.append(r)

    idx_a_arr = np.asarray(idx_a, dtype=np.int64)
    idx_b_arr = np.asarray(idx_b, dtype=np.int64)
    ratios_arr = np.asarray(ratios, dtype=np.float64)
    inliers = np.zeros(len(idx_a_arr), dtype=bool)
    F = None
    if len(idx_a_arr) >= 8:
        F, mask = cv2.findFundamentalMat(
            a.points[idx_a_arr], b.points[idx_b_arr], cv2.USAC_MAGSAC, ransac_threshold_px, 0.999, 10000
        )
        if mask is not None and F is not None and F.shape == (3, 3):
            inliers = mask.ravel().astype(bool)
        else:
            F = None
    return MatchResult(idx_a_arr, idx_b_arr, ratios_arr, inliers, F, (time.perf_counter() - start) * 1000)
