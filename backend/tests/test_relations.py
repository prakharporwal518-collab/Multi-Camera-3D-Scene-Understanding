import numpy as np

from app.scene.relations import Region, SceneObject, compute_relations, point_in_polygon


def obj(id_, cls, x, z, size=(1.8, 1.5, 4.0), y=None):
    size = np.array(size, float)
    return SceneObject(id_, cls, np.array([x, size[1] / 2 if y is None else y, z]), size)


def preds(relations, subject=None):
    return {(r.subject, r.predicate, r.object) for r in relations if subject in (None, r.subject)}


def test_point_in_polygon():
    square = np.array([[0, 0], [2, 0], [2, 2], [0, 2]], float)
    assert point_in_polygon(1, 1, square)
    assert not point_in_polygon(3, 1, square)


def test_near_on_inside_and_ground():
    road = Region("road", "Road", np.array([[-5, 0], [0, 0], [0, 20], [-5, 20]], float))
    walk = Region("walk", "Sidewalk", np.array([[0, 0], [5, 0], [5, 20], [0, 20]], float))
    car = obj("car", "car", -2, 10)
    person = obj("p", "person", 1.0, 10, size=(0.5, 1.7, 0.4))
    far = obj("far", "person", 4.5, 19, size=(0.5, 1.7, 0.4))
    rel = compute_relations([car, person, far], [road, walk], viewpoint=None, near_distance=1.5)
    p = preds(rel)
    assert ("car", "near", "p") in p
    assert ("car", "on", "road") in p
    assert ("p", "inside", "walk") in p
    assert not any(r[1] == "near" and "far" in r for r in p)
    # ground relation is only added when no region already gives an "on" relation
    assert ("p", "on", "ground") in p
    assert ("car", "on", "ground") not in p


def test_floating_object_is_not_on_ground():
    drone = obj("d", "drone", 0, 5, size=(0.4, 0.2, 0.4), y=3.0)
    assert ("d", "on", "ground") not in preds(compute_relations([drone]))


def test_behind_relative_to_viewpoint():
    front = obj("front", "car", 0, 5)
    back = obj("back", "car", 0.5, 15)
    side = obj("side", "car", 12, 15)
    rel = compute_relations([front, back, side], viewpoint=np.array([0.0, 4.0, -5.0]), near_distance=0.1)
    p = preds(rel)
    assert ("back", "behind", "front") in p
    assert ("front", "behind", "back") not in p
    assert not any(r[0] == "side" and r[1] == "behind" for r in p)
