import { useMemo, useState } from 'react'
import { Badge, type Tone } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Form'
import { KeyValue, Matrix } from '@/components/ui/KeyValue'
import { Panel } from '@/components/ui/Panel'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'
import { useWorkspace } from '@/context/WorkspaceContext'
import { useAsync } from '@/hooks/useAsync'
import { api } from '@/services/api'
import type { Camera } from '@/types/project'
import type { CameraPose, Intrinsics } from '@/types/scene'
import { fmtNumber } from '@/utils/format'
import { cameraAngles } from '@/utils/geometry'
import s from '../page.module.css'
import { Note, PageHeader } from '../shared'
import { ImagePlaneDiagram, RigPlan } from './diagrams'
import { RecalibrateDialog } from './RecalibrateDialog'

interface CalibView {
  id: string
  label: string
  intr: Intrinsics | null
  method: string
  calibErrorPx: number | null
  sfmErrorPx: number | null
  observations: number
  pose: CameraPose | null
  fovY: number | null
  note: string | null
  api: Camera | null
}

function assumed(w: number, h: number): Intrinsics {
  const f = Math.max(w, h)
  return { fx: f, fy: f, cx: w / 2, cy: h / 2, width: w, height: h, dist: [0, 0, 0, 0, 0] }
}

function quality(v: CalibView): { label: string; tone: Tone } {
  if (v.method === 'synthetic') return { label: 'Exact (synthetic)', tone: 'sample' }
  if (v.method === 'assumed') return { label: 'Approximate', tone: 'warn' }
  const e = v.calibErrorPx
  if (e === null) return { label: 'User supplied', tone: 'neutral' }
  if (e < 0.5) return { label: 'Good', tone: 'ok' }
  if (e < 1) return { label: 'Acceptable', tone: 'warn' }
  return { label: 'Poor', tone: 'err' }
}

