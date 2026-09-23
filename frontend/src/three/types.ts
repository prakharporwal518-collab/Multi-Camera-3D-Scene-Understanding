import type { OrbitControls } from '@react-three/drei'
import type { ComponentRef } from 'react'
import type { ColorMode } from './PointCloudLayer'
import type { ViewPreset } from './sceneMath'

export interface ViewerOptions {
  showDense: boolean
  showSparse: boolean
  showCameras: boolean
  showBoxes: boolean
  showLabels: boolean
  showGrid: boolean
  showAxes: boolean
  showTrajectories: boolean
  showRegions: boolean
  pointSize: number
  density: number
  colorMode: ColorMode
}

export const DEFAULT_VIEWER_OPTIONS: ViewerOptions = {
  showDense: true,
  showSparse: true,
  showCameras: true,
  showBoxes: true,
  showLabels: true,
  showGrid: true,
  showAxes: true,
  showTrajectories: true,
  showRegions: false,
  pointSize: 2,
  density: 1,
  colorMode: 'rgb',
}

export function isViewerOptions(v: unknown): v is ViewerOptions {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return Object.keys(DEFAULT_VIEWER_OPTIONS).every((k) => typeof o[k] === typeof DEFAULT_VIEWER_OPTIONS[k as keyof ViewerOptions])
}

export type Projection = 'perspective' | 'orthographic'

export type ViewRequest =
  | { kind: 'preset'; preset: ViewPreset; nonce: number }
  | { kind: 'camera'; cameraId: string; nonce: number }

export type OrbitControlsHandle = ComponentRef<typeof OrbitControls>
