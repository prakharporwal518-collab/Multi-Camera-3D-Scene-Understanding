import cv2
from fastapi import APIRouter, Depends, File, Form, Response, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import AppError, ConflictError, NotFoundError, ValidationFailed
from app.database.session import get_db
from app.schemas.camera import CalibrationRequest, CameraCreate, CameraOut, CameraUpdate, UploadResult
from app.services import media, storage
from app.services import project_service as svc
from app.vision.calibration import calibrate_checkerboard, validate_manual_intrinsics

router = APIRouter(tags=["cameras"])
MAX_FILES_PER_REQUEST = 60


@router.get("/projects/{project_id}/cameras", response_model=list[CameraOut])
def list_cameras(project_id: str, db: Session = Depends(get_db)):
    return [svc.camera_out(c) for c in svc.get_project(db, project_id).cameras]


@router.post("/projects/{project_id}/cameras", response_model=CameraOut, status_code=status.HTTP_201_CREATED)
def create_camera(project_id: str, body: CameraCreate, db: Session = Depends(get_db)):
    project = svc.get_project(db, project_id)
    return svc.camera_out(svc.add_camera(db, project, body.name))


@router.get("/cameras/{camera_id}", response_model=CameraOut)
def get_camera(camera_id: str, db: Session = Depends(get_db)):
    return svc.camera_out(svc.get_camera(db, camera_id))


@router.patch("/cameras/{camera_id}", response_model=CameraOut)
def rename_camera(camera_id: str, body: CameraUpdate, db: Session = Depends(get_db)):
    camera = svc.get_camera(db, camera_id)
    camera.name = body.name
    db.commit()
    return svc.camera_out(camera)


