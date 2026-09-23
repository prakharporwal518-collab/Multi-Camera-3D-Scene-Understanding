from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

# Used only when a camera has no calibration. A horizontal FOV of roughly 55 degrees
# is typical for webcams and phone main cameras, so the assumption is rarely wildly off,
# but results produced with it are flagged as approximate.
ASSUMED_FOCAL_FACTOR = 1.0


@dataclass
class Intrinsics:
    fx: float
    fy: float
    cx: float
    cy: float
    width: int
    height: int
    dist: list[float] = field(default_factory=lambda: [0.0, 0.0, 0.0, 0.0, 0.0])

    @property
    def K(self) -> np.ndarray:
        return np.array([[self.fx, 0.0, self.cx], [0.0, self.fy, self.cy], [0.0, 0.0, 1.0]])

    @property
    def dist_coeffs(self) -> np.ndarray:
        return np.asarray(self.dist, dtype=np.float64).reshape(-1)

    @property
    def fov_y_deg(self) -> float:
        return float(np.degrees(2 * np.arctan2(self.height / 2, self.fy)))

    def scaled(self, width: int, height: int) -> "Intrinsics":
        """Intrinsics for the same camera at a different image resolution."""
        sx, sy = width / self.width, height / self.height
        return Intrinsics(
            fx=self.fx * sx,
            fy=self.fy * sy,
            cx=self.cx * sx,
            cy=self.cy * sy,
            width=width,
            height=height,
            dist=list(self.dist),
        )

    def to_dict(self) -> dict:
        return {
            "fx": self.fx,
            "fy": self.fy,
            "cx": self.cx,
            "cy": self.cy,
            "width": self.width,
            "height": self.height,
            "dist": list(self.dist),
        }

    @classmethod
    def from_dict(cls, data: dict) -> "Intrinsics":
        return cls(
            fx=float(data["fx"]),
            fy=float(data["fy"]),
            cx=float(data["cx"]),
            cy=float(data["cy"]),
            width=int(data["width"]),
            height=int(data["height"]),
            dist=[float(v) for v in data.get("dist", [0, 0, 0, 0, 0])],
        )

    @classmethod
    def assumed(cls, width: int, height: int) -> "Intrinsics":
        focal = ASSUMED_FOCAL_FACTOR * max(width, height)
        return cls(fx=focal, fy=focal, cx=width / 2, cy=height / 2, width=width, height=height)


@dataclass
class Pose:
    """World-to-camera transform in OpenCV convention: x_cam = R @ x_world + t."""

    R: np.ndarray
    t: np.ndarray

    @property
    def center(self) -> np.ndarray:
        return -self.R.T @ self.t

    @property
    def projection(self) -> np.ndarray:
        return np.hstack([self.R, self.t.reshape(3, 1)])

    @classmethod
    def identity(cls) -> "Pose":
        return cls(np.eye(3), np.zeros(3))
