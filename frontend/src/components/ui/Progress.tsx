import s from './ui.module.css'

export function Spinner({ label }: { label?: string }) {
  return (
    <span className={s.spinner} role={label ? 'status' : undefined} aria-label={label}>
      {label && <span className="visually-hidden">{label}</span>}
    </span>
  )
}

interface ProgressBarProps {
  /** 0..1, or undefined for an indeterminate bar. */
  value?: number
  label: string
}

export function ProgressBar({ value, label }: ProgressBarProps) {
  const indeterminate = value === undefined || !Number.isFinite(value)
  const pct = indeterminate ? 0 : Math.round(Math.min(1, Math.max(0, value)) * 100)
  return (
    <div
      className={`${s.progress} ${indeterminate ? s.progressIndeterminate : ''}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : pct}
    >
      <div className={s.progressFill} style={{ width: `${pct}%` }} />
    </div>
  )
}
