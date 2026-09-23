"""Validation and ingestion of uploaded images and videos."""

from __future__ import annotations

import os
import tempfile
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
from fastapi import UploadFile

from app.core.config import get_settings
from app.core.errors import PayloadTooLarge, ProcessingError, UnsupportedMedia, ValidationFailed

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tif", ".tiff"}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv", ".webm"}
MIN_DIMENSION = 64
CHUNK = 1024 * 1024


@dataclass
class DecodedFrame:
    image_bgr: np.ndarray
    source_name: str

    @property
    def size(self) -> tuple[int, int]:
        h, w = self.image_bgr.shape[:2]
        return w, h


@dataclass
class VideoFrames:
    frames: list[np.ndarray]
    fps: float | None
    total_frames: int | None
    stride: int


def _extension(filename: str | None) -> str:
    return Path(filename or "").suffix.lower()


def _display_name(filename: str | None) -> str:
    # Only used in messages; strip any directory component a client may send.
    return Path(filename or "unnamed").name[:80]


async def read_limited(upload: UploadFile, max_bytes: int) -> bytes:
    buf = bytearray()
    while chunk := await upload.read(CHUNK):
        buf.extend(chunk)
        if len(buf) > max_bytes:
            raise PayloadTooLarge(
                f"'{_display_name(upload.filename)}' is larger than the {max_bytes // CHUNK} MB limit.",
                hint="Downscale the images or split the upload into smaller batches.",
            )
    return bytes(buf)


def decode_image(data: bytes, filename: str | None) -> DecodedFrame:
    name = _display_name(filename)
    if _extension(filename) not in IMAGE_EXTENSIONS:
        raise UnsupportedMedia(
            f"'{name}' is not a supported image type.",
            hint=f"Supported formats: {', '.join(sorted(e.lstrip('.') for e in IMAGE_EXTENSIONS))}.",
        )
    if not data:
        raise ValidationFailed(f"'{name}' is empty.")
    image = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValidationFailed(
            f"'{name}' could not be decoded. The file may be corrupted or not actually an image.",
            code="invalid_image",
        )
    h, w = image.shape[:2]
    limit = get_settings().max_image_dimension
    if min(h, w) < MIN_DIMENSION:
        raise ValidationFailed(f"'{name}' is only {w}×{h} px; frames must be at least {MIN_DIMENSION} px on each side.")
    if max(h, w) > limit:
        raise ValidationFailed(f"'{name}' is {w}×{h} px; the maximum supported side length is {limit} px.")
    return DecodedFrame(image, name)


async def extract_video(upload: UploadFile, max_frames: int, stride: int) -> VideoFrames:
    name = _display_name(upload.filename)
    if _extension(upload.filename) not in VIDEO_EXTENSIONS:
        raise UnsupportedMedia(
            f"'{name}' is not a supported video type.",
            hint=f"Supported formats: {', '.join(sorted(e.lstrip('.') for e in VIDEO_EXTENSIONS))}.",
        )
    if stride < 1:
        raise ValidationFailed("Frame stride must be at least 1.")
    max_bytes = int(get_settings().max_video_mb * CHUNK)
    fd, tmp_name = tempfile.mkstemp(suffix=_extension(upload.filename))
    try:
        size = 0
        with os.fdopen(fd, "wb") as fh:
            while chunk := await upload.read(CHUNK):
                size += len(chunk)
                if size > max_bytes:
                    raise PayloadTooLarge(
                        f"'{name}' is larger than the {int(get_settings().max_video_mb)} MB video limit.",
                        hint="Trim the clip or re-encode it at a lower bitrate.",
                    )
                fh.write(chunk)
        if size == 0:
            raise ValidationFailed(f"'{name}' is empty.")
        return _read_video(tmp_name, name, max_frames, stride)
    finally:
        Path(tmp_name).unlink(missing_ok=True)


def _read_video(path: str, name: str, max_frames: int, stride: int) -> VideoFrames:
    cap = cv2.VideoCapture(path)
    try:
        if not cap.isOpened():
            raise ProcessingError(
                f"'{name}' could not be opened. The file may be corrupted or use an unsupported codec.",
                code="invalid_video",
                hint="Re-encode the video as H.264 MP4, or upload the frames as images.",
            )
        fps = cap.get(cv2.CAP_PROP_FPS)
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or None
        frames: list[np.ndarray] = []
        index = 0
        while len(frames) < max_frames:
            ok, frame = cap.read()
            if not ok:
                break
            if index % stride == 0:
                frames.append(frame)
            index += 1
    finally:
        cap.release()
    if not frames:
        raise ProcessingError(
            f"No frames could be decoded from '{name}'.",
            code="invalid_video",
            hint="The video may be truncated or corrupted. Try re-exporting it.",
        )
    h, w = frames[0].shape[:2]
    if min(h, w) < MIN_DIMENSION:
        raise ValidationFailed(f"'{name}' has a resolution of {w}×{h} px, which is too small.")
    valid_fps = float(fps) / stride if fps and 0 < fps <= 480 else None
    return VideoFrames(frames, valid_fps, total, stride)


def save_frame(image_bgr: np.ndarray, path: Path) -> None:
    """Re-encode as JPEG. This also strips EXIF/metadata and anything appended to the original file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    if not cv2.imwrite(str(path), image_bgr, [cv2.IMWRITE_JPEG_QUALITY, 92]):
        raise ProcessingError("A frame could not be written to storage.", code="storage_error", status_code=500)


def load_frame_rgb(path: Path) -> np.ndarray:
    image = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if image is None:
        raise ProcessingError(f"Stored frame {path.name} is missing or unreadable.", code="storage_error", status_code=500)
    return cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
