from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app import __version__
from app.core.config import get_settings
from app.database.session import get_db
from app.services.detector_registry import detector_registry

router = APIRouter(tags=["health"])


@router.get("/health")
def health(db: Session = Depends(get_db)) -> dict:
    try:
        db.execute(text("SELECT 1"))
        database = "ok"
    except Exception:  # pragma: no cover - depends on infrastructure
        database = "unavailable"
    s = get_settings()
    return {
        "status": "ok" if database == "ok" else "degraded",
        "version": __version__,
        "database": database,
        "detector": detector_registry.describe(),
        "limits": {
            "maxImageMb": s.max_image_mb,
            "maxVideoMb": s.max_video_mb,
            "maxCameras": s.max_cameras,
            "maxFramesPerCamera": s.max_frames_per_camera,
            "processingTimeoutS": s.processing_timeout_s,
        },
    }
