import type { SceneDocument } from '@/types/scene'
import { Badge } from './ui/Badge'

type Layer = 'images' | 'reconstruction' | 'depth' | 'detections' | 'tracks' | 'sceneGraph'

/**
 * States where the data on screen came from. Demo and simulated data are always marked;
 * pipeline output on uploaded images is shown as such.
 */
export function DataSourceBadge({ scene, layer }: { scene: SceneDocument; layer: Layer }) {
  const value = scene.provenance[layer]
  if (layer === 'detections' && value === 'simulated') {
    return (
      <Badge
        tone="sample"
        icon="info"
        title="No detection model ships with the demo. Boxes are projected from the synthetic ground truth with added noise and misses."
      >
        Simulated detections
      </Badge>
    )
  }
  if (layer === 'detections' && value.startsWith('model:')) {
    return <Badge tone="accent" title={`Produced by ${value.slice(6)}`}>Detector: {value.slice(6)}</Badge>
  }
  if (scene.source === 'demo') {
    return (
      <Badge
        tone="sample"
        icon="info"
        title="Synthetic scene rendered by backend/scripts/build_demo.py and processed by the real pipeline. Not measured data."
      >
        Demo · synthetic scene
      </Badge>
    )
  }
  if (value === 'none') return <Badge>Not available</Badge>
  return <Badge tone="accent" title="Computed by the processing pipeline from uploaded frames">Pipeline output</Badge>
}
