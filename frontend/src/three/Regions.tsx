import { Line } from '@react-three/drei'
import type { Region } from '@/types/scene'

export function Regions({ regions }: { regions: Region[] }) {
  return (
    <group name="regions">
      {regions.map((r) => {
        const pts = [...r.polygon, r.polygon[0]].map(([x, z]) => [x, 0.02, z] as [number, number, number])
        return <Line key={r.id} points={pts} color="#c8a45e" lineWidth={1} dashed dashSize={0.4} gapSize={0.3} transparent opacity={0.7} />
      })}
    </group>
  )
}
