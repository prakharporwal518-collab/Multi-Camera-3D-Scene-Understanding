import { useEffect, useMemo, useState } from 'react'
import { DataSourceBadge } from '@/components/DataSourceBadge'
import { Checkbox, Select } from '@/components/ui/Form'
import { KeyValue } from '@/components/ui/KeyValue'
import { Panel } from '@/components/ui/Panel'
import { Segmented } from '@/components/ui/Segmented'
import { EmptyState, ErrorNotice, LoadingState } from '@/components/ui/States'
import { Viewport3D } from '@/components/Viewport3D'
import { useWorkspace } from '@/context/WorkspaceContext'
import { loadDepthMap, type DepthLoadResult } from '@/services/depthLoader'
import type { PointCloudData } from '@/services/pointCloud'
import { DEFAULT_VIEWER_OPTIONS, type ViewRequest } from '@/three/types'
import type { DepthMapInfo, SceneDocument } from '@/types/scene'
import { fmtInt, fmtNumber, fmtPercent, unitLabel } from '@/utils/format'
import s from '../page.module.css'
import { Note, PageHeader, SceneGate, Stat } from '../shared'
import { ColorScale, DepthCanvas, type DepthView } from './DepthCanvas'

type Mode = DepthView | 'cloud'

export default function DepthPage() {
  return <SceneGate what="depth estimate">{(scene) => <Depth scene={scene} />}</SceneGate>
}

function percentile(values: Float32Array, p: number): number {
  const valid: number[] = []
  for (let i = 0; i < values.length; i += 7) if (values[i] > 0) valid.push(values[i])
  if (!valid.length) return 0
  valid.sort((a, b) => a - b)
  return valid[Math.min(valid.length - 1, Math.floor((p / 100) * valid.length))]
}

