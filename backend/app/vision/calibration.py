"""Intrinsic calibration.

Three sources of intrinsics are supported, in decreasing order of trust:

* ``checkerboard`` - Zhang's method on frames that show a planar checkerboard.
* ``manual``       - values entered by the user (e.g. from a previous calibration).
* ``assumed``      - a focal length guessed from the image size. Used only as a fallback
                     and always reported as approximate.
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from app.core.errors import ProcessingError, ValidationFailed
from app.vision.camera_model import Intrinsics

MIN_CHECKERBOARD_VIEWS = 3


@dataclass
class CalibrationOutcome:
    intrinsics: Intrinsics
    method: str
    reprojection_error_px: float | None
    views_used: int
    views_total: int

    @property
    def quality(self) -> str:
        """Coarse rating shown in the UI. Thresholds follow common OpenCV practice."""
        if self.method == "assumed" or self.reprojection_error_px is None:
            return "unknown"
        if self.reprojection_error_px < 0.5:
            return "good"
        if self.reprojection_error_px < 1.0:
            return "acceptable"
        return "poor"


def validate_manual_intrinsics(values: dict, width: int, height: int) -> Intrinsics:
    fx, fy = float(values["fx"]), float(values["fy"])
    cx, cy = float(values["cx"]), float(values["cy"])
    if fx <= 0 or fy <= 0:
        raise ValidationFailed("Focal lengths must be positive.", details={"fx": fx, "fy": fy})
    if not (0 < cx < width and 0 < cy < height):
        raise ValidationFailed(
            "The principal point must lie inside the image.",
            hint=f"Expected 0 < cx < {width} and 0 < cy < {height}.",
            details={"cx": cx, "cy": cy},
        )
    ratio = fx / fy
    if not 0.5 < ratio < 2.0:
        raise ValidationFailed(
            "fx and fy differ by more than a factor of two, which is almost certainly a typo.",
            details={"fx": fx, "fy": fy},
        )
    dist = [float(v) for v in values.get("dist", [0, 0, 0, 0, 0])]
    if len(dist) not in (4, 5, 8):
        raise ValidationFailed("Distortion must have 4, 5 or 8 coefficients (OpenCV order k1 k2 p1 p2 [k3 ...]).")
    if any(abs(v) > 50 for v in dist):
        raise ValidationFailed("Distortion coefficients look out of range (|k| > 50).")
    return Intrinsics(fx, fy, cx, cy, width, height, dist + [0.0] * (5 - len(dist)) if len(dist) < 5 else dist)


def calibrate_checkerboard(
    gray_images: list[np.ndarray],
    pattern_cols: int,
    pattern_rows: int,
    square_size_m: float,
) -> CalibrationOutcome:
    """Calibrate from frames of a checkerboard with ``pattern_cols x pattern_rows`` inner corners."""
    if pattern_cols < 3 or pattern_rows < 3:
        raise ValidationFailed("A checkerboard needs at least 3 x 3 inner corners.")
    if square_size_m <= 0:
        raise ValidationFailed("Square size must be positive.")
    if not gray_images:
        raise ValidationFailed("This camera has no frames to calibrate from.")

    height, width = gray_images[0].shape[:2]
    template = np.zeros((pattern_rows * pattern_cols, 3), np.float32)
    template[:, :2] = np.mgrid[0:pattern_cols, 0:pattern_rows].T.reshape(-1, 2) * square_size_m

    object_points, image_points = [], []
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 1e-3)
    flags = cv2.CALIB_CB_ADAPTIVE_THRESH | cv2.CALIB_CB_NORMALIZE_IMAGE
    for gray in gray_images:
        if gray.shape[:2] != (height, width):
            continue
        found, corners = cv2.findChessboardCorners(gray, (pattern_cols, pattern_rows), flags)
        if not found:
            continue
        corners = cv2.cornerSubPix(gray, corners, (11, 11), (-1, -1), criteria)
        object_points.append(template)
        image_points.append(corners)

    if len(image_points) < MIN_CHECKERBOARD_VIEWS:
        raise ProcessingError(
            f"The checkerboard was found in {len(image_points)} of {len(gray_images)} frames; "
            f"at least {MIN_CHECKERBOARD_VIEWS} are required.",
            code="calibration_failed",
            hint=(
                f"Check that the pattern size ({pattern_cols} x {pattern_rows} inner corners) matches the printed "
                "board and that the whole board is visible and in focus in several frames."
            ),
        )

    rms, K, dist, _, _ = cv2.calibrateCamera(object_points, image_points, (width, height), None, None)
    intr = Intrinsics(
        fx=float(K[0, 0]),
        fy=float(K[1, 1]),
        cx=float(K[0, 2]),
        cy=float(K[1, 2]),
        width=width,
        height=height,
        dist=[float(v) for v in dist.ravel()[:5]],
    )
    return CalibrationOutcome(intr, "checkerboard", float(rms), len(image_points), len(gray_images))
