import type { SceneDocument } from '@/types/scene'
import { cameraForward } from '@/utils/geometry'
import { classColor } from '@/utils/palette'

interface TrajectoryPlotProps {
  scene: SceneDocument
  selectedTrackId: number | null
  currentT: number | null
  onSelect: (id: number) => void
}

function niceStep(span: number): number {
  const raw = span / 6
  const pow = 10 ** Math.floor(Math.log10(raw))
  return [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? pow * 10
}

/** Plan view (X–Z) of all tracks; X is drawn increasing to the left so the plot matches the camera views. */
export function TrajectoryPlot({ scene, selectedTrackId, currentT, onSelect }: TrajectoryPlotProps) {
  const pts = scene.tracks.flatMap((t) => t.states.map((s) => s.position))
  const cams = scene.cameras.filter((c) => c.pose)
  const xs = [...pts.map((p) => p[0]), ...cams.map((c) => c.pose!.position[0])]
  const zs = [...pts.map((p) => p[2]), ...cams.map((c) => c.pose!.position[2])]
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minZ = Math.min(...zs)
  const maxZ = Math.max(...zs)
  const span = Math.max(maxX - minX, maxZ - minZ, 1e-3) * 1.15
  const cx = (minX + maxX) / 2
  const cz = (minZ + maxZ) / 2
  const W = 560
  const H = 420
  const k = Math.min(W, H) / span
  const sx = (x: number) => W / 2 - (x - cx) * k
  const sz = (z: number) => H / 2 - (z - cz) * k
  const step = niceStep(span)
  const unit = scene.units === 'm' ? 'm' : 'u'
  const ticksX: number[] = []
  for (let x = Math.ceil((cx - W / 2 / k) / step) * step; x <= cx + W / 2 / k; x += step) ticksX.push(x)
  const ticksZ: number[] = []
  for (let z = Math.ceil((cz - H / 2 / k) / step) * step; z <= cz + H / 2 / k; z += step) ticksZ.push(z)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="group" aria-label="Plan view of object trajectories">
      <rect width={W} height={H} fill="#111315" />
      {ticksX.map((x) => (
        <g key={`x${x}`}>
          <line x1={sx(x)} x2={sx(x)} y1={0} y2={H} stroke="#23272c" />
          <text x={sx(x) + 3} y={H - 4} fill="#7c848e" fontSize={10} fontFamily="var(--font-mono)">
            x {+x.toFixed(2)}
          </text>
        </g>
      ))}
      {ticksZ.map((z) => (
        <g key={`z${z}`}>
          <line x1={0} x2={W} y1={sz(z)} y2={sz(z)} stroke="#23272c" />
          <text x={4} y={sz(z) - 3} fill="#7c848e" fontSize={10} fontFamily="var(--font-mono)">
            z {+z.toFixed(2)}
          </text>
        </g>
      ))}
      <text x={W - 6} y={14} textAnchor="end" fill="#7c848e" fontSize={10}>
        grid {step} {unit}
      </text>
      {scene.regions.map((r) => (
        <polygon
          key={r.id}
          points={r.polygon.map(([x, z]) => `${sx(x)},${sz(z)}`).join(' ')}
          fill="none"
          stroke="#c8a45e"
          strokeDasharray="4 4"
          strokeOpacity={0.5}
        />
      ))}
      {cams.map((c) => {
        const f = cameraForward(c.pose!)
        const len = Math.hypot(f[0], f[2]) || 1
        const x = sx(c.pose!.position[0])
        const z = sz(c.pose!.position[2])
        return (
          <g key={c.id}>
            <line x1={x} y1={z} x2={x - (f[0] / len) * 18} y2={z - (f[2] / len) * 18} stroke="#7c848e" />
            <rect x={x - 3} y={z - 3} width={6} height={6} fill="#7c848e" />
            <text x={x + 6} y={z + 12} fill="#7c848e" fontSize={10} fontFamily="var(--font-mono)">
              {c.label}
            </text>
          </g>
        )
      })}
      {scene.tracks.map((tr) => {
        const selected = tr.id === selectedTrackId
        const path = tr.states.map((st, i) => `${i ? 'L' : 'M'}${sx(st.position[0]).toFixed(1)},${sz(st.position[2]).toFixed(1)}`).join(' ')
        const current = currentT === null ? tr.states.at(-1) : tr.states.find((st) => Math.abs(st.t - currentT) < 1e-6)
        const color = selected ? '#ffffff' : classColor(tr.class)
        return (
          <g
            key={tr.id}
            role="button"
            tabIndex={0}
            aria-label={`Track ${tr.id}, ${tr.class}`}
            aria-pressed={selected}
            onClick={() => onSelect(tr.id)}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect(tr.id)}
            style={{ cursor: 'pointer' }}
            opacity={selectedTrackId === null || selected ? 1 : 0.45}
          >
            <path d={path} fill="none" stroke="transparent" strokeWidth={12} />
            <path d={path} fill="none" stroke={color} strokeWidth={selected ? 2.5 : 1.5} />
            {tr.states.map((st, i) => (
              <circle key={i} cx={sx(st.position[0])} cy={sz(st.position[2])} r={st.observed ? 2 : 1.5} fill={st.observed ? color : 'none'} stroke={color} />
            ))}
            {current && (
              <>
                <circle cx={sx(current.position[0])} cy={sz(current.position[2])} r={5} fill={color} />
                <text x={sx(current.position[0]) + 7} y={sz(current.position[2]) - 7} fill={color} fontSize={11} fontFamily="var(--font-mono)">
                  #{tr.id}
                </text>
              </>
            )}
          </g>
        )
      })}
    </svg>
  )
}
