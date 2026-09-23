import type { Intrinsics, SceneCamera } from '@/types/scene'
import { cameraForward } from '@/utils/geometry'
import { cameraColor } from '@/utils/palette'
import { distort } from './distortion'

/**
 * Image plane with the principal point, the image centre and a grid warped by the lens
 * distortion. With zero distortion the grid is straight, which is itself informative.
 */
export function ImagePlaneDiagram({ intr }: { intr: Intrinsics }) {
  const W = 320
  const scale = W / intr.width
  const H = intr.height * scale
  const lines: string[] = []
  const N = 8
  const toPx = (u: number, v: number): [number, number] => {
    const [xd, yd] = distort((u - intr.cx) / intr.fx, (v - intr.cy) / intr.fy, intr.dist)
    return [(xd * intr.fx + intr.cx) * scale, (yd * intr.fy + intr.cy) * scale]
  }
  for (let i = 0; i <= N; i++) {
    const h: string[] = []
    const v: string[] = []
    for (let k = 0; k <= 24; k++) {
      const [hx, hy] = toPx((k / 24) * intr.width, (i / N) * intr.height)
      const [vx, vy] = toPx((i / N) * intr.width, (k / 24) * intr.height)
      h.push(`${hx.toFixed(1)},${hy.toFixed(1)}`)
      v.push(`${vx.toFixed(1)},${vy.toFixed(1)}`)
    }
    lines.push(h.join(' '), v.join(' '))
  }
  const px = intr.cx * scale
  const py = intr.cy * scale
  return (
    <svg viewBox={`-6 -6 ${W + 12} ${H + 12}`} width="100%" style={{ maxWidth: 440, display: 'block', margin: '0 auto' }} role="img" aria-label="Image plane with principal point and distortion grid">
      <rect x={0} y={0} width={W} height={H} fill="#111315" stroke="#3a4048" />
      {lines.map((pts, i) => (
        <polyline key={i} points={pts} fill="none" stroke="#2f353c" strokeWidth={1} />
      ))}
      <g stroke="#7c848e" strokeWidth={1}>
        <line x1={W / 2 - 6} y1={H / 2} x2={W / 2 + 6} y2={H / 2} />
        <line x1={W / 2} y1={H / 2 - 6} x2={W / 2} y2={H / 2 + 6} />
      </g>
      <g stroke="#6aa5f0" strokeWidth={1.5}>
        <circle cx={px} cy={py} r={4} fill="none" />
        <line x1={px - 10} y1={py} x2={px + 10} y2={py} />
        <line x1={px} y1={py - 10} x2={px} y2={py + 10} />
      </g>
    </svg>
  )
}

/** Plan view (X/Z) of all registered cameras with their viewing directions. */
export function RigPlan({ cameras, selectedId, onSelect }: { cameras: SceneCamera[]; selectedId: string; onSelect: (id: string) => void }) {
  const placed = cameras.filter((c) => c.pose)
  if (placed.length === 0) return <p className="faint">Camera positions are available after reconstruction.</p>
  const xs = placed.map((c) => c.pose!.position[0])
  const zs = placed.map((c) => c.pose!.position[2])
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs), 1e-3)
  const pad = span * 0.35
  const minX = Math.min(...xs) - pad
  const minZ = Math.min(...zs) - pad
  const size = span + 2 * pad
  const arrow = span * 0.25
  const W = 320
  const k = W / size
  // Plan view: +X to the right would mirror the scene as seen by the cameras, so X is flipped.
  const sx = (x: number) => W - (x - minX) * k
  const sz = (z: number) => W - (z - minZ) * k
  return (
    <svg viewBox={`0 0 ${W} ${W}`} width="100%" style={{ maxWidth: 360, display: 'block', margin: '0 auto' }} role="group" aria-label="Plan view of camera positions">
      <rect width={W} height={W} fill="#111315" stroke="#2d3137" />
      {placed.map((c) => {
        const i = cameras.indexOf(c)
        const p = c.pose!
        const f = cameraForward(p)
        const len = Math.hypot(f[0], f[2]) || 1
        const x = sx(p.position[0])
        const z = sz(p.position[2])
        const tx = sx(p.position[0] + (f[0] / len) * arrow)
        const tz = sz(p.position[2] + (f[2] / len) * arrow)
        const selected = c.id === selectedId
        return (
          <g
            key={c.id}
            role="button"
            tabIndex={0}
            aria-pressed={selected}
            aria-label={`Select ${c.label}`}
            onClick={() => onSelect(c.id)}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect(c.id)}
            style={{ cursor: 'pointer' }}
          >
            <line x1={x} y1={z} x2={tx} y2={tz} stroke={cameraColor(i)} strokeWidth={selected ? 2.5 : 1.5} />
            <circle cx={x} cy={z} r={selected ? 6 : 4.5} fill={cameraColor(i)} stroke={selected ? '#fff' : 'none'} />
            <text x={x + 8} y={z - 8} fill="#aab1ba" fontSize={11} fontFamily="var(--font-mono)">
              {c.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
