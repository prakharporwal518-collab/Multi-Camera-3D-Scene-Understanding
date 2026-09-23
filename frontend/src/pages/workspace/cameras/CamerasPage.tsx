import { useEffect, useMemo, useState } from 'react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { TextInput } from '@/components/ui/Form'
import { KeyValue } from '@/components/ui/KeyValue'
import { Panel } from '@/components/ui/Panel'
import { EmptyState, ErrorNotice, ErrorState, LoadingState } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'
import { useWorkspace } from '@/context/WorkspaceContext'
import { useAsync } from '@/hooks/useAsync'
import { api } from '@/services/api'
import type { Camera } from '@/types/project'
import { fmtNumber, fmtResolution } from '@/utils/format'
import { cameraAngles } from '@/utils/geometry'
import { cameraColor } from '@/utils/palette'
import { DEFAULT_LIMITS, validateName } from '@/utils/validation'
import s from '../page.module.css'
import { Note, PageHeader } from '../shared'
import c from './cameras.module.css'
import { FramePreview } from './FramePreview'
import { rowsFromApi, rowsFromScene, type CameraRow } from './model'
import { UploadControls } from './UploadControls'

export default function CamerasPage() {
  const { isDemo, projectId, scene, source, runActive } = useWorkspace()
  const toast = useToast()
  const cameras = useAsync((signal) => (isDemo ? Promise.resolve([]) : api.listCameras(projectId, signal)), [isDemo, projectId])
  const health = useAsync((signal) => (isDemo ? Promise.resolve(null) : api.health(signal)), [isDemo])
  const [local, setLocal] = useState<Camera[] | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [dialog, setDialog] = useState<null | 'add' | 'rename' | 'remove' | 'clear'>(null)

  useEffect(() => {
    if (cameras.state.status === 'success') setLocal(cameras.state.data)
  }, [cameras.state])

  const sceneData = scene.state.data ?? null
  const rows: CameraRow[] = useMemo(
    () => (isDemo ? (sceneData ? rowsFromScene(sceneData) : []) : rowsFromApi(local ?? [], sceneData)),
    [isDemo, sceneData, local],
  )
  const selected = rows.find((r) => r.id === selectedId) ?? rows[0] ?? null
  const limits = health.state.data?.limits ?? DEFAULT_LIMITS
  const maxCameras = health.state.data?.limits.maxCameras ?? 8

  const replaceCamera = (cam: Camera) => setLocal((list) => (list ?? []).map((x) => (x.id === cam.id ? cam : x)))

  if (!isDemo && cameras.state.status === 'loading' && !local) return <LoadingState label="Loading cameras…" />
  if (!isDemo && cameras.state.status === 'error' && !local) {
    return <ErrorState error={cameras.state.error} title="Cameras could not be loaded" onRetry={cameras.reload} />
  }
  if (isDemo && !sceneData) {
    return scene.state.status === 'error' ? (
      <ErrorState error={scene.state.error} onRetry={scene.reload} />
    ) : (
      <LoadingState label="Loading demo cameras…" />
    )
  }

  return (
    <div className={s.page}>
      <PageHeader
        title="Camera Inputs"
        description="Each camera contributes a synchronized frame sequence. Frames are paired across cameras by index."
        actions={
          !isDemo && (
            <Button
              variant="primary"
              icon="plus"
              disabled={runActive || rows.length >= maxCameras}
              title={rows.length >= maxCameras ? `A project can have at most ${maxCameras} cameras` : undefined}
              onClick={() => setDialog('add')}
            >
              Add camera
            </Button>
          )
        }
      />
      {isDemo && (
        <Note tone="sample">
          Demo cameras are virtual: their frames are synthetic renders and they cannot be edited. Create a project to upload
          your own footage.
        </Note>
      )}
      {runActive && <Note icon="clock">The pipeline is running; camera changes are locked until it finishes.</Note>}

      {rows.length === 0 ? (
        <Panel>
          <EmptyState
            icon="camera"
            title="No cameras yet"
            actions={
              <Button variant="primary" icon="plus" onClick={() => setDialog('add')}>
                Add camera
              </Button>
            }
          >
            Add at least two cameras that observe the same area from different positions, then upload their frames.
          </EmptyState>
        </Panel>
      ) : (
        <div className={c.layout}>
          <Panel title="Cameras" subtitle={`${rows.length} configured`} flush>
            <ul className={c.cameraList}>
              {rows.map((r, i) => (
                <li key={r.id}>
                  <button
                    type="button"
                    className={c.cameraItem}
                    aria-current={r.id === selected?.id}
                    onClick={() => setSelectedId(r.id)}
                  >
                    <span className={c.swatch} style={{ background: cameraColor(i) }} aria-hidden="true" />
                    <span className={c.cameraMeta}>
                      <span className={c.cameraLabel}>{r.label}</span>
                      <span className={c.cameraSub}>
                        {r.name} · {r.frameCount} frames
                      </span>
                    </span>
                    {r.status === 'ready' ? (
                      <Badge tone="ok" icon="check">
                        Ready
                      </Badge>
                    ) : (
                      <Badge tone="warn" icon="warning">
                        No frames
                      </Badge>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </Panel>

          {selected && (
            <CameraDetail
              row={selected}
              isDemo={isDemo}
              locked={runActive}
              limits={limits}
              onUploaded={replaceCamera}
              onRename={() => setDialog('rename')}
              onRemove={() => setDialog('remove')}
              onClear={() => setDialog('clear')}
              source={source}
            />
          )}
        </div>
      )}

      {rows.length === 1 && !isDemo && (
        <ErrorNotice
          tone="warn"
          error={new Error('Multi-view reconstruction needs at least two cameras.')}
          title="Only one camera"
        />
      )}

      <AddCameraDialog
        open={dialog === 'add'}
        onClose={() => setDialog(null)}
        onCreate={async (name) => {
          const cam = await api.addCamera(projectId, name || undefined)
          setLocal((list) => [...(list ?? []), cam])
          setSelectedId(cam.id)
          toast.show('ok', `${cam.label} added`)
        }}
      />
      {selected?.api && (
        <>
          <RenameDialog
            open={dialog === 'rename'}
            camera={selected.api}
            onClose={() => setDialog(null)}
            onSaved={replaceCamera}
          />
          <ConfirmDialog
            open={dialog === 'remove'}
            title={`Remove ${selected.label}?`}
            confirmLabel="Remove camera"
            onClose={() => setDialog(null)}
            onConfirm={async () => {
              await api.deleteCamera(selected.id)
              setLocal((list) => (list ?? []).filter((x) => x.id !== selected.id))
              setSelectedId(null)
              toast.show('ok', `${selected.label} removed`)
            }}
          >
            Its {selected.frameCount} uploaded frames and calibration are deleted. Existing results become out of date.
          </ConfirmDialog>
          <ConfirmDialog
            open={dialog === 'clear'}
            title={`Clear frames of ${selected.label}?`}
            confirmLabel="Clear frames"
            onClose={() => setDialog(null)}
            onConfirm={async () => {
              replaceCamera(await api.clearFrames(selected.id))
              toast.show('ok', `Frames of ${selected.label} cleared`)
            }}
          >
            All {selected.frameCount} frames and the camera's calibration will be deleted.
          </ConfirmDialog>
        </>
      )}
    </div>
  )
}

function CameraDetail({
  row,
  isDemo,
  locked,
  limits,
  source,
  onUploaded,
  onRename,
  onRemove,
  onClear,
}: {
  row: CameraRow
  isDemo: boolean
  locked: boolean
  limits: typeof DEFAULT_LIMITS
  source: ReturnType<typeof useWorkspace>['source']
  onUploaded: (c: Camera) => void
  onRename: () => void
  onRemove: () => void
  onClear: () => void
}) {
  const pose = row.scene?.pose ?? null
  const angles = pose ? cameraAngles(pose) : null
  return (
    <Panel
      title={`${row.label} · ${row.name}`}
      actions={
        !isDemo && (
          <>
            <Button size="sm" variant="ghost" icon="edit" disabled={locked} onClick={onRename}>
              Rename
            </Button>
            {row.frameCount > 0 && (
              <Button size="sm" variant="ghost" icon="refresh" disabled={locked} onClick={onClear}>
                Clear frames
              </Button>
            )}
            <Button size="sm" variant="danger" icon="trash" disabled={locked} onClick={onRemove}>
              Remove
            </Button>
          </>
        )
      }
    >
      <div className={c.detailGrid}>
        <FramePreview row={row} source={source} />
        <div className={s.controlsStack}>
          <KeyValue
            items={[
              ['Camera ID', <span className="mono">{row.label}</span>],
              ['Resolution', <span className="num">{fmtResolution(row.width, row.height)}</span>],
              ['Frame rate', row.fps ? <span className="num">{fmtNumber(row.fps, 1)} FPS</span> : <span className="faint">unknown (image sequence)</span>],
              ['Frames', <span className="num">{row.frameCount}</span>],
              ['Source', row.sourceKind === 'synthetic' ? 'Synthetic render' : (row.sourceKind ?? '—')],
              ['Status', row.status === 'ready' ? 'Connected · frames available' : 'Waiting for frames'],
              ['Calibration', row.calibration],
              [
                'Position',
                pose ? (
                  <span className="num">
                    {pose.position.map((v) => fmtNumber(v, 2)).join(', ')}
                  </span>
                ) : (
                  <span className="faint">{row.scene?.registrationNote ?? 'after reconstruction'}</span>
                ),
              ],
              [
                'Orientation',
                angles ? (
                  <span className="num">
                    yaw {fmtNumber(angles.yaw, 1)}°, pitch {fmtNumber(angles.pitch, 1)}°
                  </span>
                ) : (
                  <span className="faint">after reconstruction</span>
                ),
              ],
            ]}
          />
          {!isDemo && row.api && <UploadControls camera={row.api} limits={limits} disabled={locked} onUploaded={onUploaded} />}
        </div>
      </div>
    </Panel>
  )
}

function AddCameraDialog({ open, onClose, onCreate }: { open: boolean; onClose: () => void; onCreate: (name: string) => Promise<void> }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const nameError = name.trim() ? validateName(name, 'Camera name', 60) : null
  const submit = async () => {
    if (nameError) return
    setBusy(true)
    setError(null)
    try {
      await onCreate(name.trim())
      setName('')
      onClose()
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open={open}
      title="Add camera"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={Boolean(nameError)} onClick={submit}>
            Add camera
          </Button>
        </>
      }
    >
      <TextInput
        label="Name (optional)"
        help="A label such as “North entrance”. The ID (CAM-01, CAM-02, …) is assigned automatically."
        value={name}
        maxLength={60}
        error={nameError}
        onChange={setName}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        autoFocus
      />
      {error !== null && <ErrorNotice error={error} />}
    </Dialog>
  )
}

function RenameDialog({ open, camera, onClose, onSaved }: { open: boolean; camera: Camera; onClose: () => void; onSaved: (c: Camera) => void }) {
  const [name, setName] = useState(camera.name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  useEffect(() => {
    if (open) setName(camera.name)
  }, [open, camera.name])
  const nameError = validateName(name, 'Camera name', 60)
  const submit = async () => {
    if (nameError) return
    setBusy(true)
    setError(null)
    try {
      onSaved(await api.renameCamera(camera.id, name.trim()))
      onClose()
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open={open}
      title={`Rename ${camera.label}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={Boolean(nameError)} onClick={submit}>
            Save
          </Button>
        </>
      }
    >
      <TextInput label="Name" value={name} maxLength={60} error={nameError} onChange={setName} autoFocus />
      {error !== null && <ErrorNotice error={error} />}
    </Dialog>
  )
}
