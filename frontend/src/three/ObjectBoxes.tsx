import type { ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { SceneObject } from '@/types/scene'
import { classColor } from '@/utils/palette'

const unitBoxEdges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1))
const unitBox = new THREE.BoxGeometry(1, 1, 1)

interface ObjectBoxesProps {
  objects: SceneObject[]
  selectedId: string | null
  onSelect?: (id: string) => void
}

function ObjectBox({ object, selected, onSelect }: {
  object: SceneObject
  selected: boolean
  onSelect?: (id: string) => void
}) {
  const color = selected ? '#ffffff' : classColor(object.class)
  const edgeMaterial = useMemo(() => new THREE.LineBasicMaterial({ color }), [color])
  const fillMaterial = useMemo(
    () => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: selected ? 0.18 : 0.06, depthWrite: false }),
    [color, selected],
  )
  useEffect(() => () => edgeMaterial.dispose(), [edgeMaterial])
  useEffect(() => () => fillMaterial.dispose(), [fillMaterial])

  const [w, h, l] = object.size
  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    if (!onSelect) return // let the event reach the measurement handler
    e.stopPropagation()
    onSelect(object.id)
  }
  return (
    <group position={object.center} rotation={[0, object.yaw, 0]} name={`object-${object.id}`}>
      <lineSegments geometry={unitBoxEdges} material={edgeMaterial} scale={[w, h, l]} />
      <mesh
        geometry={unitBox}
        material={fillMaterial}
        scale={[w, h, l]}
        onClick={handleClick}
        onPointerOver={(e) => {
          if (!onSelect) return
          e.stopPropagation()
          document.body.style.cursor = 'pointer'
        }}
        onPointerOut={() => {
          document.body.style.cursor = ''
        }}
      />
    </group>
  )
}

export function ObjectBoxes({ objects, selectedId, onSelect }: ObjectBoxesProps) {
  useEffect(() => () => void (document.body.style.cursor = ''), [])
  return (
    <group name="objects">
      {objects.map((o) => (
        <ObjectBox key={o.id} object={o} selected={o.id === selectedId} onSelect={onSelect} />
      ))}
    </group>
  )
}
