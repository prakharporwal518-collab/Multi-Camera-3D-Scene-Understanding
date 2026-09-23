from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import numpy as np


@dataclass
class Detection2D:
    cls: str
    confidence: float
    box: tuple[float, float, float, float]  # x1, y1, x2, y2 in pixels

    @property
    def center(self) -> np.ndarray:
        x1, y1, x2, y2 = self.box
        return np.array([(x1 + x2) / 2, (y1 + y2) / 2])

    @property
    def bottom_center(self) -> np.ndarray:
        x1, _, x2, y2 = self.box
        return np.array([(x1 + x2) / 2, y2])

    def to_dict(self) -> dict:
        return {"class": self.cls, "confidence": round(self.confidence, 4), "box": [round(v, 1) for v in self.box]}


class Detector(Protocol):
    name: str

    def detect(self, image_rgb: np.ndarray) -> list[Detection2D]: ...
