import type { Camera } from '@/types/project'

/** Checks that must pass before the pipeline is worth starting. */
export function preflight(cameras: Camera[]): string | null {
  const ready = cameras.filter((c) => c.frameCount > 0)
  if (cameras.length < 2) return 'Add at least two cameras on the Camera Inputs page.'
  if (ready.length < 2) {
    const empty = cameras.filter((c) => c.frameCount === 0).map((c) => c.label)
    return `At least two cameras need frames. Without frames: ${empty.join(', ')}.`
  }
  return null
}
