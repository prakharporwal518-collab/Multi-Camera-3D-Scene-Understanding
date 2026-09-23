import type { ReactNode } from 'react'
import s from './ui.module.css'

export function KeyValue({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className={s.kv}>
      {items.map(([k, v], i) => (
        <div key={i} style={{ display: 'contents' }}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

export function Matrix({ values, cols, digits = 3, label }: { values: number[]; cols: number; digits?: number; label: string }) {
  return (
    <div className={s.matrix} style={{ gridTemplateColumns: `repeat(${cols}, auto)` }} role="table" aria-label={label}>
      {Array.from({ length: values.length / cols }, (_, r) => (
        <div key={r} role="row" style={{ display: 'contents' }}>
          {values.slice(r * cols, r * cols + cols).map((v, c) => (
            <span key={c} role="cell">
              {Number.isInteger(v) && Math.abs(v) < 1e6 ? v : v.toFixed(digits)}
            </span>
          ))}
        </div>
      ))}
    </div>
  )
}
