import { useThree } from '@react-three/fiber'
import { useEffect, type RefObject } from 'react'
import * as THREE from 'three'
import type { SceneDocument } from '@/types/scene'
import { cameraForward } from '@/utils/geometry'
import { presetPlacement, type SceneBounds } from './sceneMath'
import type { OrbitControlsHandle, Projection, ViewRequest } from './types'

const DEFAULT_FOV = 50

interface ViewControllerProps {
  scene: SceneDocument
  bounds: SceneBounds
  request: ViewRequest
  projection: Projection
  controls: RefObject<OrbitControlsHandle | null>
}

/** Applies view presets / "look through camera" requests to the active viewer camera. */
export function ViewController({ scene, bounds, request, projection, controls }: ViewControllerProps) {
  const camera = useThree((st) => st.camera)
  const size = useThree((st) => st.size)
  const invalidate = useThree((st) => st.invalidate)

  useEffect(() => {
    const ctl = controls.current
    let position: [number, number, number]
    let target: [number, number, number]
    let fov = DEFAULT_FOV
    if (request.kind === 'camera') {
      const cam = scene.cameras.find((c) => c.id === request.cameraId)
      if (!cam?.pose) return
      const f = cameraForward(cam.pose)
      position = cam.pose.position
      target = [position[0] + f[0] * bounds.radius, position[1] + f[1] * bounds.radius, position[2] + f[2] * bounds.radius]
      fov = cam.fovY
    } else {
      ;({ position, target } = presetPlacement(request.preset, bounds))
    }
    camera.up.set(0, 1, 0)
    camera.position.set(...position)
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.fov = fov
      camera.near = bounds.radius / 500
      camera.far = bounds.radius * 50
    } else if (camera instanceof THREE.OrthographicCamera) {
      camera.zoom = size.height / (bounds.radius * 2.4)
      camera.near = -bounds.radius * 50
      camera.far = bounds.radius * 50
    }
    camera.updateProjectionMatrix()
    if (ctl) {
      ctl.target.set(...target)
      ctl.update()
    } else {
      camera.lookAt(...target)
    }
    invalidate()
    // Size is deliberately not a dependency: resizing must not reset the user's view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, projection, camera, bounds, scene, controls, invalidate])

  return null
}
