import { useEffect, useId, useRef, type ReactNode } from 'react'
import { Button } from './Button'
import s from './ui.module.css'

interface DialogProps {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}

/** Native <dialog>: focus trapping, Escape handling and inertness come from the browser. */
export function Dialog({ open, title, onClose, children, footer }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open && !el.open) {
      if (typeof el.showModal === 'function') el.showModal()
      else el.setAttribute('open', '')
    } else if (!open && el.open) {
      if (typeof el.close === 'function') el.close()
      else el.removeAttribute('open')
    }
  }, [open])

  return (
    <dialog
      ref={ref}
      className={s.dialog}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose()
      }}
    >
      {open && (
        <>
          <div className={s.dialogHeader}>
            <h2 id={titleId} style={{ fontSize: 'var(--fs-lg)' }}>
              {title}
            </h2>
            <Button variant="ghost" size="sm" icon="close" label="Close dialog" onClick={onClose} />
          </div>
          <div className={s.dialogBody}>{children}</div>
          {footer && <div className={s.dialogFooter}>{footer}</div>}
        </>
      )}
    </dialog>
  )
}
