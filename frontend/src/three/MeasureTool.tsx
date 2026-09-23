import { Line } from '@react-three/drei'
import type { Vec3 } from '@/types/scene'

export function MeasureMarkers({ points, markerSize }: { points: Vec3[]; markerSize: number }) {
  if (points.length === 0) return null
  return (
    <group name="measurement">
      {points.map((p, i) => (
        <mesh key={i} position={p} raycast={() => null}>
          <sphereGeometry args={[markerSize, 12, 8]} />
          <meshBasicMaterial color="#c8a45e" depthTest={false} />
        </mesh>
      ))}
      {points.length === 2 && <Line points={points} color="#c8a45e" lineWidth={2} depthTest={false} />}
    </group>
  )
}
