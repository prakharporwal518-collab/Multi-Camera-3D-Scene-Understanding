import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useToast } from '@/components/ui/Toast'
import { useAsync, type AsyncResult } from '@/hooks/useAsync'
import { api } from '@/services/api'
import { ApiError, toApiError } from '@/services/apiClient'
import { DEMO_PROJECT_ID, sourceFor, type SceneSource } from '@/services/sceneSource'
import type { PipelineRun, Project } from '@/types/project'
import type { SceneDocument } from '@/types/scene'

export interface Selection {
  objectId: string | null
  trackId: number | null
  cameraId: string | null
}

interface WorkspaceValue {
  projectId: string
  isDemo: boolean
  source: SceneSource
  /** Always null for the demo project. */
  project: AsyncResult<Project | null>
  /** `data === null` means the project has no reconstruction yet. */
  scene: AsyncResult<SceneDocument | null>
  run: PipelineRun | null
  runActive: boolean
  startRun: (fromStage?: string) => Promise<void>
  cancelRun: () => Promise<void>
  timestep: number
  setTimestep: (index: number) => void
  selection: Selection
  select: (patch: Partial<Selection>) => void
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null)

const POLL_MS = 1200

export function WorkspaceProvider({ projectId, children }: { projectId: string; children: ReactNode }) {
  const isDemo = projectId === DEMO_PROJECT_ID
  const source = useMemo(() => sourceFor(projectId), [projectId])
  const toast = useToast()

  const project = useAsync<Project | null>(
    (signal) => (isDemo ? Promise.resolve(null) : api.getProject(projectId, signal)),
    [projectId, isDemo],
  )
  // For real projects the scene is requested only once the project says one exists, so a
  // new project does not produce a (harmless but noisy) 404 on every page.
  const projectState = project.state
  const projectError = projectState.status === 'error' && !projectState.data ? projectState.error : null
  const hasScene = isDemo ? true : projectState.data?.hasScene
  const lastRun = projectState.data?.lastRun
  const sceneKey = isDemo ? 'demo' : `${hasScene}:${lastRun?.id ?? ''}:${lastRun?.status ?? ''}`
  const scene = useAsync<SceneDocument | null>(
    (signal) => {
      if (projectError) return Promise.reject(projectError)
      if (hasScene === undefined) return new Promise<never>(() => {}) // wait for the project
      if (!hasScene) return Promise.resolve(null)
      return source.loadScene(signal).catch((err: unknown) => {
        const e = toApiError(err)
        if (e.code === 'scene_not_found') return null
        throw e
      })
    },
    [source, sceneKey, projectError],
  )

  const [run, setRun] = useState<PipelineRun | null>(null)
  const runActive = run?.status === 'queued' || run?.status === 'running'
  const reloadProject = project.reload

  // Seed run state from the project, then poll while a run is active.
  const projectData = project.state.data
  useEffect(() => {
    if (projectData?.lastRun) setRun(projectData.lastRun)
  }, [projectData])

  const lastStatus = useRef<string | null>(null)
  useEffect(() => {
    if (isDemo || !runActive) return
    let cancelled = false
    const controller = new AbortController()
    const tick = async () => {
      try {
        const latest = await api.latestRun(projectId, controller.signal)
        if (!cancelled && latest) setRun(latest)
      } catch {
        /* transient polling errors are ignored; the next tick retries */
      }
    }
    const handle = window.setInterval(tick, POLL_MS)
    void tick()
    return () => {
      cancelled = true
      controller.abort()
      window.clearInterval(handle)
    }
  }, [isDemo, runActive, projectId])

  useEffect(() => {
    const status = run?.status ?? null
    const previous = lastStatus.current
    lastStatus.current = status
    if (!previous || previous === status || (previous !== 'running' && previous !== 'queued')) return
    // Reloading the project also reloads the scene: its key includes the latest run.
    if (status === 'completed') {
      toast.show('ok', 'Pipeline finished', 'The reconstruction has been updated.')
      reloadProject()
    } else if (status === 'failed') {
      toast.show('err', 'Pipeline failed', run?.error?.message ?? 'See the Overview page for details. Previous results were kept.')
      reloadProject()
    } else if (status === 'cancelled') {
      toast.show('warn', 'Pipeline cancelled', 'Previous results were kept.')
      reloadProject()
    }
  }, [run, toast, reloadProject])

  const startRun = useCallback(
    async (fromStage = 'input') => {
      if (isDemo) throw new ApiError('http', 'The demo project is read-only.', { code: 'demo_read_only' })
      const started = await api.startRun(projectId, fromStage)
      lastStatus.current = started.status
      setRun(started)
    },
    [isDemo, projectId],
  )

  const cancelRun = useCallback(async () => {
    const res = await api.cancelRun(projectId)
    setRun(res)
  }, [projectId])

  const [timestep, setTimestep] = useState(-1)
  const [selection, setSelection] = useState<Selection>({ objectId: null, trackId: null, cameraId: null })
  const select = useCallback((patch: Partial<Selection>) => setSelection((s) => ({ ...s, ...patch })), [])

  // Default to the last timestep once a scene arrives.
  const sceneData = scene.state.data
  useEffect(() => {
    if (sceneData && (timestep < 0 || timestep >= sceneData.frames.length)) setTimestep(Math.max(0, sceneData.frames.length - 1))
  }, [sceneData, timestep])

  const value = useMemo<WorkspaceValue>(
    () => ({
      projectId,
      isDemo,
      source,
      project,
      scene,
      run,
      runActive,
      startRun,
      cancelRun,
      timestep: Math.max(0, timestep),
      setTimestep,
      selection,
      select,
    }),
    [projectId, isDemo, source, project, scene, run, runActive, startRun, cancelRun, timestep, selection, select],
  )
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export function useWorkspace(): WorkspaceValue {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) throw new Error('useWorkspace must be used inside <WorkspaceProvider>')
  return ctx
}
