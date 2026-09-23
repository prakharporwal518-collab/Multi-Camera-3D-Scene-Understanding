import cv2
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import ValidationFailed
from app.database.session import get_db
from app.schemas.camera import MatchRequest
from app.services import media, storage
from app.services import project_service as svc
from app.vision.features import detect_features, match_features

router = APIRouter(tags=["feature matching"])
MAX_RETURNED_MATCHES = 3000


def _load_gray(project_id: str, camera, index: int):
    if index >= camera.frame_count:
        raise ValidationFailed(f"{camera.label} has only {camera.frame_count} frames; frame {index} does not exist.")
    rgb = media.load_frame_rgb(storage.frame_path(project_id, camera.id, index))
    max_dim = get_settings().processing_max_dimension
    h, w = rgb.shape[:2]
    scale = min(1.0, max_dim / max(h, w))
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    if scale < 1.0:
        gray = cv2.resize(gray, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA)
    return gray, scale


@router.post("/projects/{project_id}/feature-matching")
def feature_matching(project_id: str, body: MatchRequest, db: Session = Depends(get_db)) -> dict:
    """Detect and match features between two cameras on demand (not cached)."""
    project = svc.get_project(db, project_id)
    cams = {c.id: c for c in project.cameras}
    missing = [cid for cid in (body.camera_a, body.camera_b) if cid not in cams]
    if missing:
        raise ValidationFailed("Both cameras must belong to this project.", details={"unknown": missing})
    a, b = cams[body.camera_a], cams[body.camera_b]
    gray_a, sa = _load_gray(project.id, a, body.frame_index)
    gray_b, sb = _load_gray(project.id, b, body.frame_index)
    fa = detect_features(gray_a, body.detector, body.max_features)
    fb = detect_features(gray_b, body.detector, body.max_features)
    m = match_features(fa, fb, body.ratio)
    pts_a, pts_b = fa.points[m.idx_a] / sa, fb.points[m.idx_b] / sb
    rows = [
        [round(float(pa[0]), 1), round(float(pa[1]), 1), round(float(pb[0]), 1), round(float(pb[1]), 1), round(float(r), 3), bool(i)]
        for pa, pb, r, i in zip(pts_a, pts_b, m.ratios, m.inlier_mask)
    ][:MAX_RETURNED_MATCHES]
    return {
        "cameraA": a.id,
        "cameraB": b.id,
        "frameIndex": body.frame_index,
        "detector": body.detector,
        "ratio": body.ratio,
        "featuresA": len(fa),
        "featuresB": len(fb),
        "tentative": m.num_tentative,
        "inliers": m.num_inliers,
        "detectMsA": round(fa.elapsed_ms, 1),
        "detectMsB": round(fb.elapsed_ms, 1),
        "matchMs": round(m.elapsed_ms, 1),
        "matches": rows,
        "truncated": m.num_tentative > MAX_RETURNED_MATCHES,
    }
