import type { SceneDocument } from '@/types/scene'

/** Display label (CAM-01, …) for a camera referenced by id or label. */
export function cameraLabel(scene: SceneDocument, id: string): string {
  return scene.cameras.find((c) => c.id === id || c.label === id)?.label ?? id
}
