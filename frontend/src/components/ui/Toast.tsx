import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button } from './Button'
import { Icon } from './Icon'
import s from './ui.module.css'

type ToastTone = 'ok' | 'err' | 'warn' | 'info'

interface ToastItem {
  id: number
  tone: ToastTone
  title: string
  text?: string
}

interface ToastApi {
  show: (tone: ToastTone, title: string, text?: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => setItems((list) => list.filter((t) => t.id !== id)), [])

  const show = useCallback(
    (tone: ToastTone, title: string, text?: string) => {
      const id = nextId.current++
      setItems((list) => [...list.slice(-3), { id, tone, title, text }])
      // Errors stay until dismissed; everything else clears itself.
      if (tone !== 'err') window.setTimeout(() => dismiss(id), 5000)
    },
    [dismiss],
  )

  const api = useMemo(() => ({ show }), [show])
  const icons = { ok: 'check', err: 'error', warn: 'warning', info: 'info' } as const

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className={s.toasts} aria-live="polite" aria-relevant="additions">
        {items.map((t) => (
          <div key={t.id} className={s.toast} data-tone={t.tone} role={t.tone === 'err' ? 'alert' : 'status'}>
            <Icon name={icons[t.tone]} />
            <div className={s.toastBody}>
              <p className={s.toastTitle}>{t.title}</p>
              {t.text && <p className={s.toastText}>{t.text}</p>}
            </div>
            <Button size="sm" variant="ghost" icon="close" label="Dismiss notification" onClick={() => dismiss(t.id)} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}
