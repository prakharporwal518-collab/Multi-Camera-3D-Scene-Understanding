"""A small procedural street scene used for the demo dataset and for tests.

The scene is intentionally simple (a ground plane, building facades and boxes standing in
for vehicles and pedestrians) but it is rendered with textured surfaces so that the real
feature-matching and reconstruction code has something genuine to work on.

World frame: right-handed, +Y up, metres. Ground plane is y = 0.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from app.vision.camera_model import Intrinsics, Pose


@dataclass
class Box:
    name: str
    cls: str
    center: np.ndarray  # geometric centre (x, y, z)
    size: np.ndarray  # (width x, height y, depth z) before yaw
    yaw: float  # rotation about +Y, radians
    color: tuple[int, int, int]
    texture: str = "noise"  # noise | windows | panels
    dynamic: bool = False


@dataclass
class Plane:
    """Axis-aligned rectangle used for the ground and building facades."""

    axis: int  # normal axis: 0=x, 1=y, 2=z
    offset: float
    bounds: tuple[tuple[float, float], tuple[float, float]]  # ranges of the two in-plane axes (ascending axis order)
    texture: str
    facing: int  # +1 / -1: side of the plane that is visible


@dataclass
class ObjectState:
    name: str
    center: np.ndarray
    yaw: float


@dataclass
class SyntheticScene:
    planes: list[Plane]
    boxes: list[Box]
    regions: list[dict] = field(default_factory=list)

    def at_time(self, trajectories: dict[str, "Trajectory"], t: float) -> "SyntheticScene":
        moved = []
        for box in self.boxes:
            traj = trajectories.get(box.name)
            if traj is None:
                moved.append(box)
                continue
            state = traj.state(t)
            moved.append(Box(box.name, box.cls, state.center, box.size, state.yaw, box.color, box.texture, True))
        return SyntheticScene(self.planes, moved, self.regions)


@dataclass
class Trajectory:
    name: str
    waypoints: np.ndarray  # (K, 3) ground-level centre positions
    speed: float  # m/s along the polyline
    height: float  # centre height above ground

    def state(self, t: float) -> ObjectState:
        seg = np.diff(self.waypoints, axis=0)
        lengths = np.linalg.norm(seg, axis=1)
        dist = min(self.speed * t, lengths.sum() - 1e-6)
        k = int(np.searchsorted(np.cumsum(lengths), dist, side="right"))
        k = min(k, len(seg) - 1)
        start = np.concatenate([[0], np.cumsum(lengths)])[k]
        alpha = (dist - start) / lengths[k]
        pos = self.waypoints[k] + alpha * seg[k]
        direction = seg[k] / lengths[k]
        yaw = float(np.arctan2(direction[0], direction[2]))
        return ObjectState(self.name, np.array([pos[0], self.height, pos[2]]), yaw)


def look_at(eye: np.ndarray, target: np.ndarray, up: np.ndarray = np.array([0.0, 1.0, 0.0])) -> Pose:
    """World-to-camera pose for an OpenCV camera (x right, y down, z forward) at ``eye``."""
    z = target - eye
    z = z / np.linalg.norm(z)
    x = np.cross(z, up)
    x = x / np.linalg.norm(x)
    y = np.cross(z, x)
    R = np.stack([x, y, z])
    return Pose(R, -R @ eye)


def build_street_scene() -> tuple[SyntheticScene, dict[str, Trajectory]]:
    planes = [
        Plane(axis=1, offset=0.0, bounds=((-14, 14), (-6, 22)), texture="ground", facing=1),
        Plane(axis=2, offset=20.0, bounds=((-14, 14), (0, 9)), texture="facade", facing=-1),
        Plane(axis=0, offset=-12.0, bounds=((0, 7), (-6, 20)), texture="facade_side", facing=1),
        Plane(axis=0, offset=12.0, bounds=((0, 6), (-6, 20)), texture="facade_side", facing=-1),
    ]
    boxes = [
        Box("car_blue", "car", np.array([-3.2, 0.75, 9.0]), np.array([1.8, 1.5, 4.3]), 0.0, (52, 84, 140), "panels", True),
        Box("car_red", "car", np.array([4.6, 0.72, 13.5]), np.array([1.8, 1.45, 4.4]), 0.08, (150, 48, 44), "panels"),
        Box("van_white", "truck", np.array([-7.5, 1.1, 15.5]), np.array([2.0, 2.2, 5.2]), -0.05, (205, 205, 200), "panels"),
        Box("person_a", "person", np.array([1.0, 0.87, 6.0]), np.array([0.5, 1.74, 0.35]), 0.0, (70, 110, 60), "noise", True),
        Box("person_b", "person", np.array([6.5, 0.85, 8.0]), np.array([0.48, 1.7, 0.34]), 0.0, (120, 70, 110), "noise", True),
        Box("bench", "bench", np.array([8.5, 0.25, 17.0]), np.array([1.8, 0.5, 0.6]), 0.0, (110, 80, 50), "noise"),
        Box("bin", "trash_can", np.array([-10.0, 0.5, 11.0]), np.array([0.6, 1.0, 0.6]), 0.0, (60, 60, 60), "noise"),
    ]
    trajectories = {
        "car_blue": Trajectory("car_blue", np.array([[-3.2, 0, 3.0], [-3.2, 0, 17.0]]), 3.2, 0.75),
        "person_a": Trajectory("person_a", np.array([[-1.0, 0, 5.0], [1.5, 0, 6.5], [4.0, 0, 9.5]]), 1.3, 0.87),
        "person_b": Trajectory("person_b", np.array([[7.5, 0, 6.0], [7.0, 0, 11.0], [8.2, 0, 15.5]]), 1.1, 0.85),
    }
    regions = [
        {"id": "region_road", "name": "Road", "polygon": [[-6, -6], [0.5, -6], [0.5, 22], [-6, 22]]},
        {"id": "region_sidewalk", "name": "Sidewalk", "polygon": [[0.5, -6], [12, -6], [12, 22], [0.5, 22]]},
    ]
    return SyntheticScene(planes, boxes, regions), trajectories


def street_cameras(width: int = 1280, height: int = 720) -> list[tuple[str, Intrinsics, Pose]]:
    """Four cameras on poles along the near edge of the scene, all looking into the street."""
    focal = 0.9 * width
    target = np.array([0.5, 0.5, 11.0])
    rigs = [
        ("CAM-01", np.array([-7.0, 4.2, -3.0]), target + np.array([-1.0, 0, 0])),
        ("CAM-02", np.array([-2.0, 3.8, -4.5]), target),
        ("CAM-03", np.array([3.5, 4.0, -4.2]), target),
        ("CAM-04", np.array([8.5, 4.4, -2.5]), target + np.array([1.0, 0, 0])),
    ]
    cams = []
    for i, (label, eye, tgt) in enumerate(rigs):
        # Slightly different intrinsics per camera, as with real hardware.
        f = focal * (1.0 + 0.02 * (i - 1.5))
        intr = Intrinsics(fx=f, fy=f, cx=width / 2 + 3 * (i - 1), cy=height / 2 - 2 * (i - 2), width=width, height=height)
        cams.append((label, intr, look_at(eye, tgt)))
    return cams
