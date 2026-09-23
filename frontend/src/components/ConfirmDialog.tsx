import { useState, type ReactNode } from 'react'
import { toApiError } from '@/services/apiClient'
import { Button } from './ui/Button'
import { Dialog } from './ui/Dialog'
import { ErrorNotice } from './ui/States'

export function ConfirmDialog({
  open,
  title,
  confirmLabel,
  children,
  onClose,
  onConfirm,
}: {
  open: boolean
  title: string
  confirmLabel: string
  children: ReactNode
  onClose: () => void
  onConfirm: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const confirm = async () => {
    setBusy(true)
    setError(null)
    try {
      await onConfirm()
      onClose()
    } catch (err) {
      setError(toApiError(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" loading={busy} onClick={confirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="muted">{children}</p>
      {error !== null && <ErrorNotice error={error} />}
    </Dialog>
  )
}
