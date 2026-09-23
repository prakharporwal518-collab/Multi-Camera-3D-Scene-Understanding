import { lazy, Suspense } from 'react'
import { DataSourceBadge } from '@/components/DataSourceBadge'
import { Badge } from '@/components/ui/Badge'
import { Panel } from '@/components/ui/Panel'
import { EmptyState, LoadingState } from '@/components/ui/States'
import uiStyles from '@/components/ui/ui.module.css'
import { useWorkspace } from '@/context/WorkspaceContext'
import type { SceneDocument, Track } from '@/types/scene'
import { capitalise, fmtNumber, fmtPercent, unitLabel } from '@/utils/format'
import { compassLabel, groundSpeed, headingDeg } from '@/utils/geometry'
import { classColor } from '@/utils/palette'
import s from '../page.module.css'
import { cameraLabel } from '@/utils/sceneLookup'
import { Note, PageHeader, SceneGate } from '../shared'
import { Timeline } from '../viewer/Timeline'
import { TrajectoryPlot } from './TrajectoryPlot'

const SpeedChart = lazy(() => import('./SpeedChart'))

export default function TrackingPage() {
  return <SceneGate what="tracking results">{(scene) => <Tracking scene={scene} />}</SceneGate>
}

function stateAt(track: Track, t: number) {
  return track.states.find((st) => Math.abs(st.t - t) < 1e-6) ?? null
}

