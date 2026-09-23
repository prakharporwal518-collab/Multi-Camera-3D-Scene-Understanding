import { TURBO_LUT } from '@/utils/colormap'
import type { CameraPose, Intrinsics } from '@/types/scene'

export interface DecodedDepth {
  width: number
  height: number
  depth: Float32Array // 0 = no estimate
  confidence: Float32Array // 0..1
}

/**
 * Decode the backend's depth PNG: R/G hold a 16-bit value (high/low byte), B holds
 * confidence * 255. Depth = value * step; value 0 marks pixels without an estimate.
 */
export function decodeDepthRgba(rgba: Uint8ClampedArray, width: number, height: number, step: number): DecodedDepth {
  const n = width * height
  if (rgba.length < n * 4) throw new Error('Depth image is smaller than its declared size.')
  const depth = new Float32Array(n)
  const confidence = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const q = rgba[i * 4] * 256 + rgba[i * 4 + 1]
    if (q > 0) {
      depth[i] = q * step
      confidence[i] = rgba[i * 4 + 2] / 255
    }
  }
  return { width, height, depth, confidence }
}

/** Colour a depth or confidence buffer into RGBA. Pixels without data become transparent. */
export function colorize(
  values: Float32Array,
  valid: Float32Array,
  min: number,
  max: number,
  out: Uint8ClampedArray,
  invert = false,
): void {
  const range = max - min || 1
  for (let i = 0; i < values.length; i++) {
    const o = i * 4
    if (valid[i] <= 0) {
      out[o + 3] = 0
      continue
    }
    let t = (values[i] - min) / range
    t = t < 0 ? 0 : t > 1 ? 1 : t
    if (invert) t = 1 - t
    const k = Math.round(t * 255) * 3
    out[o] = TURBO_LUT[k]
    out[o + 1] = TURBO_LUT[k + 1]
    out[o + 2] = TURBO_LUT[k + 2]
    out[o + 3] = 255
  }
}

export interface BackprojectedCloud {
  positions: Float32Array
  colors: Uint8Array
  count: number
}

/**
 * Lift a depth map to world points. Intrinsics are given at the camera's native size and
 * rescaled to the depth map's resolution. `rgb` (optional) must be width*height*4 RGBA.
 */
export function backproject(
  d: DecodedDepth,
  intr: Intrinsics,
  pose: CameraPose,
  rgb: Uint8ClampedArray | null,
  stride = 1,
): BackprojectedCloud {
  const sx = d.width / intr.width
  const sy = d.height / intr.height
  const fx = intr.fx * sx
  const fy = intr.fy * sy
  const cx = intr.cx * sx
  const cy = intr.cy * sy
  const R = pose.R
  const t = pose.t
  const positions: number[] = []
  const colors: number[] = []
  for (let v = 0; v < d.height; v += stride) {
    for (let u = 0; u < d.width; u += stride) {
      const i = v * d.width + u
      const z = d.depth[i]
      if (z <= 0) continue
      const xc = ((u - cx) / fx) * z - t[0]
      const yc = ((v - cy) / fy) * z - t[1]
      const zc = z - t[2]
      // world = R^T (x_cam - t)
      positions.push(R[0] * xc + R[3] * yc + R[6] * zc, R[1] * xc + R[4] * yc + R[7] * zc, R[2] * xc + R[5] * yc + R[8] * zc)
      if (rgb) colors.push(rgb[i * 4], rgb[i * 4 + 1], rgb[i * 4 + 2])
      else colors.push(200, 200, 200)
    }
  }
  return { positions: new Float32Array(positions), colors: new Uint8Array(colors), count: positions.length / 3 }
}
