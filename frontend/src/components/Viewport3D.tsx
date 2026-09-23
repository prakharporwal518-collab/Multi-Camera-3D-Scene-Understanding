import { lazy, Suspense } from 'react'
import { useWebGLSupport } from '@/hooks/useWebGLSupport'
import type { SceneViewportProps } from '@/three/SceneViewport'
import { ErrorBoundary } from './ErrorBoundary'
import { EmptyState, LoadingState } from './ui/States'

// three.js and react-three-fiber are only downloaded when a 3D view is actually shown.
const SceneViewport = lazy(() => import('@/three/SceneViewport'))

export function Viewport3D(props: SceneViewportProps) {
  const webgl = useWebGLSupport()
  if (!webgl.supported) {
    return (
      <EmptyState icon="warning" title="3D view unavailable">
        WebGL could not be initialised ({webgl.reason}) Enable hardware acceleration in the browser settings or try
        another browser. Tables and 2D views on the other pages still work.
      </EmptyState>
    )
  }
  return (
    <ErrorBoundary area="3D viewer">
      <Suspense fallback={<LoadingState label="Loading 3D renderer…" />}>
        <SceneViewport {...props} />
      </Suspense>
    </ErrorBoundary>
  )
}
