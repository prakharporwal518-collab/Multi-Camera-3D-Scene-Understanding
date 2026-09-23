import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { PointCloudData } from '@/services/pointCloud'
import { TURBO_LUT } from '@/utils/colormap'

export type ColorMode = 'rgb' | 'height'

interface PointCloudLayerProps {
  cloud: PointCloudData
  showSparse: boolean
  showDense: boolean
  pointSize: number
  density: number
  colorMode: ColorMode
  pickable?: boolean
}

interface LayerGeometry {
  geometry: THREE.BufferGeometry
  count: number
}

/** Split the interleaved-by-layer buffers into one geometry per layer (copied once). */
function buildLayer(cloud: PointCloudData, layer: number, colorMode: ColorMode): LayerGeometry {
  let count = 0
  for (let i = 0; i < cloud.count; i++) if (cloud.layers[i] === layer) count++
  const pos = new Float32Array(count * 3)
  const col = new Uint8Array(count * 3)
  let yMin = Infinity
  let yMax = -Infinity
  if (colorMode === 'height') {
    for (let i = 0; i < cloud.count; i++) {
      if (cloud.layers[i] !== layer) continue
      const y = cloud.positions[i * 3 + 1]
      if (y < yMin) yMin = y
      if (y > yMax) yMax = y
    }
  }
  const range = yMax - yMin || 1
  let n = 0
  for (let i = 0; i < cloud.count; i++) {
    if (cloud.layers[i] !== layer) continue
    pos[n * 3] = cloud.positions[i * 3]
    pos[n * 3 + 1] = cloud.positions[i * 3 + 1]
    pos[n * 3 + 2] = cloud.positions[i * 3 + 2]
    if (colorMode === 'height') {
      const k = Math.round(((cloud.positions[i * 3 + 1] - yMin) / range) * 255) * 3
      col[n * 3] = TURBO_LUT[k]
      col[n * 3 + 1] = TURBO_LUT[k + 1]
      col[n * 3 + 2] = TURBO_LUT[k + 2]
    } else {
      col[n * 3] = cloud.colors[i * 3]
      col[n * 3 + 1] = cloud.colors[i * 3 + 1]
      col[n * 3 + 2] = cloud.colors[i * 3 + 2]
    }
    n++
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(col, 3, true))
  geometry.computeBoundingSphere()
  return { geometry, count }
}

const noRaycast = () => null

export function PointCloudLayer({ cloud, showSparse, showDense, pointSize, density, colorMode, pickable = false }: PointCloudLayerProps) {
  const sparse = useMemo(() => buildLayer(cloud, 0, colorMode), [cloud, colorMode])
  const dense = useMemo(() => buildLayer(cloud, 1, colorMode), [cloud, colorMode])
  useEffect(() => () => sparse.geometry.dispose(), [sparse])
  useEffect(() => () => dense.geometry.dispose(), [dense])

  // Points were shuffled by the backend, so drawing a prefix is a uniform subsample.
  useEffect(() => {
    dense.geometry.setDrawRange(0, Math.max(1, Math.floor(dense.count * density)))
  }, [dense, density])

  const material = useMemo(
    () => new THREE.PointsMaterial({ size: pointSize, sizeAttenuation: false, vertexColors: true }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  useEffect(() => {
    material.size = pointSize
    material.needsUpdate = true
  }, [material, pointSize])
  useEffect(() => () => material.dispose(), [material])

  const sparseMaterial = useMemo(
    () => new THREE.PointsMaterial({ size: pointSize + 1.5, sizeAttenuation: false, vertexColors: true }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  useEffect(() => {
    sparseMaterial.size = pointSize + 1.5
  }, [sparseMaterial, pointSize])
  useEffect(() => () => sparseMaterial.dispose(), [sparseMaterial])

  return (
    <group name="point-cloud">
      {showDense && dense.count > 0 && (
        <points geometry={dense.geometry} material={material} raycast={pickable ? THREE.Points.prototype.raycast : noRaycast} />
      )}
      {showSparse && sparse.count > 0 && (
        <points geometry={sparse.geometry} material={sparseMaterial} raycast={pickable ? THREE.Points.prototype.raycast : noRaycast} />
      )}
    </group>
  )
}
