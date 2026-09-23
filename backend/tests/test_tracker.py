import numpy as np
import pytest

from app.tracking.tracker import Tracker3D, TrackInput


def det(cls, x, z, conf=0.9):
    return TrackInput(cls, conf, np.array([x, 0.8, z]), np.array([0.5, 1.7, 0.5]), ["cam01"])


def test_two_walkers_keep_their_ids():
    rng = np.random.default_rng(0)
    tracker = Tracker3D(gate=1.5, min_hits=2)
    for step in range(10):
        t = step * 0.5
        a = det("person", 0 + 1.2 * t + rng.normal(0, 0.05), 5)
        b = det("person", 6 - 1.0 * t + rng.normal(0, 0.05), 8)
        tracker.update(t, [b, a] if step % 2 else [a, b])  # order must not matter
    tracks = tracker.confirmed_tracks()
    assert len(tracks) == 2
    by_z = sorted(tracks, key=lambda tr: tr.states[0].position[2])
    assert all(abs(s.position[2] - 5) < 0.3 for s in by_z[0].states)
    assert all(abs(s.position[2] - 8) < 0.3 for s in by_z[1].states)
    # velocity converges towards the true value (+1.2 m/s along x)
    assert by_z[0].last.velocity[0] == pytest.approx(1.2, abs=0.25)


def test_classes_are_never_associated():
    tracker = Tracker3D(gate=5, min_hits=2)
    tracker.update(0.0, [det("car", 0, 0)])
    tracker.update(0.5, [det("person", 0.1, 0)])
    tracker.update(1.0, [det("person", 0.2, 0)])
    classes = sorted(tr.cls for tr in tracker.confirmed_tracks())
    assert classes == ["person"]


def test_confirmed_track_coasts_through_a_missed_frame():
    tracker = Tracker3D(gate=1.0, min_hits=2, max_misses=2)
    for step, x in enumerate([0.0, 1.0, 2.0]):
        tracker.update(float(step), [det("car", x, 0)])
    tracker.update(3.0, [])  # missed detection
    tracker.update(4.0, [det("car", 4.0, 0)])
    tracks = tracker.confirmed_tracks()
    assert len(tracks) == 1
    assert [s.observed for s in tracks[0].states] == [True, True, True, False, True]


def test_timestamps_must_not_go_backwards():
    tracker = Tracker3D()
    tracker.update(1.0, [])
    with pytest.raises(ValueError):
        tracker.update(0.5, [])
