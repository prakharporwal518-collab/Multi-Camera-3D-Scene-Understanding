import { useCallback, useEffect, useMemo, useRef, useState, type DependencyList } from 'react'
import { ApiError, toApiError } from '@/services/apiClient'

export type AsyncState<T> =
  | { status: 'loading'; data?: T; error?: undefined }
  | { status: 'success'; data: T; error?: undefined }
  | { status: 'error'; data?: T; error: ApiError }

export interface AsyncResult<T> {
  state: AsyncState<T>
  reload: () => void
  /** True while a reload runs and older data is still displayed. */
  refreshing: boolean
}

/**
 * Runs `fn` whenever `deps` change, aborting the previous call. Stale responses are
 * ignored, and data from the last success is kept while reloading.
 */
export function useAsync<T>(fn: (signal: AbortSignal) => Promise<T>, deps: DependencyList): AsyncResult<T> {
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading' })
  const [nonce, setNonce] = useState(0)
  const fnRef = useRef(fn)
  useEffect(() => {
    fnRef.current = fn
  })

  useEffect(() => {
    const controller = new AbortController()
    setState((prev) => ({ status: 'loading', data: prev.data }))
    fnRef.current(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setState({ status: 'success', data })
      },
      (err: unknown) => {
        if (controller.signal.aborted) return
        const apiErr = toApiError(err)
        if (apiErr.kind === 'aborted') return
        setState((prev) => ({ status: 'error', data: prev.data, error: apiErr }))
      },
    )
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce])

  const reload = useCallback(() => setNonce((n) => n + 1), [])
  return useMemo(
    () => ({ state, reload, refreshing: state.status === 'loading' && state.data !== undefined }),
    [state, reload],
  )
}