export default function CalibrationPage() {
  const { isDemo, projectId, scene, runActive } = useWorkspace()
  const toast = useToast()
  const cameras = useAsync((signal) => (isDemo ? Promise.resolve([]) : api.listCameras(projectId, signal)), [isDemo, projectId])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const sceneData = scene.state.data ?? null

  const views: CalibView[] = useMemo(() => {
    const apiCams = cameras.state.data ?? []
    if (sceneData) {
      return sceneData.cameras.map((c) => ({
        id: c.id,
        label: c.label,
        intr: c.intrinsics,
        method: c.calibration.method,
        calibErrorPx: c.calibration.reprojectionErrorPx,
        sfmErrorPx: c.meanReprojErrorPx,
        observations: c.observations,
        pose: c.pose,
        fovY: c.fovY,
        note: c.registrationNote,
        api: apiCams.find((a) => a.id === c.id) ?? null,
      }))
    }
    return apiCams.map((c) => ({
      id: c.id,
      label: c.label,
      intr: c.calibration?.intrinsics ?? (c.width && c.height ? assumed(c.width, c.height) : null),
      method: c.calibration?.method ?? 'assumed',
      calibErrorPx: c.calibration?.reprojectionErrorPx ?? null,
      sfmErrorPx: null,
      observations: 0,
      pose: null,
      fovY: null,
      note: null,
      api: c,
    }))
  }, [sceneData, cameras.state.data])

  if (scene.state.status === 'loading' && !sceneData) return <LoadingState label="Loading calibration…" />
  if (!isDemo && cameras.state.status === 'error' && !sceneData) {
    return <ErrorState error={cameras.state.error} onRetry={cameras.reload} />
  }
  if (views.length === 0) {
    return (
      <div className={s.page}>
        <PageHeader title="Calibration" />
        <Panel>
          <EmptyState icon="calibration" title="No cameras to calibrate">
            Add cameras and upload frames on the Camera Inputs page first.
          </EmptyState>
        </Panel>
      </div>
    )
  }

  const v = views.find((x) => x.id === selectedId) ?? views[0]
  const q = quality(v)
  const angles = v.pose ? cameraAngles(v.pose) : null
  const settingChanged = v.api && sceneData && (v.api.calibration?.method ?? 'assumed') !== v.method

  return (
    <div className={s.page}>
      <PageHeader
        title="Calibration"
        description="Intrinsics map camera rays to pixels; extrinsics place each camera in the shared world frame (+Y up)."
        actions={
          <>
            <div style={{ width: 180 }}>
              <Select
                label="Camera"
                value={v.id}
                onChange={setSelectedId}
                options={views.map((x) => ({ value: x.id, label: `${x.label}` }))}
              />
            </div>
            {!isDemo && v.api && (
              <Button icon="refresh" disabled={runActive || v.api.frameCount === 0} onClick={() => setDialogOpen(true)} style={{ alignSelf: 'flex-end' }}>
                Recalibrate
              </Button>
            )}
          </>
        }
      />
      {isDemo && (
        <Note tone="sample">
          Demo intrinsics are the exact values used to render the synthetic images, so there is no calibration error to
          report. Extrinsics below were estimated by the pipeline, not copied from the renderer.
        </Note>
      )}
      {settingChanged && (
        <Note icon="warning">
          The calibration of {v.label} changed after the last run ({v.method} → {v.api?.calibration?.method ?? 'assumed'}). Re-run
          the pipeline to use it.
        </Note>
      )}

      <div className={s.grid3}>
        <Panel title="Intrinsic matrix K" subtitle="pixels">
          {v.intr ? (
            <div className={s.controlsStack}>
              <Matrix label="Intrinsic matrix" cols={3} digits={2} values={[v.intr.fx, 0, v.intr.cx, 0, v.intr.fy, v.intr.cy, 0, 0, 1]} />
              <KeyValue
                items={[
                  ['Focal length', <span className="num">fx {fmtNumber(v.intr.fx, 2)} · fy {fmtNumber(v.intr.fy, 2)}</span>],
                  ['Principal point', <span className="num">({fmtNumber(v.intr.cx, 2)}, {fmtNumber(v.intr.cy, 2)})</span>],
                  ['Image size', <span className="num">{v.intr.width} × {v.intr.height}</span>],
                  ['Vertical FOV', <span className="num">{fmtNumber(v.fovY ?? (2 * Math.atan2(v.intr.height / 2, v.intr.fy) * 180) / Math.PI, 1)}°</span>],
                  [
                    'Distortion',
                    <span className="num" title="OpenCV order k1, k2, p1, p2, k3">
                      {v.intr.dist.map((d) => fmtNumber(d, 4)).join(', ')}
                    </span>,
                  ],
                ]}
              />
            </div>
          ) : (
            <p className="faint">Upload frames to determine the image size.</p>
          )}
        </Panel>

        <Panel title="Extrinsics [R | t]" subtitle="world → camera">
          {v.pose ? (
            <div className={s.controlsStack}>
              <Matrix
                label="Rotation and translation"
                cols={4}
                digits={4}
                values={[0, 1, 2].flatMap((r) => [v.pose!.R[r * 3], v.pose!.R[r * 3 + 1], v.pose!.R[r * 3 + 2], v.pose!.t[r]])}
              />
              <KeyValue
                items={[
                  ['Position', <span className="num">{v.pose.position.map((x) => fmtNumber(x, 3)).join(', ')}</span>],
                  [
                    'Rotation',
                    <span className="num">
                      yaw {fmtNumber(angles!.yaw, 2)}° · pitch {fmtNumber(angles!.pitch, 2)}° · roll {fmtNumber(angles!.roll, 2)}°
                    </span>,
                  ],
                  ['Units', sceneData?.units === 'm' ? 'metres' : 'relative (initial baseline = 1)'],
                ]}
              />
            </div>
          ) : (
            <p className="faint">{v.note ?? 'Extrinsics are estimated during reconstruction.'}</p>
          )}
        </Panel>

        <Panel title="Quality">
          <KeyValue
            items={[
              ['Method', <span style={{ textTransform: 'capitalize' }}>{v.method}</span>],
              ['Rating', <Badge tone={q.tone}>{q.label}</Badge>],
              ['Calibration RMS', v.calibErrorPx !== null ? <span className="num">{fmtNumber(v.calibErrorPx, 3)} px</span> : <span className="faint">n/a</span>],
              [
                'SfM reprojection',
                v.sfmErrorPx !== null ? <span className="num">{fmtNumber(v.sfmErrorPx, 3)} px (mean, {v.observations} points)</span> : <span className="faint">after reconstruction</span>,
              ],
              ['Registered', v.pose ? 'Yes' : sceneData ? 'No' : '—'],
            ]}
          />
        </Panel>
      </div>

      <div className={s.grid2}>
        <Panel title="Image plane" subtitle="blue: principal point · grey: image centre · grid warped by distortion">
          {v.intr ? <ImagePlaneDiagram intr={v.intr} /> : <p className="faint">No image size yet.</p>}
        </Panel>
        <Panel title="Camera layout" subtitle="plan view (X–Z), arrows show viewing direction">
          {sceneData ? <RigPlan cameras={sceneData.cameras} selectedId={v.id} onSelect={setSelectedId} /> : <p className="faint">Available after reconstruction.</p>}
        </Panel>
      </div>

      {v.api && (
        <RecalibrateDialog
          open={dialogOpen}
          camera={v.api}
          onClose={() => setDialogOpen(false)}
          onDone={(cam) => {
            toast.show('ok', `${cam.label} calibrated`, cam.calibration?.reprojectionErrorPx != null ? `RMS reprojection error ${cam.calibration.reprojectionErrorPx.toFixed(3)} px` : undefined)
            cameras.reload()
          }}
        />
      )}
    </div>
  )
}
