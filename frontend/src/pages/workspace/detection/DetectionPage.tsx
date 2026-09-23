import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { DataSourceBadge } from '@/components/DataSourceBadge'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Panel } from '@/components/ui/Panel'
import { Segmented } from '@/components/ui/Segmented'
import { EmptyState } from '@/components/ui/States'
import uiStyles from '@/components/ui/ui.module.css'
import { useWorkspace } from '@/context/WorkspaceContext'
import type { SceneDocument } from '@/types/scene'
import { capitalise, fmtNumber, fmtPercent } from '@/utils/format'
import { classColor } from '@/utils/palette'
import s from '../page.module.css'
import { Note, PageHeader, SceneGate, Stat } from '../shared'
import { Timeline } from '../viewer/Timeline'
import { BoxOverlay } from './BoxOverlay'

export default function DetectionPage() {
  return <SceneGate what="detection results">{(scene) => <Detection scene={scene} />}</SceneGate>
}

function NoDetections({ scene }: { scene: SceneDocument }) {
  const stage = scene.stats.stages.find((st) => st.id === 'object_detection')
  return (
    <div className={s.page}>
      <PageHeader title="Object Detection" />
      <Panel>
        <EmptyState icon="detection" title="No detections for this scene">
          {stage?.message ?? 'Object detection has not run.'} To enable it, export a YOLOv8 model to ONNX and set
          DETECTOR_MODEL_PATH on the backend (see docs/models.md), then re-run detection.
        </EmptyState>
      </Panel>
    </div>
  )
}

function Detection({ scene }: { scene: SceneDocument }) {
  const { source, selection, select, timestep, setTimestep } = useWorkspace()
  const navigate = useNavigate()
  const cams = scene.cameras.filter((c) => c.pose)
  const [cameraId, setCameraId] = useState(cams[0]?.id ?? '')
  const frame = scene.frames[Math.min(timestep, scene.frames.length - 1)]
  const camera = cams.find((c) => c.id === cameraId) ?? cams[0]
  const objects = useMemo(() => frame?.objects ?? [], [frame])

  const byClass = useMemo(() => {
    const counts = new Map<string, number>()
    objects.forEach((o) => counts.set(o.class, (counts.get(o.class) ?? 0) + 1))
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [objects])

  if (scene.frames.length === 0 || !frame) return <NoDetections scene={scene} />
  const multiView = objects.filter((o) => o.method === 'multi-view').length
  const meanConf = objects.length ? objects.reduce((sum, o) => sum + o.confidence, 0) / objects.length : null

  return (
    <div className={s.page}>
      <PageHeader
        title="Object Detection"
        description="2D detections from each camera are associated across views and triangulated into 3D. Single-view detections are placed on the ground plane."
        actions={<DataSourceBadge scene={scene} layer="detections" />}
      />
      {scene.provenance.detections === 'simulated' && (
        <Note tone="sample">
          Sample results: the demo has no detection model, so 2D boxes were generated from the synthetic ground truth with
          positional noise, confidence based on visibility and 5% random misses. Association, triangulation and everything
          downstream are the real pipeline.
        </Note>
      )}

      <div className={s.split}>
        <Panel
          title={`${camera?.label ?? ''} · frame ${frame.index}`}
          subtitle={`t = ${fmtNumber(frame.t, 2)} s`}
          actions={
            <Segmented
              label="Camera"
              value={camera?.id ?? ''}
              onChange={setCameraId}
              options={cams.map((c) => ({ value: c.id, label: c.label }))}
            />
          }
          flush
        >
          <div style={{ padding: 12 }}>
            {camera && (
              <BoxOverlay
                camera={camera}
                src={source.frameUrl(camera, frame.index)}
                objects={objects}
                selectedId={selection.objectId}
                onSelect={(id) => select({ objectId: id, trackId: objects.find((o) => o.id === id)?.trackId ?? null })}
              />
            )}
          </div>
          <Timeline scene={scene} index={Math.min(timestep, scene.frames.length - 1)} onChange={setTimestep} />
        </Panel>

        <div className={s.sideStack}>
          <div className={s.stats}>
            <Stat label="Objects" value={objects.length} note="this timestep" />
            <Stat label="Multi-view" value={multiView} note={`${objects.length - multiView} single-view`} />
            <Stat label="Mean confidence" value={fmtPercent(meanConf)} />
            <Stat label="Timesteps" value={scene.frames.length} />
          </div>
          <Panel title="Classes">
            {byClass.length === 0 ? (
              <p className="faint">Nothing detected at this timestep.</p>
            ) : (
              <ul className={s.list}>
                {byClass.map(([cls, n]) => (
                  <li key={cls} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                    <span>
                      <span style={{ color: classColor(cls) }} aria-hidden="true">
                        ■{' '}
                      </span>
                      {capitalise(cls)}
                    </span>
                    <span className="num">{n}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      <Panel title="Detected objects" subtitle={`timestep ${timestep + 1}`} flush>
        <div className={uiStyles.tableScroll}>
          <table className={uiStyles.table}>
            <thead>
              <tr>
                <th>Track</th>
                <th>Class</th>
                <th className={uiStyles.right}>Confidence</th>
                <th className={uiStyles.right}>X</th>
                <th className={uiStyles.right}>Y</th>
                <th className={uiStyles.right}>Z</th>
                <th>Visible in</th>
                <th>Localisation</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {objects.map((o) => (
                <tr
                  key={o.id}
                  data-clickable="true"
                  data-selected={o.id === selection.objectId}
                  tabIndex={0}
                  onClick={() => select({ objectId: o.id, trackId: o.trackId })}
                  onKeyDown={(e) => e.key === 'Enter' && select({ objectId: o.id, trackId: o.trackId })}
                >
                  <td className="mono">{o.trackId !== null ? `#${o.trackId}` : '—'}</td>
                  <td>{capitalise(o.class)}</td>
                  <td className={`${uiStyles.right} num`}>{fmtPercent(o.confidence)}</td>
                  <td className={`${uiStyles.right} num`}>{fmtNumber(o.center[0], 2)}</td>
                  <td className={`${uiStyles.right} num`}>{fmtNumber(o.center[1], 2)}</td>
                  <td className={`${uiStyles.right} num`}>{fmtNumber(o.center[2], 2)}</td>
                  <td className="mono">{o.visibleCameras.join(' ')}</td>
                  <td>{o.method === 'multi-view' ? <Badge tone="ok">{o.visibleCameras.length} views</Badge> : <Badge tone="warn">ground contact</Badge>}</td>
                  <td className={uiStyles.right}>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon="viewer"
                      label={`Show ${o.id} in the 3D viewer`}
                      onClick={(e) => {
                        e.stopPropagation()
                        select({ objectId: o.id, trackId: o.trackId })
                        navigate('../viewer')
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}
