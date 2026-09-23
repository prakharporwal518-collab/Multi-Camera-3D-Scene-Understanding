import type { SceneDocument } from '@/types/scene'

const nf = (digits: number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })

export function fmtNumber(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return nf(digits).format(value)
}

export function fmtInt(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('en-US').format(Math.round(value))
}

export function fmtPercent(fraction: number | null | undefined, digits = 1): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return '—'
  return `${nf(digits).format(fraction * 100)}%`
}

export function fmtDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—'
  if (ms < 1) return '<1 ms'
  if (ms < 1000) return `${Math.round(ms)} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`
  const m = Math.floor(ms / 60_000)
  return `${m} min ${Math.round((ms % 60_000) / 1000)} s`
}

export function fmtBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

/** Length unit for the scene: metres when a metric scale is known, otherwise "u" (relative units). */
export function unitLabel(scene: Pick<SceneDocument, 'units'> | null | undefined): string {
  return scene?.units === 'm' ? 'm' : 'u'
}

export function fmtLength(value: number | null | undefined, scene: Pick<SceneDocument, 'units'> | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return `${fmtNumber(value, digits)} ${unitLabel(scene)}`
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function fmtResolution(w: number | null | undefined, h: number | null | undefined): string {
  return w && h ? `${w} × ${h}` : '—'
}

export function capitalise(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s
}
