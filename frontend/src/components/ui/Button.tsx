import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Icon, type IconName } from './Icon'
import { Spinner } from './Progress'
import s from './ui.module.css'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
  icon?: IconName
  loading?: boolean
  /** Required for icon-only buttons; becomes the accessible name. */
  label?: string
  children?: ReactNode
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  loading = false,
  label,
  children,
  className,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  const iconOnly = !children
  const classes = [
    s.btn,
    variant !== 'secondary' ? s[variant] : '',
    size === 'sm' ? s.sm : '',
    iconOnly ? s.iconOnly : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <button
      type={type}
      className={classes}
      disabled={disabled || loading}
      data-loading={loading || undefined}
      aria-label={iconOnly ? label : undefined}
      aria-busy={loading || undefined}
      title={iconOnly ? label : undefined}
      {...rest}
    >
      {loading ? <Spinner /> : icon ? <Icon name={icon} size={size === 'sm' ? 14 : 16} /> : null}
      {children}
    </button>
  )
}
