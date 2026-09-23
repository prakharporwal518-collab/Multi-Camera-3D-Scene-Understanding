import { useCallback, useState } from 'react'
import { usePersistentState } from '@/hooks/usePersistentState'
import type { ViewPreset } from '@/three/sceneMath'
import { DEFAULT_VIEWER_OPTIONS, isViewerOptions, type Projection, type ViewRequest } from '@/three/types'

/** View state shared by the reconstruction page and the 3D viewer. Display options persist per browser. */
export function useViewerState(storageKey: string) {
  const [options, setOptions] = usePersistentState(storageKey, DEFAULT_VIEWER_OPTIONS, isViewerOptions)
  const [projection, setProjectionState] = useState<Projection>('perspective')
  const [view, setView] = useState<ViewRequest>({ kind: 'preset', preset: 'perspective', nonce: 0 })

  const preset = useCallback((p: ViewPreset) => setView((v) => ({ kind: 'preset', preset: p, nonce: v.nonce + 1 })), [])
  const lookThrough = useCallback((cameraId: string) => {
    setProjectionState('perspective')
    setView((v) => ({ kind: 'camera', cameraId, nonce: v.nonce + 1 }))
  }, [])
  const setProjection = useCallback((p: Projection) => {
    setProjectionState(p)
    setView((v) => (v.kind === 'camera' ? { kind: 'preset', preset: 'perspective', nonce: v.nonce + 1 } : { ...v, nonce: v.nonce + 1 }))
  }, [])

  return { options, setOptions, projection, setProjection, view, preset, lookThrough }
}
