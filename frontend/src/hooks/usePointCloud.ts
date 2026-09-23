import { useEffect, useState } from 'react'
import { ApiError, toApiError } from '@/services/apiClient'
import { fetchBinary, parsePointCloud, type PointCloudData } from '@/services/pointCloud'
import type { SceneSource } from '@/services/sceneSource'
import type { SceneDocument } from '@/types/scene'

export type PointCloudState =
  | { status: 'loading'; progress: number | undefined }
  | { status: 'ready'; data: PointCloudData }
  | { status: 'error'; error: ApiError }

// One cached cloud is enough: pages that show the same scene reuse it without refetching.
let cache: { key: string; data: PointCloudData } | null = null

export function usePointCloud(source: SceneSource, scene: SceneDocument | null | undefined): PointCloudState & { retry: () => void } {
  const key = scene ? `${source.projectId}:${scene.generatedAt}:${scene.pointCloud.url}` : ''
  const [state, setState] = useState<PointCloudState>(() =>
    cache && cache.key === key ? { status: 'ready', data: cache.data } : { status: 'loading', progress: undefined },
  )
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!scene) return
    if (cache && cache.key === key) {
      setState({ status: 'ready', data: cache.data })
      return
    }
    const controller = new AbortController()
    setState({ status: 'loading', progress: undefined })
    fetchBinary(
      source.resultUrl(scene.pointCloud.url),
      (p) => setState({ status: 'loading', progress: p }),
      controller.signal,
    )
      .then((buffer) => {
        const data = parsePointCloud(buffer, scene.pointCloud.count)
        cache = { key, data }
        if (!controller.signal.aborted) setState({ status: 'ready', data })
      })
      .catch((err: unknown) => {
        const e = toApiError(err)
        if (!controller.signal.aborted && e.kind !== 'aborted') setState({ status: 'error', error: e })
      })
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt])

  return { ...state, retry: () => setAttempt((a) => a + 1) }
}