function Tracking({ scene }: { scene: SceneDocument }) {
  const { selection, select, timestep, setTimestep } = useWorkspace()
  const frame = scene.frames[Math.min(timestep, Math.max(0, scene.frames.length - 1))]
  const selected = scene.tracks.find((t) => t.id === selection.trackId) ?? null
  const unit = unitLabel(scene)

  if (scene.tracks.length === 0) {
    const stage = scene.stats.stages.find((st) => st.id === 'tracking')
    return (
      <div className={s.page}>
        <PageHeader title="Tracking" />
        <Panel>
          <EmptyState icon="tracking" title="No object tracks">
            {stage?.message ?? 'Tracking has not run.'}
          </EmptyState>
        </Panel>
      </div>
    )
  }

  const pick = (id: number) => {
    const obj = frame?.objects.find((o) => o.trackId === id)
    select({ trackId: id, objectId: obj?.id ?? null })
  }

  return (
    <div className={s.page}>
      <PageHeader
        title="Tracking"
        description="3D detections are linked over time with a constant-velocity (alpha–beta) filter and gated nearest-neighbour association per class."
        actions={<DataSourceBadge scene={scene} layer="detections" />}
      />
      {scene.provenance.detections === 'simulated' && (
        <Note tone="sample">Tracks are computed by the real tracker, but its input detections are simulated (see Object Detection).</Note>
      )}
      <div className={s.split}>
        <Panel title="Trajectories" subtitle="plan view · filled dots observed, hollow predicted" flush>
          <div style={{ padding: 12 }}>
            <TrajectoryPlot scene={scene} selectedTrackId={selection.trackId} currentT={frame?.t ?? null} onSelect={pick} />
          </div>
          <Timeline scene={scene} index={Math.min(timestep, scene.frames.length - 1)} onChange={setTimestep} />
        </Panel>
        <Panel title="Tracks" subtitle={`${scene.tracks.length} confirmed`} flush>
          <div className={uiStyles.tableScroll}>
            <table className={uiStyles.table}>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Class</th>
                  <th className={uiStyles.right}>Speed</th>
                  <th className={uiStyles.right}>Conf.</th>
                </tr>
              </thead>
              <tbody>
                {scene.tracks.map((tr) => {
                  const st = frame ? stateAt(tr, frame.t) : null
                  return (
                    <tr
                      key={tr.id}
                      data-clickable="true"
                      data-selected={tr.id === selection.trackId}
                      tabIndex={0}
                      onClick={() => pick(tr.id)}
                      onKeyDown={(e) => e.key === 'Enter' && pick(tr.id)}
                    >
                      <td className="mono">
                        <span style={{ color: classColor(tr.class) }} aria-hidden="true">
                          ■{' '}
                        </span>
                        #{tr.id}
                      </td>
                      <td>{capitalise(tr.class)}</td>
                      <td className={`${uiStyles.right} num`}>{st ? `${fmtNumber(groundSpeed(st.velocity), 2)}` : <span className="faint">—</span>}</td>
                      <td className={`${uiStyles.right} num`}>{fmtPercent(tr.confidence, 0)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      {selected ? (
        <TrackDetails track={selected} unit={unit} currentT={frame?.t ?? null} labelOf={(id) => cameraLabel(scene, id)} />
      ) : (
        <Panel>
          <EmptyState compact icon="target" title="Select a track">
            Click a trajectory or a row to inspect its history.
          </EmptyState>
        </Panel>
      )}
    </div>
  )
}

function TrackDetails({ track, unit, currentT, labelOf }: { track: Track; unit: string; currentT: number | null; labelOf: (id: string) => string }) {
  const current = currentT !== null ? stateAt(track, currentT) : null
  const last = current ?? track.states.at(-1)!
  const speed = groundSpeed(last.velocity)
  return (
    <div className={s.grid2}>
      <Panel title={`Track #${track.id} · ${capitalise(track.class)}`} actions={<Badge tone={track.status === 'lost' ? 'neutral' : 'ok'}>{track.status}</Badge>}>
        <div className={s.stats} style={{ marginBottom: 12 }}>
          <div className={s.stat}>
            <span className={s.statLabel}>Position</span>
            <span className="num">
              {last.position.map((v) => fmtNumber(v, 2)).join(', ')}
            </span>
          </div>
          <div className={s.stat}>
            <span className={s.statLabel}>Velocity</span>
            <span className="num">
              {fmtNumber(speed, 2)} {unit}/s
            </span>
          </div>
          <div className={s.stat}>
            <span className={s.statLabel}>Direction</span>
            <span className="num">{speed > 0.05 ? `${fmtNumber(headingDeg(last.velocity), 0)}° (${compassLabel(headingDeg(last.velocity))})` : 'stationary'}</span>
          </div>
          <div className={s.stat}>
            <span className={s.statLabel}>Observations</span>
            <span className="num">
              {track.observations} / {track.states.length}
            </span>
          </div>
          <div className={s.stat}>
            <span className={s.statLabel}>Track confidence</span>
            <span className="num">{fmtPercent(track.confidence)}</span>
          </div>
          <div className={s.stat}>
            <span className={s.statLabel}>Mean speed</span>
            <span className="num">
              {fmtNumber(track.meanSpeed, 2)} {unit}/s
            </span>
          </div>
        </div>
        <Suspense fallback={<LoadingState label="Loading chart…" />}>
          <SpeedChart track={track} unit={unit} />
        </Suspense>
      </Panel>
      <Panel title="History" flush>
        <div className={uiStyles.tableScroll} style={{ maxHeight: 380 }}>
          <table className={uiStyles.table}>
            <thead>
              <tr>
                <th className={uiStyles.right}>t (s)</th>
                <th className={uiStyles.right}>X</th>
                <th className={uiStyles.right}>Z</th>
                <th className={uiStyles.right}>Speed</th>
                <th>Cameras</th>
              </tr>
            </thead>
            <tbody>
              {track.states.map((st) => (
                <tr key={st.t} data-selected={currentT !== null && Math.abs(st.t - currentT) < 1e-6}>
                  <td className={`${uiStyles.right} num`}>{fmtNumber(st.t, 2)}</td>
                  <td className={`${uiStyles.right} num`}>{fmtNumber(st.position[0], 2)}</td>
                  <td className={`${uiStyles.right} num`}>{fmtNumber(st.position[2], 2)}</td>
                  <td className={`${uiStyles.right} num`}>{fmtNumber(groundSpeed(st.velocity), 2)}</td>
                  <td className="mono">{st.observed ? st.cameras.map(labelOf).join(' ') : <span className="faint">predicted</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}
