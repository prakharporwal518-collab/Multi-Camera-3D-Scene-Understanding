import { useMemo, useState } from 'react'
import { DataSourceBadge } from '@/components/DataSourceBadge'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Form'
import { Panel } from '@/components/ui/Panel'
import { ProgressBar } from '@/components/ui/Progress'
import { ErrorNotice } from '@/components/ui/States'
import { Viewport3D } from '@/components/Viewport3D'
import { useWorkspace } from '@/context/WorkspaceContext'
import { usePointCloud } from '@/hooks/usePointCloud'
import type { SceneDocument, Vec3 } from '@/types/scene'
import { fmtLength, fmtNumber, unitLabel } from '@/utils/format'
import { distance } from '@/utils/geometry'
import s from '../page.module.css'
import { PageHeader, SceneGate } from '../shared'
import { CameraDetails, NothingSelected, ObjectDetails } from './SelectionPanel'
import { Timeline } from './Timeline'
import { INTERACTION_HINT, LayerControls, ViewToolbar } from './ViewerControls'
import { useViewerState } from './useViewerState'

export default function ViewerPage() {
  return <SceneGate>{(scene) => <Viewer scene={scene} />}</SceneGate>
}

function Viewer({ scene }: { scene: SceneDocument }) {
  const { source, selection, select, timestep, setTimestep } = useWorkspace()
  const cloud = usePointCloud(source, scene)
  const viewer = useViewerState('mc3d.viewer.options')
  const [measuring, setMeasuring] = useState(false)
  const [measure, setMeasure] = useState<Vec3[]>([])
  const frame = scene.frames[timestep] ?? scene.frames.at(-1)
  const objects = useMemo(() => frame?.objects ?? [], [frame])
  const selectedObject = objects.find((o) => o.id === selection.objectId) ?? null
  const selectedCamera = scene.cameras.find((c) => c.id === selection.cameraId) ?? null
  const measured = measure.length === 2 ? distance(measure[0], measure[1]) : null

  const addMeasurePoint = (p: Vec3) => setMeasure((m) => (m.length >= 2 ? [p] : [...m, p]))
  const toggleMeasure = () => {
    setMeasuring((m) => !m)
    setMeasure([])
  }

  return (
    <div className={`${s.page} ${s.pageFill}`}>
      <PageHeader
        title="3D Viewer"
        description="Inspect objects, cameras and trajectories in the reconstructed scene. Select an object to see its properties."
        actions={
          <>
            <DataSourceBadge scene={scene} layer="reconstruction" />
            {scene.frames.length > 0 && <DataSourceBadge scene={scene} layer="detections" />}
          </>
        }
      />
      <div className={`${s.split} ${s.splitFill}`}>
        <Panel
          className={s.viewportPanel}
          title="Scene"
          actions={
            <div className={s.toolbar}>
              <ViewToolbar projection={viewer.projection} onProjection={viewer.setProjection} onPreset={viewer.preset} />
              <span className={s.toolbarSep} aria-hidden="true" />
              <div style={{ width: 130 }}>
                <Select
                  label={<span className="visually-hidden">View through camera</span>}
                  value=""
                  onChange={(id) => id && viewer.lookThrough(id)}
                  options={[
                    { value: '', label: 'View through…' },
                    ...scene.cameras.filter((c) => c.pose).map((c) => ({ value: c.id, label: c.label })),
                  ]}
                />
              </div>
              <Button size="sm" icon="ruler" variant={measuring ? 'primary' : 'secondary'} aria-pressed={measuring} onClick={toggleMeasure}>
                Measure
              </Button>
            </div>
          }
          flush
        >
          <div style={{ display: 'flex', flexDirection: 'column', width: '100%', minHeight: 0 }}>
            <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
              {cloud.status === 'loading' && (
                <div style={{ position: 'absolute', zIndex: 2, left: 12, right: 12, top: 12 }}>
                  <ProgressBar value={cloud.progress} label="Downloading point cloud" />
                </div>
              )}
              {cloud.status === 'error' ? (
                <div style={{ padding: 16 }}>
                  <ErrorNotice error={cloud.error} title="The point cloud could not be loaded" onRetry={cloud.retry} />
                </div>
              ) : (
                <Viewport3D
                  scene={scene}
                  cloud={cloud.status === 'ready' ? cloud.data : null}
                  options={viewer.options}
                  projection={viewer.projection}
                  view={viewer.view}
                  objects={objects}
                  tracks={scene.tracks}
                  trackTime={frame?.t}
                  selectedObjectId={selection.objectId}
                  selectedCameraId={selection.cameraId}
                  selectedTrackId={selectedObject?.trackId ?? selection.trackId}
                  onSelectObject={(id) => {
                    const obj = objects.find((o) => o.id === id)
                    select({ objectId: id, trackId: obj?.trackId ?? null, cameraId: id ? null : selection.cameraId })
                  }}
                  onSelectCamera={(id) => select({ cameraId: id, objectId: null })}
                  measuring={measuring}
                  measurePoints={measure}
                  measureLabel={measured !== null ? fmtLength(measured, scene) : null}
                  onMeasurePoint={addMeasurePoint}
                  ariaLabel={`Interactive 3D scene. ${INTERACTION_HINT}.`}
                />
              )}
            </div>
            <Timeline scene={scene} index={Math.min(timestep, Math.max(0, scene.frames.length - 1))} onChange={setTimestep} />
          </div>
        </Panel>

        <div className={s.sideStack}>
          {measuring && (
            <Panel title="Measurement" actions={<Button size="sm" variant="ghost" onClick={() => setMeasure([])}>Clear</Button>}>
              {measure.length === 0 && <p className="muted">Click a point, box or the ground to set the first point.</p>}
              {measure.length === 1 && <p className="muted">Click a second point.</p>}
              {measured !== null && (
                <p>
                  <span className="num" style={{ fontSize: 'var(--fs-lg)' }}>
                    {fmtNumber(measured, 3)} {unitLabel(scene)}
                  </span>
                  <br />
                  <span className="faint">
                    Δ {measure[1].map((v, i) => fmtNumber(v - measure[0][i], 2)).join(', ')}
                  </span>
                </p>
              )}
              {scene.units !== 'm' && <p className="faint" style={{ marginTop: 6 }}>Relative units: set a known baseline in Settings for metres.</p>}
            </Panel>
          )}
          {selectedObject && frame ? (
            <ObjectDetails scene={scene} object={selectedObject} t={frame.t} onClear={() => select({ objectId: null, trackId: null })} />
          ) : selectedCamera ? (
            <CameraDetails
              scene={scene}
              camera={selectedCamera}
              onLookThrough={() => viewer.lookThrough(selectedCamera.id)}
              onClear={() => select({ cameraId: null })}
            />
          ) : (
            <NothingSelected />
          )}
          <Panel title="Display">
            <LayerControls options={viewer.options} onChange={viewer.setOptions} totalDense={scene.pointCloud.denseCount} />
          </Panel>
        </div>
      </div>
    </div>
  )
}
