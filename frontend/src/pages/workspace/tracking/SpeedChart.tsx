import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { Track } from '@/types/scene'
import { groundSpeed } from '@/utils/geometry'

export default function SpeedChart({ track, unit }: { track: Track; unit: string }) {
  const data = track.states.map((st) => ({ t: st.t, speed: st.observed ? +groundSpeed(st.velocity).toFixed(3) : null }))
  return (
    <div style={{ height: 180 }} role="img" aria-label={`Estimated ground speed of track ${track.id} over time`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
          <CartesianGrid stroke="#262a2f" vertical={false} />
          <XAxis dataKey="t" stroke="#7c848e" fontSize={11} tickFormatter={(v: number) => `${v}s`} />
          <YAxis stroke="#7c848e" fontSize={11} width={40} tickFormatter={(v: number) => `${v}`} />
          <Tooltip
            contentStyle={{ background: '#0f1113', border: '1px solid #3a4048', fontSize: 12 }}
            formatter={(v) => [`${v} ${unit}/s`, 'speed']}
            labelFormatter={(t) => `t = ${t} s`}
          />
          <Line type="monotone" dataKey="speed" stroke="#6aa5f0" strokeWidth={1.5} dot={{ r: 2 }} connectNulls isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
