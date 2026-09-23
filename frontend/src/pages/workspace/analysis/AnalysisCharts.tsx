import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { SceneDocument } from '@/types/scene'
import { fmtDuration } from '@/utils/format'

const tooltipStyle = { background: '#0f1113', border: '1px solid #3a4048', fontSize: 12 }
const STATUS_COLOR: Record<string, string> = { completed: '#6aa5f0', warning: '#e0913f', failed: '#e2635c', skipped: '#3a4048' }

export function StageTimingChart({ scene }: { scene: SceneDocument }) {
  const data = scene.stats.stages.map((st) => ({ name: st.label, ms: st.durationMs ?? 0, status: st.status }))
  return (
    <div style={{ height: 320 }} role="img" aria-label="Processing time per pipeline stage">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 8 }}>
          <CartesianGrid stroke="#262a2f" horizontal={false} />
          <XAxis type="number" stroke="#7c848e" fontSize={11} tickFormatter={(v: number) => (v === 0 ? '0' : fmtDuration(v))} />
          <YAxis type="category" dataKey="name" stroke="#7c848e" fontSize={11} width={130} />
          <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgb(255 255 255 / 0.04)' }} formatter={(v) => [fmtDuration(Number(v)), 'time']} />
          <Bar dataKey="ms" isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.name} fill={STATUS_COLOR[d.status] ?? '#6aa5f0'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function ReprojectionHistogram({ scene }: { scene: SceneDocument }) {
  const data = scene.stats.reprojErrorHistogram.map((b) => ({ bin: `${b.from.toFixed(2)}–${b.to.toFixed(2)}`, count: b.count }))
  return (
    <div style={{ height: 220 }} role="img" aria-label="Histogram of per-point reprojection error in pixels">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
          <CartesianGrid stroke="#262a2f" vertical={false} />
          <XAxis dataKey="bin" stroke="#7c848e" fontSize={10} interval={1} />
          <YAxis stroke="#7c848e" fontSize={11} width={44} />
          <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgb(255 255 255 / 0.04)' }} formatter={(v) => [v, 'points']} labelFormatter={(l) => `${l} px`} />
          <Bar dataKey="count" fill="#6aa5f0" isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
