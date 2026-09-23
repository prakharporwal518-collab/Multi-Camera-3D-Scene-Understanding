import type { ReactNode } from 'react'
import s from './ui.module.css'

interface PanelProps {
  title?: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  flush?: boolean
  className?: string
  bodyClassName?: string
  children: ReactNode
  as?: 'section' | 'div' | 'aside'
  id?: string
}

export function Panel({ title, subtitle, actions, flush, className, bodyClassName, children, as = 'section', id }: PanelProps) {
  const Tag = as
  const headingId = id ? `${id}-title` : undefined
  return (
    <Tag className={`${s.panel} ${className ?? ''}`} aria-labelledby={title ? headingId : undefined} id={id}>
      {(title || actions) && (
        <header className={s.panelHeader}>
          {title && (
            <h2 className={s.panelTitle} id={headingId}>
              {title}
            </h2>
          )}
          {subtitle && <span className={s.panelSubtitle}>{subtitle}</span>}
          {actions && <div className={s.panelActions}>{actions}</div>}
        </header>
      )}
      <div className={`${flush ? s.panelBodyFlush : s.panelBody} ${bodyClassName ?? ''}`}>{children}</div>
    </Tag>
  )
}