function Depth({ scene }: { scene: SceneDocument }) {
  const { source } = useWorkspace()
  const maps = scene.depthMaps
  const [cameraId, setCameraId] = useState(maps[0]?.cameraId ?? '')
  const [mode, setMode] = useState<Mode>('depth')
  const [clip, setClip] = useState(true)
  const [result, setResult] = useState<{ id: string; data: DepthLoadResult } | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [attempt, setAttempt] = useState(0)

  const info: DepthMapInfo | undefined = maps.find((m) => m.cameraId === cameraId)
  const camera = scene.cameras.find((c) => c.id === cameraId)
  const unit = unitLabel(scene)

  useEffect(() => {
    if (!info || !camera) return
    let alive = true
    setError(null)
    loadDepthMap({
      depthUrl: source.resultUrl(info.url),
      rgbUrl: source.frameUrl(camera, 0),
      width: info.width,
      height: info.height,
      step: info.encoding.step,
      intrinsics: camera.intrinsics,
      pose: camera.pose,
    }).then(
      (data) => alive && setResult({ id: info.cameraId, data }),
      (err: unknown) => alive && setError(err),
    )
    return () => {
      alive = false
    }
  }, [info, camera, source, attempt])

  const current = result && result.id === cameraId ? result.data : null
  const range = useMemo<[number, number]>(() => {
    if (!current || !info) return [0, 1]
    if (!clip) return [info.min ?? 0, info.max ?? 1]
    return [percentile(current.decoded.depth, 2), percentile(current.decoded.depth, 98)]
  }, [current, info, clip])

  const meanConfidence = useMemo(() => {
    if (!current) return null
    let sum = 0
    let n = 0
    const { confidence, depth } = current.decoded
    for (let i = 0; i < depth.length; i++) {
      if (depth[i] > 0) {
        sum += confidence[i]
        n++
      }
    }
    return n ? sum / n : null
  }, [current])

  const cloud: PointCloudData | null = useMemo(() => {
    if (!current?.cloud) return null
    const n = current.cloud.count
    return { count: n, positions: current.cloud.positions, colors: current.cloud.colors, layers: new Uint8Array(n).fill(1) }
  }, [current])
  const view = useMemo<ViewRequest>(() => ({ kind: 'camera', cameraId, nonce: 1 }), [cameraId])

  if (maps.length === 0) {
    return (
      <div className={s.page}>
        <PageHeader title="Depth" />
        <Panel>
          <EmptyState icon="depth" title="No depth maps in this reconstruction">
            Dense depth needs registered cameras with a neighbouring view within 50°. See the Overview page for the depth stage
            message.
          </EmptyState>
        </Panel>
      </div>
    )
  }

  return (
    <div className={s.page}>
      <PageHeader
        title="Depth"
        description="Per-camera depth from plane-sweep multi-view stereo (ZNCC), kept only where at least one other camera’s depth agrees within 1%."
        actions={<DataSourceBadge scene={scene} layer="depth" />}
      />
      {scene.source === 'demo' && (
        <Note tone="sample">
          These depth maps were estimated by the pipeline from the synthetic renders, not taken from the renderer. The
          Analysis page compares them with the ground-truth depth.
        </Note>
      )}
      <div className={s.split}>
        <Panel
          title={camera ? `${camera.label} · ${mode === 'cloud' ? 'point cloud' : mode}` : 'Depth'}
          subtitle={info ? `${info.width} × ${info.height} px` : undefined}
          actions={
            <Segmented<Mode>
              label="Display"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'rgb', label: 'RGB' },
                { value: 'depth', label: 'Depth' },
                { value: 'confidence', label: 'Confidence' },
                { value: 'cloud', label: 'Point Cloud' },
              ]}
            />
          }
        >
          {error !== null && <ErrorNotice error={error} title="Depth map could not be loaded" onRetry={() => setAttempt((a) => a + 1)} />}
          {!current && error === null && <LoadingState label="Decoding depth map…" />}
          {current && camera && mode !== 'cloud' && (
            <div className={s.controlsStack}>
              <DepthCanvas decoded={current.decoded} view={mode} rgbUrl={source.frameUrl(camera, 0)} range={range} unit={unit} label={camera.label} />
              {mode === 'depth' && <ColorScale min={range[0]} max={range[1]} unit={unit} label="near → far" />}
              {mode === 'confidence' && <ColorScale min={0} max={1} unit="" label="aggregated ZNCC confidence" />}
            </div>
          )}
          {current && mode === 'cloud' && (
            <div style={{ height: 460 }}>
              {cloud ? (
                <Viewport3D
                  scene={scene}
                  cloud={cloud}
                  options={{ ...DEFAULT_VIEWER_OPTIONS, showBoxes: false, showTrajectories: false, showLabels: true }}
                  projection="perspective"
                  view={view}
                  selectedCameraId={cameraId}
                  ariaLabel={`Point cloud back-projected from the ${camera?.label} depth map`}
                />
              ) : (
                <EmptyState compact title="Camera pose unavailable">
                  This camera was not registered, so its depth cannot be placed in the world frame.
                </EmptyState>
              )}
            </div>
          )}
        </Panel>

        <div className={s.sideStack}>
          <Panel title="Camera">
            <div className={s.controlsStack}>
              <Select
                label="Depth map"
                value={cameraId}
                onChange={setCameraId}
                options={maps.map((m) => ({ value: m.cameraId, label: scene.cameras.find((c) => c.id === m.cameraId)?.label ?? m.cameraId }))}
              />
              <Checkbox label="Clip colour range to 2–98th percentile" checked={clip} onChange={setClip} />
            </div>
          </Panel>
          {info && (
            <>
              <div className={s.stats}>
                <Stat label="Min depth" value={`${fmtNumber(info.min, 2)} ${unit}`} />
                <Stat label="Max depth" value={`${fmtNumber(info.max, 2)} ${unit}`} />
                <Stat label="Mean depth" value={`${fmtNumber(info.mean, 2)} ${unit}`} />
                <Stat label="Median depth" value={`${fmtNumber(info.median, 2)} ${unit}`} />
                <Stat label="Coverage" value={fmtPercent(info.coverage)} note="pixels with an estimate" />
                <Stat label="Mean confidence" value={fmtNumber(meanConfidence, 2)} note="0–1, ZNCC based" />
              </div>
              <Panel title="Method">
                <KeyValue
                  items={[
                    ['Algorithm', info.method],
                    ['Neighbour views', info.partners.join(', ') || '—'],
                    [
                      'Sparse agreement',
                      info.sparseAgreement !== null ? (
                        <span title="Median relative difference to triangulated SfM points visible in this camera">
                          {fmtPercent(info.sparseAgreement, 2)} median rel. diff
                        </span>
                      ) : (
                        '—'
                      ),
                    ],
                    ['Back-projected points', fmtInt(current?.cloud?.count)],
                  ]}
                />
              </Panel>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
