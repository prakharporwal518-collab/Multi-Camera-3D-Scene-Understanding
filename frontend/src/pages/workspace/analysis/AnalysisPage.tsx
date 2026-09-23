import { lazy, Suspense, useMemo } from 'react'
import { KeyValue } from '@/components/ui/KeyValue'
import { Panel } from '@/components/ui/Panel'
import { LoadingState } from '@/components/ui/States'
import uiStyles from '@/components/ui/ui.module.css'
import type { SceneDocument } from '@/types/scene'
import { fmtDuration, fmtInt, fmtNumber, fmtPercent } from '@/utils/format'
import s from '../page.module.css'
import { cameraLabel } from '@/utils/sceneLookup'
import { Note, PageHeader, SceneGate, Stat } from '../shared'
import { readBrowserInfo } from './browserInfo'

const charts = import('./AnalysisCharts')
const StageTimingChart = lazy(() => charts.then((m) => ({ default: m.StageTimingChart })))
const ReprojectionHistogram = lazy(() => charts.then((m) => ({ default: m.ReprojectionHistogram })))

export default function AnalysisPage() {
  return <SceneGate what="analysis">{(scene) => <Analysis scene={scene} />}</SceneGate>
}

function stageMs(scene: SceneDocument, id: string): number | null {
  return scene.stats.stages.find((st) => st.id === id)?.durationMs ?? null
}

