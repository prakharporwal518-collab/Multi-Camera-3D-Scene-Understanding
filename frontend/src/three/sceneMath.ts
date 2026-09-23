import type { CameraPose, Intrinsics, Region, SceneDocument, Vec3 } from '@/types/scene'

/** Camera-space point -> world point for a world-to-camera pose (x_c = R x_w + t). */
export function cameraToWorld(pose: CameraPose, p: Vec3): Vec3 {
  const R = pose.R
  const x = p[0] - pose.t[0]
  const y = p[1] - pose.t[1]
  const z = p[2] - pose.t[2]
  return [R[0] * x + R[3] * y + R[6] * z, R[1] * x + R[4] * y + R[7] * z, R[2] * x + R[5] * y + R[8] * z]
}

/**
 * Frustum wireframe for a camera: apex, four image-plane corners at `depth`, and a small
 * triangle above the top edge that marks "image up". Returned as line-segment pairs.
 */
export function frustumSegments(pose: CameraPose, intr: Intrinsics, depth: number): Float32Array {
  const corner = (u: number, v: number): Vec3 =>
    cameraToWorld(pose, [((u - intr.cx) / intr.fx) * depth, ((v - intr.cy) / intr.fy) * depth, depth])
  const apex = pose.position
  const tl = corner(0, 0)
  const tr = corner(intr.width, 0)
  const br = corner(intr.width, intr.height)
  const bl = corner(0, intr.height)
  const upA = corner(intr.width * 0.35, -intr.height * 0.04)
  const upB = corner(intr.width * 0.65, -intr.height * 0.04)
  const upTip = corner(intr.width * 0.5, -intr.height * 0.16)
  const segs: Vec3[] = [apex, tl, apex, tr, apex, br, apex, bl, tl, tr, tr, br, br, bl, bl, tl, upA, upB, upB, upTip, upTip, upA]
  return new Float32Array(segs.flat())
}

export interface SceneBounds {
  center: Vec3
  radius: number
  min: Vec3
  max: Vec3
  /** Unit vector in the ground plane pointing from the scene centre towards the cameras. */
  viewDir: Vec3
}

/** Bounds of the interesting region: point-cloud percentile box plus registered cameras. */
export function sceneBounds(scene: SceneDocument): SceneBounds {
  const min: Vec3 = [...scene.pointCloud.bounds.min]
  const max: Vec3 = [...scene.pointCloud.bounds.max]
  const placed = scene.cameras.filter((c) => c.pose)
  for (const c of placed) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], c.pose!.position[k])
      max[k] = Math.max(max[k], c.pose!.position[k])
    }
  }
  const center: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]
  const radius = Math.max(1e-3, Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2)
  // The world frame comes from the reconstruction, so "front" is defined by where the cameras are.
  let viewDir: Vec3 = [0, 0, -1]
  if (placed.length) {
    const mx = placed.reduce((a, c) => a + c.pose!.position[0], 0) / placed.length - center[0]
    const mz = placed.reduce((a, c) => a + c.pose!.position[2], 0) / placed.length - center[2]
    const len = Math.hypot(mx, mz)
    if (len > radius * 0.05) viewDir = [mx / len, 0, mz / len]
  }
  return { center, radius, min, max, viewDir }
}

export type ViewPreset = 'perspective' | 'top' | 'front' | 'side'

/**
 * Viewer camera placement for a preset. "Front" looks at the scene from the cameras' side,
 * "side" from 90 degrees to the right, "top" straight down with the cameras at the bottom.
 */
export function presetPlacement(preset: ViewPreset, b: SceneBounds): { position: Vec3; target: Vec3 } {
  const [cx, cy, cz] = b.center
  const d = b.radius * 2.2
  const [vx, , vz] = b.viewDir
  // right-hand side when looking along -viewDir
  const sx = vz
  const sz = -vx
  const target: Vec3 = [cx, Math.max(0, cy - b.radius * 0.2), cz]
  switch (preset) {
    case 'top':
      // tiny offset towards the cameras keeps OrbitControls away from the pole and orients the view
      return { position: [cx + vx * 1e-3, cy + d, cz + vz * 1e-3], target: [cx, cy, cz] }
    case 'front':
      return { position: [cx + vx * d, cy, cz + vz * d], target: [cx, cy, cz] }
    case 'side':
      return { position: [cx + sx * d, cy, cz + sz * d], target: [cx, cy, cz] }
    default:
      return {
        position: [cx + vx * d * 0.8 + sx * d * 0.3, cy + d * 0.55, cz + vz * d * 0.8 + sz * d * 0.3],
        target,
      }
  }
}

/** Grid size (cells of 1 m or a round relative unit) that covers the scene footprint. */
export function gridSpec(b: SceneBounds, units: 'm' | 'relative'): { size: number; divisions: number } {
  const span = Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2]) * 1.4
  if (units === 'm') {
    const size = Math.max(4, Math.ceil(span / 2) * 2)
    return { size, divisions: size }
  }
  const cell = 10 ** Math.floor(Math.log10(span / 10))
  const size = Math.ceil(span / cell / 2) * 2 * cell
  return { size, divisions: Math.round(size / cell) }
}

export function regionCentroid(r: Region): Vec3 {
  const cx = r.polygon.reduce((a, p) => a + p[0], 0) / r.polygon.length
  const cz = r.polygon.reduce((a, p) => a + p[1], 0) / r.polygon.length
  return [cx, 0.05, cz]
}

export function measureMidpoint(points: Vec3[]): Vec3 | null {
  if (points.length !== 2) return null
  return [(points[0][0] + points[1][0]) / 2, (points[0][1] + points[1][1]) / 2, (points[0][2] + points[1][2]) / 2]
}
