import { Line } from '@react-three/drei'
import type { Track } from '@/types/scene'
import { classColor } from '@/utils/palette'

interface TrajectoriesProps {
  tracks: Track[]
  selectedTrackId: number | null
  /** Only draw states up to this time (inclusive); undefined draws the full track. */
  untilT?: number
}

export function Trajectories({ tracks, selectedTrackId, untilT }: TrajectoriesProps) {
  return (
    <group name="trajectories">
      {tracks.map((tr) => {
        const states = untilT === undefined ? tr.states : tr.states.filter((s) => s.t <= untilT + 1e-6)
        if (states.length < 2) return null
        // Lift slightly above the ground so the line is not z-fighting with dense points.
        const pts = states.map((s) => [s.position[0], 0.05, s.position[2]] as [number, number, number])
        const selected = tr.id === selectedTrackId
        return (
          <Line
            key={tr.id}
            points={pts}
            color={selected ? '#ffffff' : classColor(tr.class)}
            lineWidth={selected ? 3 : 1.5}
            transparent
            opacity={selectedTrackId === null || selected ? 0.95 : 0.35}
          />
        )
      })}
    </group>
  )
}
