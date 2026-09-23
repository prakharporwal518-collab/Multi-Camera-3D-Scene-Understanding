import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Select, TextInput } from '@/components/ui/Form'
import { ErrorNotice } from '@/components/ui/States'
import { api } from '@/services/api'
import type { CalibrationRequest, Camera } from '@/types/project'
import { parseNumber } from '@/utils/validation'
import s from '../page.module.css'

type Method = CalibrationRequest['method']

export function RecalibrateDialog({ open, camera, onClose, onDone }: { open: boolean; camera: Camera; onClose: () => void; onDone: (c: Camera) => void }) {
  const w = camera.width ?? 0
  const h = camera.height ?? 0
  const current = camera.calibration?.intrinsics
  const [method, setMethod] = useState<Method>(camera.calibration?.method ?? 'checkerboard')
  const [form, setForm] = useState({
    fx: String(current?.fx ?? w),
    fy: String(current?.fy ?? w),
    cx: String(current?.cx ?? w / 2),
    cy: String(current?.cy ?? h / 2),
    dist: (current?.dist ?? [0, 0, 0, 0, 0]).join(', '),
    cols: '9',
    rows: '6',
    square: '0.025',
  })
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }))

  const checks = {
    fx: parseNumber(form.fx, { label: 'fx', min: 0, exclusiveMin: true, max: 1e5, required: true }),
    fy: parseNumber(form.fy, { label: 'fy', min: 0, exclusiveMin: true, max: 1e5, required: true }),
    cx: parseNumber(form.cx, { label: 'cx', min: 0, exclusiveMin: true, max: w, required: true }),
    cy: parseNumber(form.cy, { label: 'cy', min: 0, exclusiveMin: true, max: h, required: true }),
    cols: parseNumber(form.cols, { label: 'Inner corners (columns)', min: 3, max: 30, integer: true, required: true }),
    rows: parseNumber(form.rows, { label: 'Inner corners (rows)', min: 3, max: 30, integer: true, required: true }),
    square: parseNumber(form.square, { label: 'Square size', min: 0, exclusiveMin: true, max: 1, required: true }),
  }
  const distValues = form.dist.split(/[\s,]+/).filter(Boolean).map(Number)
  const distError =
    distValues.some((v) => !Number.isFinite(v)) || ![4, 5, 8].includes(distValues.length)
      ? 'Enter 4, 5 or 8 numbers in OpenCV order: k1, k2, p1, p2[, k3, …]'
      : distValues.some((v) => Math.abs(v) > 50)
        ? 'Coefficients above 50 in magnitude are not plausible.'
        : null

  const invalid =
    method === 'manual'
      ? Boolean(checks.fx.error || checks.fy.error || checks.cx.error || checks.cy.error || distError)
      : method === 'checkerboard'
        ? Boolean(checks.cols.error || checks.rows.error || checks.square.error)
        : false

  const submit = async () => {
    setTouched(true)
    if (invalid) return
    const body: CalibrationRequest =
      method === 'manual'
        ? { method, fx: checks.fx.value!, fy: checks.fy.value!, cx: checks.cx.value!, cy: checks.cy.value!, dist: distValues }
        : method === 'checkerboard'
          ? { method, patternCols: checks.cols.value!, patternRows: checks.rows.value!, squareSizeM: checks.square.value! }
          : { method }
    setBusy(true)
    setError(null)
    try {
      onDone(await api.calibrate(camera.id, body))
      onClose()
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  const err = (k: keyof typeof checks) => (touched ? checks[k].error : null)
  return (
    <Dialog
      open={open}
      title={`Calibrate ${camera.label}`}
      onClose={() => !busy && onClose()}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={submit}>
            {method === 'checkerboard' ? 'Detect board and calibrate' : 'Save calibration'}
          </Button>
        </>
      }
    >
      <Select
        label="Method"
        value={method}
        onChange={(v) => setMethod(v as Method)}
        options={[
          { value: 'checkerboard', label: 'Checkerboard (from this camera’s frames)' },
          { value: 'manual', label: 'Enter known intrinsics' },
          { value: 'assumed', label: 'Assume from image size (approximate)' },
        ]}
      />
      {method === 'checkerboard' && (
        <>
          <p className="muted">
            Frames of this camera that show a planar checkerboard are used (Zhang’s method). At least three frames must show
            the whole board.
          </p>
          <div className={s.grid3}>
            <TextInput label="Columns" help="inner corners" inputMode="numeric" value={form.cols} error={err('cols')} onChange={set('cols')} />
            <TextInput label="Rows" help="inner corners" inputMode="numeric" value={form.rows} error={err('rows')} onChange={set('rows')} />
            <TextInput label="Square size (m)" inputMode="decimal" value={form.square} error={err('square')} onChange={set('square')} />
          </div>
        </>
      )}
      {method === 'manual' && (
        <>
          <div className={s.grid2}>
            <TextInput label="fx (px)" mono inputMode="decimal" value={form.fx} error={err('fx')} onChange={set('fx')} />
            <TextInput label="fy (px)" mono inputMode="decimal" value={form.fy} error={err('fy')} onChange={set('fy')} />
            <TextInput label="cx (px)" mono inputMode="decimal" value={form.cx} error={err('cx')} onChange={set('cx')} help={`0 – ${w}`} />
            <TextInput label="cy (px)" mono inputMode="decimal" value={form.cy} error={err('cy')} onChange={set('cy')} help={`0 – ${h}`} />
          </div>
          <TextInput
            label="Distortion coefficients"
            mono
            value={form.dist}
            error={touched ? distError : null}
            help="k1, k2, p1, p2, k3"
            onChange={set('dist')}
          />
        </>
      )}
      {method === 'assumed' && (
        <p className="muted">
          Removes the stored calibration. The pipeline then assumes f = max(width, height) and a centred principal point;
          results are flagged as approximate.
        </p>
      )}
      {busy && method === 'checkerboard' && <p className="muted">Detecting the board in up to 40 frames…</p>}
      {error !== null && <ErrorNotice error={error} title="Calibration failed" />}
    </Dialog>
  )
}
