import { DataSourceBadge } from '@/components/DataSourceBadge'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Panel } from '@/components/ui/Panel'
import { ProgressBar } from '@/components/ui/Progress'
import { ErrorNotice } from '@/components/ui/States'
import uiStyles from '@/components/ui/ui.module.css'
import { Viewport3D } from '@/components/Viewport3D'
import { useWorkspace } from '@/context/WorkspaceContext'
import { usePointCloud } from '@/hooks/usePointCloud'
import type { SceneDocument } from '@/types/scene'
import { fmtInt, fmtLength, fmtNumber, fmtPercent } from '@/utils/format'
import { cameraColor } from '@/utils/palette'
import s from '../page.module.css'
import { PageHeader, SceneGate, Stat } from '../shared'
import { INTERACTION_HINT, LayerControls, ViewToolbar } from '../viewer/ViewerControls'
import { useViewerState } from '../viewer/useViewerState'

export default function ReconstructionPage() {
  return <SceneGate>{(scene) => <Reconstruction scene={scene} />}</SceneGate>
}

function Reconstruction({ scene }: { scene: SceneDocument }) {
  const { source, selection, select, timestep } = useWorkspace()
  const cloud = usePointCloud(source, scene)
  const viewer = useViewerState('mc3d.reconstruction.options')
  const frame = scene.frames[timestep] ?? scene.frames.at(-1)
  const ba = scene.stats.bundleAdjustment.at(-1)

  return (
    <div className={`${s.page} ${s.pageFill}`}>
      <PageHeader
        title="3D Reconstruction"
        description="Sparse structure-from-motion points (bundle adjusted) fused with dense multi-view stereo, in a +Y-up world frame."
        actions={<DataSourceBadge scene={scene} layer="reconstruction" />}
      />
      <div className={`${s.split} ${s.splitFill}`}>
        <Panel
          className={s.viewportPanel}
          title="Viewport"
          actions={<ViewToolbar projection={viewer.projection} onProjection={viewer.setProjection} onPreset={viewer.preset} />}
          flush
        >
          {cloud.status === 'loading' && (
            <div style={{ position: 'absolute', zIndex: 2, left: 12, right: 12, top: 52 }}>
              <ProgressBar value={cloud.progress} label="Downloading point cloud" />
            </div>
          )}
          {cloud.status === 'error' ? (
            <div style={{ padding: 16, width: '100%' }}>
              <ErrorNotice error={cloud.error} title="The point cloud could not be loaded" onRetry={cloud.retry} />
            </div>
          ) : (
            <Viewport3D
              scene={scene}
              cloud={cloud.status === 'ready' ? cloud.data : null}
              options={viewer.options}
              projection={viewer.projection}
              view={viewer.view}
              objects={frame?.objects ?? []}
              tracks={scene.tracks}
              trackTime={frame?.t}
              selectedObjectId={selection.objectId}
              selectedCameraId={selection.cameraId}
              onSelectObject={(id) => select({ objectId: id })}
              onSelectCamera={(id) => select({ cameraId: id })}
              ariaLabel={`3D reconstruction with ${fmtInt(scene.pointCloud.count)} points and ${scene.stats.registeredCameras} cameras. ${INTERACTION_HINT}.`}
            />
          )}
        </Panel>

        <div className={s.sideStack}>
          <div className={s.stats}>
            <Stat label="Points" value={fmtInt(scene.pointCloud.count)} note={`${fmtInt(scene.pointCloud.sparseCount)} sparse`} />
            <Stat label="Cameras" value={`${scene.stats.registeredCameras}/${scene.cameras.length}`} note="registered" />
            <Stat label="Reprojection" value={`${fmtNumber(scene.stats.meanReprojErrorPx, 2)} px`} note="mean over cameras" />
            <Stat
              label="BA final RMS"
              value={ba ? `${fmtNumber(ba.finalRmsPx, 2)} px` : '—'}
              note={`${scene.stats.bundleAdjustment.length} adjustment rounds`}
            />
            <Stat label="Scene extent" value={fmtLength(scene.stats.sceneExtent, scene, 1)} note={scene.units === 'm' ? 'metric' : 'relative scale'} />
            <Stat label="Ground plane" value={scene.groundAligned ? 'y = 0' : '—'} note={scene.groundAligned ? 'aligned' : 'not found'} />
          </div>
          <Panel title="Display">
            <LayerControls options={viewer.options} onChange={viewer.setOptions} totalDense={scene.pointCloud.denseCount} />
          </Panel>
          <Panel title="Cameras" flush>
            <table className={uiStyles.table}>
              <thead>
                <tr>
                  <th>ID</th>
                  <th className={uiStyles.right}>Points</th>
                  <th className={uiStyles.right}>Error</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {scene.cameras.map((c, i) => (
                  <tr
                    key={c.id}
                    data-selected={selection.cameraId === c.id}
                    data-clickable={Boolean(c.pose)}
                    onClick={() => c.pose && select({ cameraId: c.id })}
                  >
                    <td>
                      <span style={{ color: cameraColor(i) }} aria-hidden="true">
                        ■{' '}
                      </span>
                      <span className="mono">{c.label}</span>
                    </td>
                    <td className={`${uiStyles.right} num`}>{c.pose ? fmtInt(c.observations) : <Badge tone="warn">not registered</Badge>}</td>
                    <td className={`${uiStyles.right} num`}>{c.meanReprojErrorPx !== null ? `${fmtNumber(c.meanReprojErrorPx, 2)} px` : '—'}</td>
                    <td className={uiStyles.right}>
                      {c.pose && (
                        <Button size="sm" variant="ghost" icon="viewer" label={`View through ${c.label}`} onClick={() => viewer.lookThrough(c.id)} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
          <p className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
            {INTERACTION_HINT}. Dense share drawn: {fmtPercent(viewer.options.density, 0)}.
          </p>
        </div>
      </div>
    </div>
  )
}
