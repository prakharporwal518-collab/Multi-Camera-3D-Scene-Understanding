import type { StageStatus } from '@/types/scene'
import { Badge, type Tone } from './ui/Badge'
import type { IconName } from './ui/Icon'
import { Spinner } from './ui/Progress'

const STATUS: Record<StageStatus, { label: string; tone: Tone; icon: IconName }> = {
  waiting: { label: 'Waiting', tone: 'neutral', icon: 'clock' },
  processing: { label: 'Processing', tone: 'accent', icon: 'clock' },
  completed: { label: 'Completed', tone: 'ok', icon: 'check' },
  warning: { label: 'Warning', tone: 'warn', icon: 'warning' },
  failed: { label: 'Failed', tone: 'err', icon: 'error' },
  skipped: { label: 'Skipped', tone: 'neutral', icon: 'skip' },
}

/** Status is always conveyed by icon and text, never by colour alone. */
export function StatusPill({ status }: { status: StageStatus }) {
  const cfg = STATUS[status] ?? STATUS.waiting
  if (status === 'processing') {
    return (
      <Badge tone="accent">
        <Spinner /> {cfg.label}
      </Badge>
    )
  }
  return (
    <Badge tone={cfg.tone} icon={cfg.icon}>
      {cfg.label}
    </Badge>
  )
}
