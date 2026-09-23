import type { ProjectConfig } from '@/types/project'
import { parseNumber, type NumberRule } from '@/utils/validation'

export type NumericKey =
  | 'maxFeatures'
  | 'matchRatio'
  | 'referenceFrame'
  | 'baselineMeters'
  | 'maxTimesteps'
  | 'timestepStride'
  | 'nearDistance'
  | 'voxelSize'
  | 'depth.numPlanes'
  | 'depth.window'
  | 'depth.workingWidth'
  | 'depth.minScore'

/** Same ranges as backend/app/pipeline/config.py. */
export const RULES: Record<NumericKey, NumberRule & { help: string }> = {
  maxFeatures: { label: 'Max features', min: 500, max: 20000, integer: true, required: true, help: 'Keypoints kept per image (500–20000).' },
  matchRatio: { label: 'Match ratio', min: 0.5, max: 0.95, required: true, help: 'Lowe ratio threshold (0.50–0.95).' },
  referenceFrame: { label: 'Reference frame', min: 0, integer: true, required: true, help: 'Frame index used for reconstruction.' },
  baselineMeters: { label: 'Known baseline', min: 0, exclusiveMin: true, max: 1000, help: 'Distance CAM-01 ↔ CAM-02 in metres. Empty = relative scale.' },
  maxTimesteps: { label: 'Max timesteps', min: 1, max: 120, integer: true, required: true, help: 'Timesteps used for detection and tracking.' },
  timestepStride: { label: 'Timestep stride', min: 1, max: 100, integer: true, required: true, help: 'Use every n-th synchronized frame.' },
  nearDistance: { label: '“Near” distance', min: 0, exclusiveMin: true, max: 50, required: true, help: 'Gap between footprints (metres, metric scenes).' },
  voxelSize: { label: 'Voxel size', min: 0, exclusiveMin: true, max: 1, required: true, help: 'Dense point fusion grid (metres, metric scenes).' },
  'depth.numPlanes': { label: 'Depth planes', min: 16, max: 256, integer: true, required: true, help: 'Plane-sweep hypotheses (16–256).' },
  'depth.window': { label: 'ZNCC window', min: 3, max: 21, integer: true, required: true, help: 'Odd window size in pixels (3–21).' },
  'depth.workingWidth': { label: 'Depth resolution', min: 256, max: 1920, integer: true, required: true, help: 'Width at which depth is computed (px).' },
  'depth.minScore': { label: 'Min. ZNCC score', min: 0.1, max: 0.95, required: true, help: 'Lower keeps more, noisier depth.' },
}

export type ConfigForm = Record<NumericKey, string> & { detector: ProjectConfig['detector'] }

export function toForm(c: ProjectConfig): ConfigForm {
  return {
    detector: c.detector,
    maxFeatures: String(c.maxFeatures),
    matchRatio: String(c.matchRatio),
    referenceFrame: String(c.referenceFrame),
    baselineMeters: c.baselineMeters === null ? '' : String(c.baselineMeters),
    maxTimesteps: String(c.maxTimesteps),
    timestepStride: String(c.timestepStride),
    nearDistance: String(c.nearDistance),
    voxelSize: String(c.voxelSize),
    'depth.numPlanes': String(c.depth.numPlanes),
    'depth.window': String(c.depth.window),
    'depth.workingWidth': String(c.depth.workingWidth),
    'depth.minScore': String(c.depth.minScore),
  }
}

export function validateForm(f: ConfigForm): { config: ProjectConfig | null; errors: Partial<Record<NumericKey, string>> } {
  const errors: Partial<Record<NumericKey, string>> = {}
  const values: Partial<Record<NumericKey, number | null>> = {}
  for (const key of Object.keys(RULES) as NumericKey[]) {
    const r = parseNumber(f[key], RULES[key])
    if (r.error) errors[key] = r.error
    values[key] = r.value
  }
  const win = values['depth.window']
  if (!errors['depth.window'] && win !== null && win !== undefined && win % 2 === 0) errors['depth.window'] = 'ZNCC window must be odd.'
  if (Object.keys(errors).length) return { config: null, errors }
  const v = values as Record<NumericKey, number | null>
  return {
    errors,
    config: {
      detector: f.detector,
      maxFeatures: v.maxFeatures!,
      matchRatio: v.matchRatio!,
      referenceFrame: v.referenceFrame!,
      baselineMeters: v.baselineMeters,
      maxTimesteps: v.maxTimesteps!,
      timestepStride: v.timestepStride!,
      nearDistance: v.nearDistance!,
      voxelSize: v.voxelSize!,
      depth: { numPlanes: v['depth.numPlanes']!, window: v['depth.window']!, workingWidth: v['depth.workingWidth']!, minScore: v['depth.minScore']! },
    },
  }
}
