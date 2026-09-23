import { useId, useState, type ReactNode } from 'react'
import { ApiError, toApiError } from '@/services/apiClient'
import { Button } from './Button'
import { Icon, type IconName } from './Icon'
import { Spinner } from './Progress'
import s from './ui.module.css'

interface EmptyStateProps {
  icon?: IconName
  title: string
  children?: ReactNode
  actions?: ReactNode
  compact?: boolean
}

export function EmptyState({ icon = 'info', title, children, actions, compact }: EmptyStateProps) {
  return (
    <div className={`${s.state} ${compact ? s.stateCompact : ''}`}>
      <Icon name={icon} size={compact ? 20 : 28} className={s.stateIcon} />
      <p className={s.stateTitle}>{title}</p>
      {children && <div className={s.stateText}>{children}</div>}
      {actions && <div className={s.stateActions}>{actions}</div>}
    </div>
  )
}

export function LoadingState({ label, detail }: { label: string; detail?: ReactNode }) {
  return (
    <div className={s.state} role="status" aria-live="polite">
      <Spinner />
      <p>{label}</p>
      {detail && <div className={s.stateText}>{detail}</div>}
    </div>
  )
}

interface ErrorNoticeProps {
  error: unknown
  title?: string
  onRetry?: () => void
  retrying?: boolean
  actions?: ReactNode
  tone?: 'err' | 'warn'
}

/** Inline error with the server's hint, an optional retry and collapsible technical details. */
export function ErrorNotice({ error, title, onRetry, retrying, actions, tone = 'err' }: ErrorNoticeProps) {
  const err = toApiError(error)
  const [open, setOpen] = useState(false)
  const detailsId = useId()
  const details = technicalDetails(err)
  return (
    <div className={s.errorBox} role="alert" data-tone={tone}>
      <Icon name={tone === 'warn' ? 'warning' : 'error'} className={s.errorIcon} />
      <div className={s.errorMain}>
        <p className={s.errorTitle}>{title ?? err.message}</p>
        {title && <p>{err.message}</p>}
        {err.hint && <p className={s.errorHint}>{err.hint}</p>}
        {(onRetry || actions || details) && (
          <div className={s.errorActions}>
            {onRetry && (
              <Button size="sm" icon="refresh" onClick={onRetry} loading={retrying}>
                Retry
              </Button>
            )}
            {actions}
            {details && (
              <Button size="sm" variant="ghost" aria-expanded={open} aria-controls={detailsId} onClick={() => setOpen((v) => !v)}>
                {open ? 'Hide details' : 'View details'}
              </Button>
            )}
          </div>
        )}
        {open && details && (
          <div className={s.errorDetails} id={detailsId}>
            <pre>{details}</pre>
          </div>
        )}
      </div>
    </div>
  )
}

function technicalDetails(err: ApiError): string | null {
  const lines = [`code: ${err.code}`]
  if (err.status) lines.push(`http status: ${err.status}`)
  if (err.details && Object.keys(err.details).length) lines.push(`details: ${JSON.stringify(err.details, null, 2)}`)
  return lines.length > 1 || err.code !== err.kind ? lines.join('\n') : null
}

export function ErrorState(props: ErrorNoticeProps) {
  return (
    <div className={s.state}>
      <div style={{ maxWidth: 560, width: '100%' }}>
        <ErrorNotice {...props} />
      </div>
    </div>
  )
}
