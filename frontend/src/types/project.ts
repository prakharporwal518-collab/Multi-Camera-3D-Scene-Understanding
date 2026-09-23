import type { ApiErrorBody, StageRecord } from './scene'

export type FeatureDetector = 'sift' | 'orb' | 'akaze'

export interface ProjectConfig {
  detector: FeatureDetector
  maxFeatures: number
  matchRatio: number
  referenceFrame: number
  baselineMeters: number | null
  maxTimesteps: number
  timestepStride: number
  nearDistance: number
  voxelSize: number
  depth: { numPlanes: number; window: number; workingWidth: number; minScore: number }
}

export type RunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface PipelineRun {
  id: string
  status: RunStatus
  fromStage: string
  stages: StageRecord[]
  error: ApiErrorBody | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}

export interface Project {
  id: string
  name: string
  description: string
  config: ProjectConfig
  createdAt: string
  updatedAt: string
  cameraCount: number
  frameCount: number
  hasScene: boolean
  sceneStale: boolean
  lastRun: PipelineRun | null
}

export interface CameraCalibration {
  method: 'manual' | 'checkerboard'
  intrinsics: { fx: number; fy: number; cx: number; cy: number; width: number; height: number; dist: number[] }
  reprojectionErrorPx: number | null
  viewsUsed?: number
  viewsTotal?: number
  quality?: string
}

export interface Camera {
  id: string
  projectId: string
  label: string
  name: string
  sourceKind: 'images' | 'video' | null
  width: number | null
  height: number | null
  fps: number | null
  frameCount: number
  status: 'empty' | 'ready'
  calibration: CameraCalibration | null
  createdAt: string
}

export interface UploadResult {
  camera: Camera
  added: number
  skipped: { file?: string; message: string; code?: string }[]
}

export interface HealthInfo {
  status: 'ok' | 'degraded'
  version: string
  database: string
  detector: { status: 'ready' | 'not_configured' | 'error'; message: string }
  limits: {
    maxImageMb: number
    maxVideoMb: number
    maxCameras: number
    maxFramesPerCamera: number
    processingTimeoutS: number
  }
}

export interface MatchResponse {
  cameraA: string
  cameraB: string
  detector: FeatureDetector
  ratio: number
  featuresA: number
  featuresB: number
  tentative: number
  inliers: number
  detectMsA: number
  detectMsB: number
  matchMs: number
  /** [xa, ya, xb, yb, ratio, inlier] in native pixel coordinates */
  matches: [number, number, number, number, number, boolean][]
  truncated: boolean
}

export type CalibrationRequest =
  | { method: 'assumed' }
  | { method: 'manual'; fx: number; fy: number; cx: number; cy: number; dist: number[] }
  | { method: 'checkerboard'; patternCols: number; patternRows: number; squareSizeM: number }