@router.delete("/cameras/{camera_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_camera(camera_id: str, db: Session = Depends(get_db)):
    svc.delete_camera(db, svc.get_camera(db, camera_id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _check_capacity(camera, adding: int) -> None:
    limit = get_settings().max_frames_per_camera
    if camera.frame_count + adding > limit:
        raise ValidationFailed(
            f"{camera.label} would have {camera.frame_count + adding} frames; the limit is {limit}.",
            code="frame_limit",
            hint="Upload fewer frames or use a larger frame stride for videos.",
        )


def _check_resolution(camera, width: int, height: int, source: str) -> None:
    if camera.width and (camera.width, camera.height) != (width, height):
        raise ValidationFailed(
            f"'{source}' is {width}×{height} px but {camera.label} already has {camera.width}×{camera.height} px frames.",
            code="resolution_mismatch",
            hint="All frames of one camera must share a resolution. Clear the existing frames to switch.",
        )


@router.post("/cameras/{camera_id}/frames", response_model=UploadResult, status_code=status.HTTP_201_CREATED)
async def upload_frames(camera_id: str, files: list[UploadFile] = File(...), db: Session = Depends(get_db)):
    camera = svc.get_camera(db, camera_id)
    svc.ensure_idle(camera.project, "upload frames")
    if not files:
        raise ValidationFailed("No files were uploaded.")
    if len(files) > MAX_FILES_PER_REQUEST:
        raise ValidationFailed(f"Upload at most {MAX_FILES_PER_REQUEST} images per request.", code="too_many_files")
    if camera.source_kind == "video":
        raise ConflictError(f"{camera.label} already holds frames extracted from a video.", hint="Clear its frames first.")
    _check_capacity(camera, len(files))

    max_bytes = int(get_settings().max_image_mb * 1024 * 1024)
    accepted, skipped = [], []
    width, height = camera.width, camera.height
    for upload in sorted(files, key=lambda f: f.filename or ""):
        try:
            frame = media.decode_image(await media.read_limited(upload, max_bytes), upload.filename)
            w, h = frame.size
            if width is None:
                width, height = w, h
            elif (w, h) != (width, height):
                raise ValidationFailed(
                    f"'{frame.source_name}' is {w}×{h} px but the other frames are {width}×{height} px.",
                    code="resolution_mismatch",
                )
            accepted.append(frame)
        except AppError as err:
            # One bad file should not discard a whole batch; report it and continue.
            skipped.append({"file": media._display_name(upload.filename), **err.to_dict()["error"]})
    if not accepted:
        first = skipped[0] if skipped else {"message": "No valid images."}
        raise ValidationFailed(
            "None of the uploaded files could be used. " + first["message"],
            code="no_valid_images",
            details={"skipped": skipped},
        )
    for n, frame in enumerate(accepted):
        media.save_frame(frame.image_bgr, storage.frame_path(camera.project_id, camera.id, camera.frame_count + n))
    camera.frame_count += len(accepted)
    camera.width, camera.height = width, height
    camera.source_kind = "images"
    svc.bump_version(camera.project)
    db.commit()
    return UploadResult(camera=svc.camera_out(camera), added=len(accepted), skipped=skipped)


@router.post("/cameras/{camera_id}/video", response_model=UploadResult, status_code=status.HTTP_201_CREATED)
async def upload_video(camera_id: str, file: UploadFile = File(...), stride: int = Form(1), db: Session = Depends(get_db)):
    camera = svc.get_camera(db, camera_id)
    svc.ensure_idle(camera.project, "upload a video")
    if camera.frame_count > 0:
        raise ConflictError(f"{camera.label} already has frames.", hint="Clear its frames before uploading a video.")
    if not 1 <= stride <= 100:
        raise ValidationFailed("Frame stride must be between 1 and 100.")
    video = await media.extract_video(file, get_settings().max_frames_per_camera, stride)
    h, w = video.frames[0].shape[:2]
    for n, frame in enumerate(video.frames):
        if frame.shape[:2] != (h, w):
            continue
        media.save_frame(frame, storage.frame_path(camera.project_id, camera.id, n))
    camera.frame_count = len(video.frames)
    camera.width, camera.height, camera.fps = w, h, video.fps
    camera.source_kind = "video"
    svc.bump_version(camera.project)
    db.commit()
    skipped = []
    if video.total_frames and video.total_frames > len(video.frames) * video.stride:
        skipped.append({"message": f"Only the first {len(video.frames)} frames (after stride) were kept; the limit per camera is {get_settings().max_frames_per_camera}."})
    return UploadResult(camera=svc.camera_out(camera), added=len(video.frames), skipped=skipped)


@router.delete("/cameras/{camera_id}/frames", response_model=CameraOut)
def clear_frames(camera_id: str, db: Session = Depends(get_db)):
    camera = svc.get_camera(db, camera_id)
    svc.ensure_idle(camera.project, "clear frames")
    storage.remove_camera_frames(camera.project_id, camera.id)
    camera.frame_count = 0
    camera.width = camera.height = camera.fps = None
    camera.source_kind = None
    camera.calibration = None
    svc.bump_version(camera.project)
    db.commit()
    return svc.camera_out(camera)


@router.get("/cameras/{camera_id}/frames/{index}/image")
def frame_image(camera_id: str, index: int, db: Session = Depends(get_db)):
    camera = svc.get_camera(db, camera_id)
    if not 0 <= index < camera.frame_count:
        raise NotFoundError(f"{camera.label} has no frame {index}.", details={"frameCount": camera.frame_count})
    path = storage.frame_path(camera.project_id, camera.id, index)
    if not path.is_file():
        raise NotFoundError("The frame file is missing from storage.")
    return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=3600"})


@router.post("/cameras/{camera_id}/calibration", response_model=CameraOut)
def calibrate(camera_id: str, body: CalibrationRequest, db: Session = Depends(get_db)):
    camera = svc.get_camera(db, camera_id)
    svc.ensure_idle(camera.project, "change calibration")
    if not camera.frame_count:
        raise ValidationFailed(f"{camera.label} has no frames yet.", hint="Upload frames before calibrating.")
    w, h = camera.width, camera.height
    if body.method == "assumed":
        camera.calibration = None
    elif body.method == "manual":
        intr = validate_manual_intrinsics(body.model_dump(), w, h)
        camera.calibration = {"method": "manual", "intrinsics": intr.to_dict(), "reprojectionErrorPx": None}
    else:
        step = max(1, camera.frame_count // body.max_frames)
        grays = []
        for i in range(0, camera.frame_count, step)[: body.max_frames]:
            rgb = media.load_frame_rgb(storage.frame_path(camera.project_id, camera.id, i))
            grays.append(cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY))
        outcome = calibrate_checkerboard(grays, body.pattern_cols, body.pattern_rows, body.square_size_m)
        camera.calibration = {
            "method": "checkerboard",
            "intrinsics": outcome.intrinsics.to_dict(),
            "reprojectionErrorPx": round(outcome.reprojection_error_px, 4),
            "viewsUsed": outcome.views_used,
            "viewsTotal": outcome.views_total,
            "quality": outcome.quality,
        }
    svc.bump_version(camera.project)
    db.commit()
    return svc.camera_out(camera)

