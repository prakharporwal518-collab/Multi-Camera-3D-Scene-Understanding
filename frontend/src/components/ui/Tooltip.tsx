import { cloneElement, isValidElement, useId, useState, type ReactElement, type ReactNode } from 'react'
import s from './ui.module.css'

interface TooltipProps {
  content: ReactNode
  side?: 'top' | 'bottom'
  children: ReactElement<{ 'aria-describedby'?: string }>
}

/** Shows on hover and on keyboard focus; linked to the trigger with aria-describedby. */
export function Tooltip({ content, side = 'top', children }: TooltipProps) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const trigger = isValidElement(children) ? cloneElement(children, { 'aria-describedby': open ? id : undefined }) : children
  return (
    <span
      className={s.tooltipWrap}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
    >
      {trigger}
      {open && (
        <span role="tooltip" id={id} className={s.tooltip} data-side={side}>
          {content}
        </span>
      )}
    </span>
  )
}
