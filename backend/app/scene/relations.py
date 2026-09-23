"""Rule-based spatial relations between 3D objects (the edges of the scene graph).

Every relation carries the measured quantity that triggered it so the UI can show
*why* an edge exists instead of presenting it as an opaque prediction.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

VEHICLE_CLASSES = {"car", "truck", "bus", "motorcycle", "bicycle", "van"}


@dataclass
class SceneObject:
    id: str
    cls: str
    center: np.ndarray
    size: np.ndarray  # (w, h, l)
    yaw: float = 0.0


@dataclass
class Region:
    id: str
    name: str
    polygon: np.ndarray  # (K, 2) in the ground plane (x, z)


@dataclass
class Relation:
    subject: str
    predicate: str
    object: str
    value: float | None = None
    unit: str | None = None

    def to_dict(self) -> dict:
        d = {"subject": self.subject, "predicate": self.predicate, "object": self.object}
        if self.value is not None:
            d["value"] = round(float(self.value), 3)
            d["unit"] = self.unit
        return d


def _footprint_radius(o: SceneObject) -> float:
    return 0.5 * float(np.hypot(o.size[0], o.size[2]))


def point_in_polygon(x: float, z: float, poly: np.ndarray) -> bool:
    inside = False
    n = len(poly)
    for i in range(n):
        x1, z1 = poly[i]
        x2, z2 = poly[(i + 1) % n]
        if (z1 > z) != (z2 > z):
            x_cross = x1 + (z - z1) * (x2 - x1) / (z2 - z1)
            if x < x_cross:
                inside = not inside
    return inside


def compute_relations(
    objects: list[SceneObject],
    regions: list[Region] | None = None,
    viewpoint: np.ndarray | None = None,
    near_distance: float = 2.0,
    unit: str = "m",
    ground_aligned: bool = True,
) -> list[Relation]:
    relations: list[Relation] = []
    regions = regions or []

    for i, a in enumerate(objects):
        for b in objects[i + 1 :]:
            gap = float(np.linalg.norm((a.center - b.center)[[0, 2]])) - _footprint_radius(a) - _footprint_radius(b)
            if gap < near_distance:
                relations.append(Relation(a.id, "near", b.id, max(gap, 0.0), unit))

    if viewpoint is not None:
        relations.extend(_occlusion_relations(objects, viewpoint, unit))

    for o in objects:
        bottom = o.center[1] - o.size[1] / 2
        for r in regions:
            if point_in_polygon(float(o.center[0]), float(o.center[2]), r.polygon):
                predicate = "on" if o.cls in VEHICLE_CLASSES else "inside"
                relations.append(Relation(o.id, predicate, r.id))
        if ground_aligned and not any(rel.subject == o.id and rel.predicate == "on" for rel in relations):
            if abs(bottom) < max(0.25, 0.15 * o.size[1]):
                relations.append(Relation(o.id, "on", "ground", abs(bottom), unit))

    return relations


def _occlusion_relations(objects: list[SceneObject], viewpoint: np.ndarray, unit: str) -> list[Relation]:
    """A is *behind* B (seen from the viewpoint) when their angular extents overlap and A is farther."""
    out = []
    info = []
    for o in objects:
        rel = o.center - viewpoint
        dist = float(np.linalg.norm(rel[[0, 2]]))
        bearing = float(np.arctan2(rel[0], rel[2]))
        half = float(np.arctan2(_footprint_radius(o), max(dist, 1e-6)))
        info.append((o, dist, bearing, half))
    for a, da, ba, ha in info:
        for b, db, bb, hb in info:
            if a.id == b.id or da <= db:
                continue
            overlap = (ha + hb) - abs(ba - bb)
            if overlap > 0 and da - db > 0.5 * (_footprint_radius(a) + _footprint_radius(b)):
                out.append(Relation(a.id, "behind", b.id, da - db, unit))
    return out