function Analysis({ scene }: { scene: SceneDocument }) {
  const browser = useMemo(() => readBrowserInfo(), [])
  const res = scene.stats.resources
  const frames = scene.frames.length * scene.stats.registeredCameras
  const detMs = stageMs(scene, 'object_detection')
  const geometryMs = ['preprocessing', 'feature_extraction', 'feature_matching', 'pose_estimation', 'depth_estimation', 'reconstruction']
    .map((id) => stageMs(scene, id) ?? 0)
    .reduce((a, b) => a + b, 0)
  const perTimestepMs = scene.frames.length && detMs !== null ? (detMs + (stageMs(scene, 'tracking') ?? 0)) / scene.frames.length : null
  const ba = scene.stats.bundleAdjustment
  const ev = scene.evaluation

  return (
    <div className={s.page}>
      <PageHeader
        title="Analysis"
        description="Timing, accuracy and resource figures recorded by the pipeline for this reconstruction."
      />
      {scene.source === 'demo' && (
        <Note tone="sample">
          Figures were recorded when the demo dataset was built on a CPU-only machine. They describe that run, not your browser.
        </Note>
      )}

      <div className={s.stats}>
        <Stat label="Cameras" value={`${scene.stats.registeredCameras}/${scene.cameras.length}`} note="registered" />
        <Stat label="Reconstructed points" value={fmtInt(scene.pointCloud.count)} />
        <Stat label="Tracked objects" value={scene.tracks.length} />
        <Stat label="Reconstruction time" value={fmtDuration(geometryMs)} note="stages 2–8" />
        <Stat label="Detection time" value={fmtDuration(detMs)} note={frames ? `${frames} camera frames` : undefined} />
        <Stat
          label="Throughput"
          value={detMs && frames ? `${fmtNumber(frames / (detMs / 1000), 1)} FPS` : '—'}
          note="camera frames/s in detection"
        />
        <Stat label="Latency per timestep" value={fmtDuration(perTimestepMs)} note="detection + tracking" />
        <Stat label="Total wall time" value={res ? `${fmtNumber(res.wallTimeS, 1)} s` : '—'} />
      </div>

      <div className={s.grid2}>
        <Panel title="Time per stage" subtitle="skipped stages shown in grey">
          <Suspense fallback={<LoadingState label="Loading chart…" />}>
            <StageTimingChart scene={scene} />
          </Suspense>
        </Panel>
        <Panel title="Reprojection error" subtitle="per sparse point after bundle adjustment">
          {scene.stats.reprojErrorHistogram.length ? (
            <Suspense fallback={<LoadingState label="Loading chart…" />}>
              <ReprojectionHistogram scene={scene} />
            </Suspense>
          ) : (
            <p className="faint">Not available.</p>
          )}
          <p className="faint" style={{ marginTop: 6 }}>
            Mean over cameras: {fmtNumber(scene.stats.meanReprojErrorPx, 3)} px. Points above 3 px are removed during reconstruction.
          </p>
        </Panel>
      </div>

      <div className={s.grid3}>
        <Panel title="Server resources" subtitle="whole pipeline">
          <KeyValue
            items={[
              ['CPU time', res ? `${fmtNumber(res.cpuTimeS, 1)} s` : '—'],
              ['CPU utilisation', res && res.wallTimeS ? fmtPercent(res.cpuTimeS / res.wallTimeS, 0) + ' of one core (avg.)' : '—'],
              ['Peak memory', res ? `${fmtNumber(res.peakMemoryMb, 0)} MB` : '—'],
              ['GPU', res?.gpu ?? 'Not used: all stages run on the CPU (OpenCV, NumPy)'],
            ]}
          />
          <p className="faint" style={{ marginTop: 8, fontSize: 'var(--fs-xs)' }}>
            Peak memory is the resident-set high-water mark of the worker process, so it can include earlier runs.
          </p>
        </Panel>
        <Panel title="Bundle adjustment" flush>
          <table className={uiStyles.table}>
            <thead>
              <tr>
                <th>#</th>
                <th className={uiStyles.right}>Obs.</th>
                <th className={uiStyles.right}>RMS before</th>
                <th className={uiStyles.right}>after</th>
              </tr>
            </thead>
            <tbody>
              {ba.map((b, i) => (
                <tr key={i}>
                  <td className="num">{i + 1}</td>
                  <td className={`${uiStyles.right} num`}>{fmtInt(b.observations)}</td>
                  <td className={`${uiStyles.right} num`}>{fmtNumber(b.initialRmsPx, 3)}</td>
                  <td className={`${uiStyles.right} num`}>{fmtNumber(b.finalRmsPx, 3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel title="This browser">
          <KeyValue
            items={[
              ['GPU (WebGL)', browser.renderer ?? <span className="faint">not exposed by the browser</span>],
              ['Pixel ratio', fmtNumber(browser.dpr, 2)],
              ['CPU threads', browser.cores ?? '—'],
              ['JS heap', browser.heapMb !== null ? `${fmtNumber(browser.heapMb, 0)} MB` : <span className="faint">not exposed</span>],
            ]}
          />
        </Panel>
      </div>

      {ev && (
        <Panel title="Accuracy against synthetic ground truth" subtitle="demo only">
          <p className="muted" style={{ marginBottom: 10 }}>
            {ev.note}
          </p>
          <div className={s.grid3}>
            <div>
              <p className="faint" style={{ marginBottom: 4 }}>
                Camera pose error
              </p>
              <table className={uiStyles.table}>
                <thead>
                  <tr>
                    <th>Camera</th>
                    <th className={uiStyles.right}>Position</th>
                    <th className={uiStyles.right}>Rotation</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(ev.cameraPositionErrorM).map(([id, e]) => (
                    <tr key={id}>
                      <td className="mono">{cameraLabel(scene, id)}</td>
                      <td className={`${uiStyles.right} num`}>{fmtNumber(e * 1000, 1)} mm</td>
                      <td className={`${uiStyles.right} num`}>{fmtNumber(ev.cameraRotationErrorDeg[id], 3)}°</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <p className="faint" style={{ marginBottom: 4 }}>
                Dense depth error
              </p>
              <table className={uiStyles.table}>
                <thead>
                  <tr>
                    <th>Camera</th>
                    <th className={uiStyles.right}>Median rel.</th>
                    <th className={uiStyles.right}>Within 5%</th>
                  </tr>
                </thead>
                <tbody>
                  {ev.depth.map((d) => (
                    <tr key={d.camera}>
                      <td className="mono">{cameraLabel(scene, d.camera)}</td>
                      <td className={`${uiStyles.right} num`}>{fmtPercent(d.medianRelError, 2)}</td>
                      <td className={`${uiStyles.right} num`}>{fmtPercent(d.within5Percent, 1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <p className="faint" style={{ marginBottom: 4 }}>
                Object localisation (ground plane)
              </p>
              {ev.objectCenterErrorM ? (
                <KeyValue
                  items={[
                    ['Mean error', `${fmtNumber(ev.objectCenterErrorM.mean, 2)} m`],
                    ['Median error', `${fmtNumber(ev.objectCenterErrorM.median, 2)} m`],
                    ['Objects compared', ev.objectCenterErrorM.count],
                  ]}
                />
              ) : (
                <p className="faint">No objects.</p>
              )}
              <p className="faint" style={{ marginTop: 6, fontSize: 'var(--fs-xs)' }}>
                Box centres are triangulated from 2D box centres, which are biased towards the visible faces.
              </p>
            </div>
          </div>
        </Panel>
      )}
    </div>
  )
}
