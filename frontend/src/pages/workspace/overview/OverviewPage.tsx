import { useState } from 'react'
import { useNavigate } from 'react-router'
import { Button } from '@/components/ui/Button'
import { Panel } from '@/components/ui/Panel'
import { ErrorNotice, LoadingState } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'
import { Tooltip } from '@/components/ui/Tooltip'
import { useWorkspace } from '@/context/WorkspaceContext'
import { useAsync } from '@/hooks/useAsync'
import { api } from '@/services/api'
import { toApiError } from '@/services/apiClient'
import type { SceneDocument, StageRecord } from '@/types/scene'
import { fmtDate, fmtDuration, fmtInt } from '@/utils/format'
import s from '../page.module.css'
import { Note, PageHeader, Stat } from '../shared'
import { PipelineStages } from './PipelineStages'
import { preflight } from './preflight'

const STAGE_LABELS: [StageRecord['id'], string][] = [
  ['input', 'Input'],
  ['preprocessing', 'Preprocessing'],
  ['calibration', 'Calibration'],
  ['feature_extraction', 'Feature extraction'],
  ['feature_matching', 'Feature matching'],
  ['pose_estimation', 'Pose estimation'],
  ['depth_estimation', 'Depth estimation'],
  ['reconstruction', '3D reconstruction'],
  ['object_detection', 'Object detection'],
  ['tracking', 'Tracking'],
  ['scene_understanding', 'Scene understanding'],
]

const WAITING: StageRecord[] = STAGE_LABELS.map(([id, label]) => ({
  id,
  label,
  status: 'waiting',
  progress: 0,
  durationMs: null,
  message: null,
  warnings: [],
  error: null,
}))

function SceneSummary({ scene }: { scene: SceneDocument }) {
  const total = scene.stats.stages.reduce((sum, st) => sum + (st.durationMs ?? 0), 0)
  const lastFrame = scene.frames.at(-1)
  return (
    <div className={s.stats}>
      <Stat label="Cameras registered" value={`${scene.stats.registeredCameras} / ${scene.cameras.length}`} />
      <Stat label="Sparse points" value={fmtInt(scene.stats.sparsePoints)} />
      <Stat label="Dense points" value={fmtInt(scene.stats.densePoints)} note="after voxel fusion" />
      <Stat label="Objects (last timestep)" value={lastFrame ? lastFrame.objects.length : '—'} />
      <Stat label="Tracks" value={scene.tracks.length || '—'} />
      <Stat label="Relations" value={scene.relations.length || '—'} />
      <Stat label="Total processing" value={fmtDuration(total)} />
      <Stat label="Generated" value={<span style={{ fontSize: 'var(--fs-sm)' }}>{fmtDate(scene.generatedAt)}</span>} />
    </div>
  )
}

export default function OverviewPage() {
  const { isDemo, projectId, scene, run, runActive, startRun, cancelRun } = useWorkspace()
  const navigate = useNavigate()
  const toast = useToast()
  const [starting, setStarting] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [startError, setStartError] = useState<unknown>(null)
  const cameras = useAsync((signal) => (isDemo ? Promise.resolve([]) : api.listCameras(projectId, signal)), [isDemo, projectId, run?.status])

  const sceneData = scene.state.data ?? null
  const stages: StageRecord[] = run ? run.stages : (sceneData?.stats.stages ?? WAITING)
  const blocker = isDemo ? null : cameras.state.status === 'success' ? preflight(cameras.state.data) : null

  const start = async () => {
    setStarting(true)
    setStartError(null)
    try {
      await startRun('input')
      toast.show('info', 'Pipeline started', 'Progress is shown below and in the top bar.')
    } catch (err) {
      setStartError(err)
    } finally {
      setStarting(false)
    }
  }

  const cancel = async () => {
    setCancelling(true)
    try {
      await cancelRun()
    } catch (err) {
      toast.show('err', 'Could not cancel', toApiError(err).message)
    } finally {
      setCancelling(false)
    }
  }

  const runButton = (
    <Button
      variant="primary"
      icon="play"
      loading={starting}
      disabled={isDemo || runActive || Boolean(blocker) || cameras.state.status !== 'success'}
      onClick={start}
    >
      {sceneData ? 'Re-run pipeline' : 'Start reconstruction'}
    </Button>
  )

  return (
    <div className={s.page}>
      <PageHeader
        title="Overview"
        description="Processing pipeline from synchronized camera frames to a 3D scene with tracked objects and spatial relations."
        actions={
          <>
            {runActive && (
              <Button icon="stop" loading={cancelling} onClick={cancel}>
                Cancel run
              </Button>
            )}
            {isDemo ? (
              <Tooltip content="The demo project is read-only. Create a project to process your own frames.">
                <span>{runButton}</span>
              </Tooltip>
            ) : (
              runButton
            )}
          </>
        }
      />

      {isDemo && (
        <Note tone="sample">
          The demo is a synthetic street scene rendered from four virtual cameras. Stages 1–8 ran the real pipeline on those
          renders; detections are simulated from the scene's ground truth because no detection model ships with this project.
          Timings below were recorded when the demo was built.
        </Note>
      )}
      {blocker && !runActive && (
        <ErrorNotice
          tone="warn"
          error={new Error(blocker)}
          title="Not ready to run"
          actions={
            <Button size="sm" icon="camera" onClick={() => navigate('../cameras')}>
              Go to Camera Inputs
            </Button>
          }
        />
      )}
      {cameras.state.status === 'error' && (
        <ErrorNotice error={cameras.state.error} title="Camera list unavailable" onRetry={cameras.reload} />
      )}
      {startError !== null && <ErrorNotice error={startError} title="The pipeline could not be started" onRetry={start} />}
      {run?.status === 'failed' && run.error && !run.stages.some((st) => st.status === 'failed') && (
        <ErrorNotice error={new Error(run.error.message)} title="The last run did not finish" onRetry={start} />
      )}

      {sceneData && <SceneSummary scene={sceneData} />}

      <Panel
        title="Pipeline"
        subtitle={run ? `Run ${run.id} · ${run.status}` : sceneData ? 'Last completed run' : 'Not run yet'}
        flush
      >
        {scene.state.status === 'loading' && !sceneData && !run ? (
          <LoadingState label="Loading pipeline state…" />
        ) : (
          <PipelineStages stages={stages} onRetry={isDemo ? undefined : start} retrying={starting} />
        )}
      </Panel>

      {sceneData && sceneData.warnings.length > 0 && (
        <Panel title="Warnings from the last run">
          <ul className={s.warningList}>
            {sceneData.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  )
}
