import { useEffect, useMemo, useState } from 'react'
import { DataSourceBadge } from '@/components/DataSourceBadge'
import { Button } from '@/components/ui/Button'
import { Checkbox, Range, Select } from '@/components/ui/Form'
import { Panel } from '@/components/ui/Panel'
import { ProgressBar } from '@/components/ui/Progress'
import { ErrorNotice, ErrorState, LoadingState } from '@/components/ui/States'
import uiStyles from '@/components/ui/ui.module.css'
import { useWorkspace } from '@/context/WorkspaceContext'
import { useAsync } from '@/hooks/useAsync'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { api } from '@/services/api'
import { toApiError } from '@/services/apiClient'
import type { MatchData } from '@/services/sceneSource'
import type { FeatureDetector } from '@/types/project'
import type { SceneCamera, SceneDocument } from '@/types/scene'
import { fmtDuration, fmtInt, fmtPercent } from '@/utils/format'
import s from '../page.module.css'
import { sceneCameraFromApi } from '../cameras/model'
import { Note, PageHeader, SceneGate, Stat } from '../shared'
import { MatchCanvas } from './MatchCanvas'

const API_RATIOS = [0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9]
interface MatchRequestParams {
  a: string
  b: string
  detector: FeatureDetector
  ratio: number
}

const DETECTORS: { value: FeatureDetector; label: string }[] = [
  { value: 'sift', label: 'SIFT (float, scale-invariant)' },
  { value: 'orb', label: 'ORB (binary, fast)' },
  { value: 'akaze', label: 'AKAZE (binary, nonlinear scale)' },
]

export default function MatchingPage() {
  const { isDemo, projectId, scene } = useWorkspace()
  const sceneData = scene.state.data ?? null
  // Matching only needs frames, so projects can use it before the first pipeline run.
  const apiCams = useAsync(
    (signal) => (isDemo || sceneData ? Promise.resolve([]) : api.listCameras(projectId, signal)),
    [isDemo, projectId, sceneData],
  )
  if (sceneData) return <Matching scene={sceneData} cameras={sceneData.cameras} />
  if (isDemo) return <SceneGate>{(sc) => <Matching scene={sc} cameras={sc.cameras} />}</SceneGate>
  if (scene.state.status === 'loading' || apiCams.state.status === 'loading') return <LoadingState label="Loading cameras…" />
  if (apiCams.state.status === 'error') return <ErrorState error={apiCams.state.error} onRetry={apiCams.reload} />
  return <Matching scene={null} cameras={apiCams.state.data.map(sceneCameraFromApi)} />
}

