"""YOLOv8-style ONNX detector running on OpenCV's DNN module (CPU).

Expected model output: (1, 4 + num_classes, num_anchors) with boxes as (cx, cy, w, h)
in input-image pixels, which is what ``yolo export format=onnx`` produces.
No model file ships with this repository; see docs/models.md.
"""

from __future__ import annotations

import logging
from pathlib import Path

import cv2
import numpy as np

from app.core.errors import ServiceUnavailable
from app.detection.base import Detection2D
from app.detection.labels import COCO_LABELS

log = logging.getLogger(__name__)


def decode_yolo_output(
    output: np.ndarray,
    labels: list[str],
    scale: float,
    pad: tuple[float, float],
    conf_threshold: float,
    nms_threshold: float,
) -> list[Detection2D]:
    preds = np.squeeze(output, 0).T  # (anchors, 4 + C)
    if preds.shape[1] != 4 + len(labels):
        raise ValueError(f"Model predicts {preds.shape[1] - 4} classes but {len(labels)} labels were provided")
    class_scores = preds[:, 4:]
    cls_ids = class_scores.argmax(1)
    scores = class_scores[np.arange(len(preds)), cls_ids]
    keep = scores >= conf_threshold
    if not keep.any():
        return []
    boxes = preds[keep, :4].copy()
    scores, cls_ids = scores[keep], cls_ids[keep]
    boxes[:, 0] = (boxes[:, 0] - pad[0]) / scale
    boxes[:, 1] = (boxes[:, 1] - pad[1]) / scale
    boxes[:, 2:] /= scale
    xywh = np.stack([boxes[:, 0] - boxes[:, 2] / 2, boxes[:, 1] - boxes[:, 3] / 2, boxes[:, 2], boxes[:, 3]], 1)
    chosen = cv2.dnn.NMSBoxesBatched(xywh.tolist(), scores.tolist(), cls_ids.tolist(), conf_threshold, nms_threshold)
    out = []
    for i in np.asarray(chosen).reshape(-1):
        x, y, w, h = xywh[i]
        out.append(Detection2D(labels[int(cls_ids[i])], float(scores[i]), (float(x), float(y), float(x + w), float(y + h))))
    return out


class OnnxYoloDetector:
    def __init__(self, model_path: Path, labels: list[str] | None = None, input_size: int = 640,
                 conf_threshold: float = 0.35, nms_threshold: float = 0.5):
        if not model_path.is_file():
            raise ServiceUnavailable(
                f"Detector model not found at {model_path.name}.",
                code="detector_unavailable",
                hint="Set DETECTOR_MODEL_PATH to an exported YOLOv8 ONNX file, or unset it to skip detection.",
            )
        self.net = cv2.dnn.readNetFromONNX(str(model_path))
        self.labels = labels or COCO_LABELS
        self.size = input_size
        self.conf = conf_threshold
        self.nms = nms_threshold
        self.name = f"yolo-onnx:{model_path.stem}"

    def detect(self, image_rgb: np.ndarray) -> list[Detection2D]:
        h, w = image_rgb.shape[:2]
        scale = self.size / max(h, w)
        resized = cv2.resize(image_rgb, (round(w * scale), round(h * scale)))
        canvas = np.full((self.size, self.size, 3), 114, np.uint8)
        pad = ((self.size - resized.shape[1]) / 2, (self.size - resized.shape[0]) / 2)
        y0, x0 = int(pad[1]), int(pad[0])
        canvas[y0 : y0 + resized.shape[0], x0 : x0 + resized.shape[1]] = resized
        blob = cv2.dnn.blobFromImage(canvas, 1 / 255.0, swapRB=False)
        self.net.setInput(blob)
        return decode_yolo_output(self.net.forward(), self.labels, scale, (x0, y0), self.conf, self.nms)


def load_detector(model_path: Path | None, labels_path: Path | None, input_size: int) -> OnnxYoloDetector | None:
    if model_path is None:
        return None
    labels = None
    if labels_path is not None and labels_path.is_file():
        labels = [line.strip() for line in labels_path.read_text().splitlines() if line.strip()]
    return OnnxYoloDetector(model_path, labels, input_size)
