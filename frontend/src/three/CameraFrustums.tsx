import type { ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { SceneCamera } from '@/types/scene'
import { cameraColor } from '@/utils/palette'
import { frustumSegments } from './sceneMath'

interface CameraFrustumsProps {
  cameras: SceneCamera[]
  depth: number
  selectedId: string | null
  onSelect?: (id: string) => void
}

function Frustum({ camera, index, depth, selected, onSelect }: {
  camera: SceneCamera
  index: number
  depth: number
  selected: boolean
  onSelect?: (id: string) => void
}) {
  const pose = camera.pose!
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(frustumSegments(pose, camera.intrinsics, depth), 3))
    return g
  }, [pose, camera.intrinsics, depth])
  useEffect(() => () => geometry.dispose(), [geometry])

  const color = selected ? '#ffffff' : cameraColor(index)
  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    if (!onSelect) return // let the event reach the measurement handler
    e.stopPropagation()
    onSelect(camera.id)
  }
  return (
    <group name={`camera-${camera.label}`}>
      <lineSegments geometry={geometry}>
        <lineBasicMaterial color={color} transparent opacity={selected ? 1 : 0.85} />
      </lineSegments>
      <mesh position={pose.position} onClick={handleClick}>
        <sphereGeometry args={[depth * 0.09, 12, 8]} />
        <meshBasicMaterial color={color} />
      </mesh>
    </group>
  )
}

export function CameraFrustums({ cameras, depth, selectedId, onSelect }: CameraFrustumsProps) {
  return (
    <group name="cameras">
      {cameras.map((c, i) =>
        c.pose ? (
          <Frustum
            key={c.id}
            camera={c}
            index={i}
            depth={depth}
            selected={c.id === selectedId}
            onSelect={onSelect}
          />
        ) : null,
      )}
    </group>
  )
}
