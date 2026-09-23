"""Lazily loads the optional object detector once and remembers why it is unavailable."""

from __future__ import annotations

import logging
import threading

from app.core.config import get_settings
from app.core.errors import AppError
from app.detection.onnx_detector import OnnxYoloDetector, load_detector

log = logging.getLogger(__name__)


class DetectorRegistry:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._loaded = False
        self._detector: OnnxYoloDetector | None = None
        self.status = "not_configured"
        self.message = "DETECTOR_MODEL_PATH is not set."

    def get(self) -> OnnxYoloDetector | None:
        with self._lock:
            if not self._loaded:
                self._load()
            return self._detector

    def _load(self) -> None:
        s = get_settings()
        self._loaded = True
        try:
            self._detector = load_detector(s.detector_model_path, s.detector_labels_path, s.detector_input_size)
        except AppError as err:
            self.status, self.message = "error", err.message
            return
        except Exception as exc:  # malformed ONNX file etc.
            log.exception("detector failed to load")
            self.status, self.message = "error", f"The detector model could not be loaded ({type(exc).__name__})."
            return
        if self._detector is not None:
            self.status, self.message = "ready", self._detector.name

    def describe(self) -> dict:
        self.get()
        return {"status": self.status, "message": self.message}


detector_registry = DetectorRegistry()
