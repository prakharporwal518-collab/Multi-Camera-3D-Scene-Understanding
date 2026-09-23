import { GizmoHelper, GizmoViewport, OrbitControls, OrthographicCamera, PerspectiveCamera } from '@react-three/drei'
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { ErrorNotice } from '@/components/ui/States'
import type { PointCloudData } from '@/services/pointCloud'
import type { SceneDocument, SceneObject, Track, Vec3 } from '@/types/scene'
import { CameraFrustums } from './CameraFrustums'
import { LabelOverlay, LabelProjector, type LabelSpec } from './Labels'
import { MeasureMarkers } from './MeasureTool'
import { ObjectBoxes } from './ObjectBoxes'
import { PointCloudLayer } from './PointCloudLayer'
import { Regions } from './Regions'
import { gridSpec, measureMidpoint, regionCentroid, sceneBounds } from './sceneMath'
import { Trajectories } from './Trajectories'
import type { OrbitControlsHandle, Projection, ViewerOptions, ViewRequest } from './types'
import { ViewController } from './ViewController'
import s from './viewer.module.css'

export interface SceneViewportProps {
  scene: SceneDocument
  cloud: PointCloudData | null
  options: ViewerOptions
  projection: Projection
  view: ViewRequest
  objects?: SceneObject[]
  tracks?: Track[]
  trackTime?: number
  selectedObjectId?: string | null
  selectedCameraId?: string | null
  selectedTrackId?: number | null
  onSelectObject?: (id: string | null) => void
  onSelectCamera?: (id: string | null) => void
  measuring?: boolean
  measurePoints?: Vec3[]
  measureLabel?: string | null
  onMeasurePoint?: (p: Vec3) => void
  ariaLabel: string
}

/**
 * Interactive WebGL scene. Rendering is on demand (frameloop="demand"): the GPU is idle
 * unless the view changes, which keeps laptops cool with large point clouds on screen.
 */
function buildLabels(p: SceneViewportProps): LabelSpec[] {
  if (!p.options.showLabels) {
    const mid = measureMidpoint(p.measurePoints ?? [])
    return mid && p.measureLabel ? [{ id: 'measure', position: mid, text: p.measureLabel, variant: 'measure' }] : []
  }
  const labels: LabelSpec[] = []
  if (p.options.showCameras) {
    for (const c of p.scene.cameras) {
      if (!c.pose) continue
      labels.push({ id: `cam:${c.id}`, position: c.pose.position, text: c.label, variant: c.id === p.selectedCameraId ? 'selected' : 'default' })
    }
  }
  if (p.options.showBoxes) {
    for (const o of p.objects ?? []) {
      const text = `${o.trackId !== null ? `#${o.trackId} ` : ''}${o.class} ${Math.round(o.confidence * 100)}%`
      labels.push({
        id: `obj:${o.id}`,
        position: [o.center[0], o.center[1] + o.size[1] / 2, o.center[2]],
        text,
        variant: o.id === p.selectedObjectId ? 'selected' : 'default',
      })
    }
  }
  if (p.options.showRegions) {
    for (const r of p.scene.regions) labels.push({ id: `reg:${r.id}`, position: regionCentroid(r), text: r.name })
  }
  const mid = measureMidpoint(p.measurePoints ?? [])
  if (mid && p.measureLabel) labels.push({ id: 'measure', position: mid, text: p.measureLabel, variant: 'measure' })
  return labels
}

export default function SceneViewport(props: SceneViewportProps) {
  const [contextLost, setContextLost] = useState(false)
  const [canvasKey, setCanvasKey] = useState(0)
  const labelRefs = useRef(new Map<string, HTMLDivElement>())
  const { options, scene, objects, selectedObjectId, selectedCameraId, measurePoints, measureLabel } = props
  const labels = useMemo(
    () => buildLabels(props),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [options, scene, objects, selectedObjectId, selectedCameraId, measurePoints, measureLabel],
  )
  return (
    <div className={s.root} role="img" aria-label={props.ariaLabel}>
      <Canvas
        key={canvasKey}
        className={s.canvas}
        frameloop="demand"
        dpr={[1, 2]}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        onCreated={({ gl }) => {
          gl.setClearColor('#111315')
          gl.domElement.addEventListener('webglcontextlost', (e) => {
            e.preventDefault()
            setContextLost(true)
          })
        }}
        onPointerMissed={() => {
          if (!props.measuring) {
            props.onSelectObject?.(null)
          }
        }}
      >
        <SceneContent {...props} />
        <LabelProjector labels={labels} refs={labelRefs} />
      </Canvas>
      <LabelOverlay labels={labels} refs={labelRefs} />
      {contextLost && (
        <div className={s.lost}>
          <ErrorNotice
            error={new Error('The 3D view lost its graphics context.')}
            title="The 3D view lost its graphics context"
            actions={
              <Button
                size="sm"
                icon="refresh"
                onClick={() => {
                  setContextLost(false)
                  setCanvasKey((k) => k + 1)
                }}
              >
                Restart view
              </Button>
            }
          />
        </div>
      )}
    </div>
  )
}

