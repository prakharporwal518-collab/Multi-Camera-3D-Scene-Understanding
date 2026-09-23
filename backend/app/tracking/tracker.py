"""Multi-object tracking in 3D with an alpha-beta (constant velocity) filter.

Association is greedy nearest-neighbour inside a distance gate and restricted to the
same class. This is deliberately simple and deterministic; for dense crowds a global
assignment (Hungarian) and a full Kalman filter would be the next step.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np


@dataclass
class TrackInput:
    cls: str
    confidence: float
    position: np.ndarray
    size: np.ndarray
    cameras: list[str]


@dataclass
class TrackState:
    t: float
    position: np.ndarray
    velocity: np.ndarray
    size: np.ndarray
    confidence: float
    cameras: list[str]
    observed: bool


@dataclass
class Track:
    id: int
    cls: str
    states: list[TrackState] = field(default_factory=list)
    hits: int = 0
    misses: int = 0
    status: str = "tentative"  # tentative | confirmed | lost

    @property
    def last(self) -> TrackState:
        return self.states[-1]

    @property
    def confidence(self) -> float:
        observed = [s.confidence for s in self.states if s.observed]
        coverage = len(observed) / len(self.states)
        return float(np.mean(observed) * coverage) if observed else 0.0


class Tracker3D:
    def __init__(self, gate: float = 2.5, max_misses: int = 3, min_hits: int = 3, alpha: float = 0.6, beta: float = 0.3):
        self.gate = gate
        self.max_misses = max_misses
        self.min_hits = min_hits
        self.alpha = alpha
        self.beta = beta
        self.tracks: list[Track] = []
        self._next_id = 1
        self._last_t: float | None = None

    def update(self, t: float, detections: list[TrackInput]) -> None:
        dt = 0.0 if self._last_t is None else t - self._last_t
        if dt < 0:
            raise ValueError("Timestamps must be non-decreasing")
        self._last_t = t
        active = [tr for tr in self.tracks if tr.status != "lost"]
        predicted = {tr.id: tr.last.position + tr.last.velocity * dt for tr in active}

        pairs = []
        for ti, tr in enumerate(active):
            for di, det in enumerate(detections):
                if det.cls != tr.cls:
                    continue
                dist = float(np.linalg.norm((det.position - predicted[tr.id])[[0, 2]]))
                if dist <= self.gate:
                    pairs.append((dist, ti, di))
        pairs.sort()
        matched_t, matched_d = set(), set()
        for _, ti, di in pairs:
            if ti in matched_t or di in matched_d:
                continue
            matched_t.add(ti)
            matched_d.add(di)
            self._correct(active[ti], detections[di], predicted[active[ti].id], t, dt)

        for ti, tr in enumerate(active):
            if ti not in matched_t:
                self._coast(tr, predicted[tr.id], t)
        for di, det in enumerate(detections):
            if di not in matched_d:
                self._spawn(det, t)

    def _correct(self, tr: Track, det: TrackInput, pred: np.ndarray, t: float, dt: float) -> None:
        if tr.hits == 1 and dt > 0:
            # Two-point initialisation: the first velocity estimate is the finite difference.
            pos = det.position.copy()
            vel = (det.position - tr.last.position) / dt
        else:
            residual = det.position - pred
            pos = pred + self.alpha * residual
            vel = tr.last.velocity + (self.beta * residual / dt if dt > 0 else 0)
        size = 0.7 * tr.last.size + 0.3 * det.size
        tr.states.append(TrackState(t, pos, vel, size, det.confidence, det.cameras, True))
        tr.hits += 1
        tr.misses = 0
        if tr.status == "tentative" and tr.hits >= self.min_hits:
            tr.status = "confirmed"

    def _coast(self, tr: Track, pred: np.ndarray, t: float) -> None:
        tr.states.append(TrackState(t, pred, tr.last.velocity, tr.last.size, 0.0, [], False))
        tr.misses += 1
        # A tentative track that misses a frame is dropped; a confirmed one may coast.
        if tr.status == "tentative" or tr.misses > self.max_misses:
            tr.status = "lost"

    def _spawn(self, det: TrackInput, t: float) -> None:
        tr = Track(self._next_id, det.cls)
        tr.states.append(TrackState(t, det.position.copy(), np.zeros(3), det.size, det.confidence, det.cameras, True))
        tr.hits = 1
        if self.min_hits <= 1:
            tr.status = "confirmed"
        self.tracks.append(tr)
        self._next_id += 1

    def confirmed_tracks(self) -> list[Track]:
        """Tracks that were confirmed at some point, trimmed of trailing coasted states."""
        out = []
        for tr in self.tracks:
            if tr.hits < self.min_hits:
                continue
            while tr.states and not tr.states[-1].observed:
                tr.states.pop()
            out.append(tr)
        return out
