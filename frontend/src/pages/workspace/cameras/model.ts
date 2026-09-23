import { apiUrl } from '@/services/apiClient'
import type { SceneSource } from '@/services/sceneSource'
import type { Camera } from '@/types/project'
import type { SceneCamera, SceneDocument } from '@/types/scene'

/** A camera as shown on the Camera Inputs page, merged from the API record and the scene. */
export interface CameraRow {
  id: string
  label: string
  name: string
  width: number | null
  height: number | null
  fps: number | null
  frameCount: number
  status: 'empty' | 'ready'
  sourceKind: 'images' | 'video' | 'synthetic' | null
  calibration: string
  scene: SceneCamera | null
  api: Camera | null
}

export function rowsFromApi(cameras: Camera[], scene: SceneDocument | null): CameraRow[] {
  return cameras.map((c) => ({
    id: c.id,
    label: c.label,
    name: c.name,
    width: c.width,
    height: c.height,
    fps: c.fps,
    frameCount: c.frameCount,
    status: c.status,
    sourceKind: c.sourceKind,
    calibration: c.calibration?.method ?? 'assumed',
    scene: scene?.cameras.find((sc) => sc.id === c.id) ?? null,
    api: c,
  }))
}

export function rowsFromScene(scene: SceneDocument): CameraRow[] {
  return scene.cameras.map((c) => ({
    id: c.id,
    label: c.label,
    name: c.name,
    width: c.width,
    height: c.height,
    fps: c.fps,
    frameCount: c.frameCount,
    status: c.frameCount > 0 ? 'ready' : 'empty',
    sourceKind: 'synthetic',
    calibration: c.calibration.method,
    scene: c,
    api: null,
  }))
}

export function frameSrc(row: CameraRow, index: number, source: SceneSource): string | null {
  if (row.frameCount === 0) return null
  if (row.scene && source.kind === 'demo') return source.frameUrl(row.scene, index)
  return apiUrl(`/cameras/${encodeURIComponent(row.id)}/frames/${index}/image`)
}

/** Minimal scene-camera record for a camera that has not been through the pipeline yet. */
export function sceneCameraFromApi(c: Camera): SceneCamera {
  const w = c.width ?? 1
  const h = c.height ?? 1
  const intr = c.calibration?.intrinsics ?? { fx: Math.max(w, h), fy: Math.max(w, h), cx: w / 2, cy: h / 2, width: w, height: h, dist: [0, 0, 0, 0, 0] }
  return {
    id: c.id,
    label: c.label,
    name: c.name,
    width: w,
    height: h,
    fps: c.fps,
    frameCount: c.frameCount,
    frameUrl: `cameras/${c.id}/frames/{index}/image`,
    intrinsics: intr,
    fovY: (2 * Math.atan2(h / 2, intr.fy) * 180) / Math.PI,
    calibration: { method: c.calibration?.method ?? 'assumed', reprojectionErrorPx: c.calibration?.reprojectionErrorPx ?? null },
    registered: false,
    registrationNote: null,
    pose: null,
    observations: 0,
    meanReprojErrorPx: null,
  }
}
