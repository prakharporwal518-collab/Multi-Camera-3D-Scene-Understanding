/**
 * Scene document produced by the backend pipeline (and by scripts/build_demo.py).
 * Mirrors backend/app/pipeline/scene_writer.py - keep the two in sync.
 */

export type Vec3 = [number, number, number]

export type StageStatus = 'waiting' | 'processing' | 'completed' | 'warning' | 'failed' | 'skipped'

export type StageId =
  | 'input'
  | 'preprocessing'
  | 'calibration'
  | 'feature_extraction'
  | 'feature_matching'
  | 'pose_estimation'
  | 'depth_estimation'
  | 'reconstruction'
  | 'object_detection'
  | 'tracking'
  | 'scene_understanding'

export interface ApiErrorBody {
  code: string
  message: string
  hint?: string
  details?: Record<string, unknown>
}

export interface StageRecord {
  id: StageId
  label: string
  status: StageStatus
  progress: number
  durationMs: number | null
  message: string | null
  warnings: string[]
  error: ApiErrorBody | null
}

export interface Intrinsics {
  fx: number
  fy: number
  cx: number
  cy: number
  width: number
  height: number
  dist: number[]
}

export type CalibrationMethod = 'assumed' | 'manual' | 'checkerboard' | 'synthetic'

export interface CameraPose {
  /** World-to-camera rotation, row-major 3x3 (OpenCV camera axes). */
  R: number[]
  t: Vec3
  /** Camera centre in world coordinates. */
  position: Vec3
}

export interface SceneCamera {
  id: string
  label: string
  name: string
  width: number
  height: number
  fps: number | null
  frameCount: number
  /** Relative URL template containing `{index}` or `{index:03d}`. */
  frameUrl: string
  intrinsics: Intrinsics
  fovY: number
  calibration: { method: CalibrationMethod; reprojectionErrorPx: number | null }
  registered: boolean
  registrationNote: string | null
  pose: CameraPose | null
  observations: number
  meanReprojErrorPx: number | null
}

export interface PointCloudInfo {
  url: string
  count: number
  sparseCount: number
  denseCount: number
  bounds: { min: Vec3; max: Vec3 }
  format: string
}

export interface DepthMapInfo {
  cameraId: string
  url: string
  width: number
  height: number
  coverage: number
  sparseAgreement: number | null
  partners: string[]
  method: string
  encoding: { type: 'rg16'; step: number }
  min: number | null
  max: number | null
  mean: number | null
  median: number | null
}

export interface SceneObject {
  id: string
  trackId: number | null
  class: string
  category: string
  confidence: number
  center: Vec3
  size: Vec3
  yaw: number
  method: 'multi-view' | 'ground-contact'
  visibleCameras: string[]
  boxes: Record<string, [number, number, number, number]>
}

export interface SceneFrame {
  index: number
  t: number
  objects: SceneObject[]
}

export interface TrackState {
  t: number
  position: Vec3
  velocity: Vec3
  observed: boolean
  cameras: string[]
}

export interface Track {
  id: number
  class: string
  status: 'tentative' | 'confirmed' | 'lost'
  confidence: number
  observations: number
  meanSpeed: number
  states: TrackState[]
}

export interface Region {
  id: string
  name: string
  polygon: [number, number][]
}

export interface Relation {
  subject: string
  predicate: 'near' | 'on' | 'inside' | 'behind' | string
  object: string
  value?: number
  unit?: string | null
}

export interface PrecomputedMatchIndex {
  a: string
  b: string
  detector: string
  file: string
}

export interface Evaluation {
  note: string
  cameraPositionErrorM: Record<string, number>
  cameraRotationErrorDeg: Record<string, number>
  depth: { camera: string; medianRelError: number; within5Percent: number }[]
  objectCenterErrorM: { mean: number; median: number; count: number } | null
}

export type Provenance = {
  images: 'uploaded' | 'synthetic-render' | string
  reconstruction: 'pipeline' | string
  depth: 'pipeline' | 'none' | string
  detections: string
  tracks: 'pipeline' | 'none' | string
  sceneGraph: 'rules' | 'none' | string
}

export interface SceneDocument {
  schemaVersion: number
  projectId: string
  source: 'pipeline' | 'demo'
  generatedAt: string
  units: 'm' | 'relative'
  groundAligned: boolean
  provenance: Provenance
  cameras: SceneCamera[]
  pointCloud: PointCloudInfo
  depthMaps: DepthMapInfo[]
  timeline: { timestamps: number[]; frameIndices: number[] }
  frames: SceneFrame[]
  tracks: Track[]
  regions: Region[]
  relations: Relation[]
  relationsViewpoint: string | null
  matching: {
    pairs: { a: string; b: string; tentative: number; inliers: number }[]
    detector: string
    ratio: number
    precomputed?: PrecomputedMatchIndex[]
  }
  stats: {
    stages: StageRecord[]
    registeredCameras: number
    sparsePoints: number
    densePoints: number
    meanReprojErrorPx: number | null
    reprojErrorHistogram: { from: number; to: number; count: number }[]
    bundleAdjustment: { initialRmsPx: number; finalRmsPx: number; iterations: number; observations: number }[]
    sceneExtent: number
    resources: { wallTimeS: number; cpuTimeS: number; peakMemoryMb: number; gpu: string | null }
  }
  evaluation: Evaluation | null
  warnings: string[]
  dataVersion?: number
  stale?: boolean
}