function Matching({ scene, cameras }: { scene: SceneDocument | null; cameras: SceneCamera[] }) {
  const { source, isDemo } = useWorkspace()
  const cams = cameras.filter((c) => c.frameCount > 0)
  const [a, setA] = useState(cams[0]?.id ?? '')
  const [b, setB] = useState(cams[1]?.id ?? '')
  const [detector, setDetector] = useState<FeatureDetector>((scene?.matching.detector as FeatureDetector) ?? 'sift')
  const ratios = source.matchRatios ?? API_RATIOS
  const [ratio, setRatio] = useState(scene && ratios.includes(scene.matching.ratio) ? scene.matching.ratio : 0.75)
  const [showOutliers, setShowOutliers] = useState(false)
  const [maxLines, setMaxLines] = useState(200)
  const [data, setData] = useState<MatchData | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [error, setError] = useState<unknown>(null)
  const narrow = useMediaQuery('(max-width: 720px)')

  const camA = cams.find((c) => c.id === a)
  const camB = cams.find((c) => c.id === b)
  // Precomputed (demo) matches load as parameters change; live matching runs on request.
  const autoLoad = source.kind === 'demo'
  const [request, setRequest] = useState<MatchRequestParams | null>(null)
  useEffect(() => {
    if (autoLoad) setRequest({ a, b, detector, ratio })
  }, [autoLoad, a, b, detector, ratio])
  const runNow = () => setRequest({ a, b, detector, ratio })
  const retry = () => setRequest((r) => (r ? { ...r } : r))

  useEffect(() => {
    if (!request || request.a === request.b) return
    const controller = new AbortController()
    setStatus('loading')
    setError(null)
    source.loadMatches(scene, request.a, request.b, request.detector, request.ratio, controller.signal).then(
      (d) => {
        if (controller.signal.aborted) return
        setData(d)
        setStatus('idle')
      },
      (err: unknown) => {
        if (controller.signal.aborted || toApiError(err).kind === 'aborted') return
        setError(err)
        setStatus('error')
        setData(null)
      },
    )
    return () => controller.abort()
  }, [request, source, scene])

  const pairRows = useMemo(() => scene?.matching.pairs ?? [], [scene])
  const inlierRatio = data && data.tentative ? data.inliers / data.tentative : null
  const totalMs = data ? data.timings.detectA + data.timings.detectB + data.timings.match : null

  if (cams.length < 2) {
    return (
      <div className={s.page}>
        <PageHeader title="Feature Matching" />
        <ErrorNotice tone="warn" error={new Error('Feature matching needs two cameras with frames.')} />
      </div>
    )
  }

  const camOptions = cams.map((c) => ({ value: c.id, label: c.label }))
  return (
    <div className={s.page}>
      <PageHeader
        title="Feature Matching"
        description="Keypoints are matched with Lowe’s ratio test and a mutual-nearest-neighbour check, then verified against a fundamental matrix with RANSAC (MAGSAC++)."
        actions={scene && <DataSourceBadge scene={scene} layer="reconstruction" />}
      />
      {isDemo && (
        <Note tone="sample">
          Matches for every pair, detector and ratio were computed from the demo renders when the dataset was built. Only the
          listed ratio values are available offline.
        </Note>
      )}

      <div className={s.split}>
        <Panel
          title={camA && camB ? `${camA.label} ↔ ${camB.label}` : 'Select two cameras'}
          subtitle={data ? `${data.detector.toUpperCase()}, ratio < ${data.ratio}` : undefined}
          actions={
            <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
              <span style={{ color: 'var(--accent)' }}>■</span> inlier
              {showOutliers && (
                <>
                  {' '}
                  <span style={{ color: 'var(--err)' }}>■</span> rejected by RANSAC
                </>
              )}
            </span>
          }
        >
          {camA && camB && (
            <MatchCanvas
              camA={camA}
              camB={camB}
              srcA={source.frameUrl(camA, 0)}
              srcB={source.frameUrl(camB, 0)}
              data={data}
              showOutliers={showOutliers}
              maxLines={maxLines}
              layout={narrow ? 'column' : 'row'}
            />
          )}
          {status === 'loading' && (
            <div style={{ marginTop: 8 }}>
              <ProgressBar label="Matching" />
              <p className="muted" style={{ marginTop: 4 }}>
                {autoLoad ? 'Loading precomputed matches…' : 'Extracting features and matching on the server…'}
              </p>
            </div>
          )}
          {status === 'error' && (
            <div style={{ marginTop: 8 }}>
              <ErrorNotice error={error} title="Matching failed" onRetry={retry} />
            </div>
          )}
          {!autoLoad && !data && status === 'idle' && (
            <p className="muted" style={{ marginTop: 8 }}>
              Choose parameters and run matching. Features are computed on the server from frame 0.
            </p>
          )}
        </Panel>

        <div className={s.sideStack}>
          <Panel title="Parameters">
            <div className={s.controlsStack}>
              <Select label="Camera A" value={a} options={camOptions.map((o) => ({ ...o, disabled: o.value === b }))} onChange={setA} />
              <Select label="Camera B" value={b} options={camOptions.map((o) => ({ ...o, disabled: o.value === a }))} onChange={setB} />
              <Select label="Feature detector" value={detector} options={DETECTORS} onChange={(v) => setDetector(v as FeatureDetector)} />
              <Select
                label="Matching threshold (Lowe ratio)"
                help="Lower keeps fewer, more distinctive matches."
                value={String(ratio)}
                options={ratios.map((r) => ({ value: String(r), label: r.toFixed(2) }))}
                onChange={(v) => setRatio(Number(v))}
              />
              {!autoLoad && (
                <Button variant="primary" icon="play" loading={status === 'loading'} disabled={a === b} onClick={runNow}>
                  Run matching
                </Button>
              )}
              <Checkbox label="Show rejected matches" checked={showOutliers} onChange={setShowOutliers} />
              <Range label="Lines drawn (max)" value={maxLines} min={25} max={1000} step={25} onChange={setMaxLines} />
            </div>
          </Panel>
          <div className={s.stats}>
            <Stat label={`Features ${camA?.label ?? 'A'}`} value={fmtInt(data?.featuresA)} />
            <Stat label={`Features ${camB?.label ?? 'B'}`} value={fmtInt(data?.featuresB)} />
            <Stat label="Tentative matches" value={fmtInt(data?.tentative)} />
            <Stat label="RANSAC inliers" value={fmtInt(data?.inliers)} />
            <Stat label="Inlier ratio" value={fmtPercent(inlierRatio)} note="geometric confidence" />
            <Stat label="Processing time" value={fmtDuration(totalMs)} note={data?.origin === 'precomputed' ? 'recorded at build' : undefined} />
          </div>
        </div>
      </div>

      {scene && pairRows.length > 0 && (
      <Panel title="All camera pairs" subtitle={`from the last pipeline run (${scene.matching.detector.toUpperCase()}, ratio ${scene.matching.ratio})`} flush>
        <div className={uiStyles.tableScroll}>
          <table className={uiStyles.table}>
            <thead>
              <tr>
                <th>Pair</th>
                <th className={uiStyles.right}>Tentative</th>
                <th className={uiStyles.right}>Inliers</th>
                <th className={uiStyles.right}>Inlier ratio</th>
              </tr>
            </thead>
            <tbody>
              {pairRows.map((p) => {
                const ids = [cams.find((c) => c.label === p.a)?.id, cams.find((c) => c.label === p.b)?.id]
                const selected = (ids[0] === a && ids[1] === b) || (ids[0] === b && ids[1] === a)
                return (
                  <tr
                    key={`${p.a}-${p.b}`}
                    data-clickable="true"
                    data-selected={selected}
                    tabIndex={0}
                    onClick={() => ids[0] && ids[1] && (setA(ids[0]), setB(ids[1]))}
                    onKeyDown={(e) => e.key === 'Enter' && ids[0] && ids[1] && (setA(ids[0]), setB(ids[1]))}
                  >
                    <td className="mono">
                      {p.a} ↔ {p.b}
                    </td>
                    <td className={`${uiStyles.right} num`}>{fmtInt(p.tentative)}</td>
                    <td className={`${uiStyles.right} num`}>{fmtInt(p.inliers)}</td>
                    <td className={`${uiStyles.right} num`}>{fmtPercent(p.tentative ? p.inliers / p.tentative : null)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Panel>
      )}
    </div>
  )
}
