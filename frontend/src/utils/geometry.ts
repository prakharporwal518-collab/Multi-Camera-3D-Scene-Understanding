import type { CameraPose, Vec3 } from '@/types/scene'

export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

export function length(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2])
}

export function distance(a: Vec3, b: Vec3): number {
  return length(sub(a, b))
}

/** Speed in the ground plane (x/z), ignoring vertical jitter. */
export function groundSpeed(v: Vec3): number {
  return Math.hypot(v[0], v[2])
}

/** Heading in the ground plane in degrees, 0 = +Z, clockwise positive towards +X. */
export function headingDeg(v: Vec3): number {
  const deg = (Math.atan2(v[0], v[2]) * 180) / Math.PI
  return (deg + 360) % 360
}

export function compassLabel(deg: number): string {
  const names = ['+Z', '+Z/+X', '+X', '−Z/+X', '−Z', '−Z/−X', '−X', '+Z/−X']
  return names[Math.round(deg / 45) % 8]
}

/**
 * Camera-to-world rotation as Euler angles (degrees) in the viewer's Y-up frame.
 * Yaw about +Y, pitch about camera X, roll about the viewing axis. The camera looks along
 * its +Z (OpenCV) axis, i.e. the third row of R.
 */
export function cameraAngles(pose: CameraPose): { yaw: number; pitch: number; roll: number } {
  const R = pose.R
  const forward: Vec3 = [R[6], R[7], R[8]]
  const down: Vec3 = [R[3], R[4], R[5]]
  const yaw = (Math.atan2(forward[0], forward[2]) * 180) / Math.PI
  const pitch = (Math.asin(Math.max(-1, Math.min(1, forward[1]))) * 180) / Math.PI
  // roll: angle between camera "up" (-down) and the world up projected on the image plane
  const right: Vec3 = [R[0], R[1], R[2]]
  const roll = (Math.atan2(-right[1], -down[1]) * 180) / Math.PI
  return { yaw, pitch, roll }
}

export function cameraForward(pose: CameraPose): Vec3 {
  return [pose.R[6], pose.R[7], pose.R[8]]
}
