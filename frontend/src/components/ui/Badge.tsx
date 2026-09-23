import type { ReactNode } from 'react'
import { Icon, type IconName } from './Icon'
import s from './ui.module.css'

export type Tone = 'neutral' | 'accent' | 'ok' | 'warn' | 'err' | 'sample'

interface BadgeProps {
  tone?: Tone
  icon?: IconName
  title?: string
  children: ReactNode
}

export function Badge({ tone = 'neutral', icon, title, children }: BadgeProps) {
  const toneClass = tone === 'neutral' ? '' : s[`tone-${tone}`]
  return (
    <span className={`${s.badge} ${toneClass}`} title={title}>
      {icon && <Icon name={icon} size={12} />}
      {children}
    </span>
  )
}
