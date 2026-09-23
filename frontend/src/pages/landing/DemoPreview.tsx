import { useMemo } from 'react'
import { Badge } from '@/components/ui/Badge'
import { ProgressBar } from '@/components/ui/Progress'
import { EmptyState, LoadingState } from '@/components/ui/States'
import { Viewport3D } from '@/components/Viewport3D'
import { usePointCloud } from '@/hooks/usePointCloud'
import { demoSource } from '@/services/sceneSource'
import { DEFAULT_VIEWER_OPTIONS, type ViewRequest } from '@/three/types'
import type { SceneDocument } from '@/types/scene'
import s from './landing.module.css'

const PREVIEW_OPTIONS = { ...DEFAULT_VIEWER_OPTIONS, showLabels: false, showAxes: false, showSparse: false, pointSize: 2 }
const VIEW: ViewRequest = { kind: 'preset', preset: 'perspective', nonce: 0 }

export function DemoPreview({ scene }: { scene: SceneDocument | undefined }) {
  const cloud = usePointCloud(demoSource, scene)
  const objects = useMemo(() => scene?.frames.at(-1)?.objects ?? [], [scene])
  if (!scene) return <LoadingState label="Loading demo scene…" />
  if (cloud.status === 'error') {
    return (
      <EmptyState icon="warning" title="Preview unavailable">
        {cloud.error.message}
      </EmptyState>
    )
  }
  return (
    <>
      {cloud.status === 'loading' && (
        <div style={{ position: 'absolute', zIndex: 3, left: 12, right: 12, top: 12 }}>
          <ProgressBar value={cloud.progress} label="Loading demo point cloud" />
        </div>
      )}
      <Viewport3D
        scene={scene}
        cloud={cloud.status === 'ready' ? cloud.data : null}
        options={PREVIEW_OPTIONS}
        projection="perspective"
        view={VIEW}
        objects={objects}
        tracks={scene.tracks}
        ariaLabel="Interactive preview of the demo reconstruction: drag to rotate, scroll to zoom."
      />
      <div className={s.previewCaption}>
        <Badge tone="sample">Demo · synthetic scene</Badge>
        <span>drag to orbit · scroll to zoom</span>
      </div>
    </>
  )
}