function SceneContent({
  scene,
  cloud,
  options,
  projection,
  view,
  objects = [],
  tracks = [],
  trackTime,
  selectedObjectId = null,
  selectedCameraId = null,
  selectedTrackId = null,
  onSelectObject,
  onSelectCamera,
  measuring = false,
  measurePoints = [],
  onMeasurePoint,
}: SceneViewportProps) {
  const controls = useRef<OrbitControlsHandle | null>(null)
  const bounds = useMemo(() => sceneBounds(scene), [scene])
  const grid = useMemo(() => gridSpec(bounds, scene.units), [bounds, scene.units])
  const frustumDepth = bounds.radius * 0.07
  const raycaster = useThree((st) => st.raycaster)
  useEffect(() => {
    // Point picking tolerance in world units, relative to the scene size.
    raycaster.params.Points = { threshold: bounds.radius * 0.004 }
  }, [raycaster, bounds])

  const handleMeasureClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      if (!measuring || !onMeasurePoint) return
      e.stopPropagation()
      onMeasurePoint([e.point.x, e.point.y, e.point.z])
    },
    [measuring, onMeasurePoint],
  )

  const selectObject = measuring ? undefined : (id: string) => onSelectObject?.(id)
  const selectCamera = measuring ? undefined : (id: string) => onSelectCamera?.(id)

  return (
    <>
      {projection === 'perspective' ? (
        <PerspectiveCamera makeDefault fov={50} near={bounds.radius / 500} far={bounds.radius * 50} />
      ) : (
        <OrthographicCamera makeDefault near={-bounds.radius * 50} far={bounds.radius * 50} />
      )}
      <OrbitControls
        key={projection}
        ref={controls}
        makeDefault
        enableDamping={false}
        screenSpacePanning
        maxDistance={bounds.radius * 20}
      />
      <ViewController scene={scene} bounds={bounds} request={view} projection={projection} controls={controls} />
      <ambientLight intensity={1} />

      <group onClick={handleMeasureClick}>
        {cloud && (
          <PointCloudLayer
            cloud={cloud}
            showDense={options.showDense}
            showSparse={options.showSparse}
            pointSize={options.pointSize}
            density={options.density}
            colorMode={options.colorMode}
            pickable={measuring}
          />
        )}
        {options.showBoxes && (
          <ObjectBoxes objects={objects} selectedId={selectedObjectId} onSelect={selectObject} />
        )}
        {/* invisible ground plane so measurements can start on open floor */}
        {measuring && (
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[bounds.center[0], 0, bounds.center[2]]}>
            <planeGeometry args={[grid.size * 2, grid.size * 2]} />
            <meshBasicMaterial visible={false} />
          </mesh>
        )}
      </group>

      {options.showCameras && (
        <CameraFrustums
          cameras={scene.cameras}
          depth={frustumDepth}
          selectedId={selectedCameraId}
          onSelect={selectCamera}
        />
      )}
      {options.showTrajectories && tracks.length > 0 && (
        <Trajectories tracks={tracks} selectedTrackId={selectedTrackId} untilT={trackTime} />
      )}
      {options.showRegions && scene.regions.length > 0 && <Regions regions={scene.regions} />}
      {options.showGrid && (
        <gridHelper
          args={[grid.size, grid.divisions, '#3a4048', '#262a2f']}
          position={[bounds.center[0], scene.groundAligned ? 0 : bounds.min[1], bounds.center[2]]}
          raycast={() => null}
        />
      )}
      {options.showAxes && <axesHelper args={[scene.units === 'm' ? 1 : bounds.radius * 0.1]} raycast={() => null} />}
      <MeasureMarkers points={measurePoints} markerSize={bounds.radius * 0.006} />

      <GizmoHelper alignment="bottom-right" margin={[56, 56]}>
        <GizmoViewport axisColors={['#e2635c', '#5bb57d', '#6aa5f0']} labelColor="#15171a" />
      </GizmoHelper>
    </>
  )
}
