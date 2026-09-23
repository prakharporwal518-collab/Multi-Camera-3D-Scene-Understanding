import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'
import s from './ui.module.css'

interface FieldProps {
  label: ReactNode
  help?: ReactNode
  error?: string | null
  children: (ids: { id: string; describedBy?: string; invalid: boolean }) => ReactNode
}

/** Wires label, help text and error message to the control with the right ARIA attributes. */
export function Field({ label, help, error, children }: FieldProps) {
  const id = useId()
  const helpId = `${id}-help`
  const errorId = `${id}-error`
  const describedBy = [help ? helpId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined
  return (
    <div className={s.field}>
      <label className={s.label} htmlFor={id}>
        {label}
      </label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {help && !error && (
        <span className={s.help} id={helpId}>
          {help}
        </span>
      )}
      {error && (
        <span className={s.fieldError} id={errorId} role="alert">
          {error}
        </span>
      )}
    </div>
  )
}

type TextInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'> & {
  label: ReactNode
  help?: ReactNode
  error?: string | null
  mono?: boolean
  onChange: (value: string) => void
}

export function TextInput({ label, help, error, mono, onChange, className, ...rest }: TextInputProps) {
  return (
    <Field label={label} help={help} error={error}>
      {({ id, describedBy, invalid }) => (
        <input
          id={id}
          className={`${s.input} ${mono ? s.mono : ''} ${className ?? ''}`}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          onChange={(e) => onChange(e.target.value)}
          {...rest}
        />
      )}
    </Field>
  )
}

type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> & {
  label: ReactNode
  help?: ReactNode
  options: { value: string; label: string; disabled?: boolean }[]
  onChange: (value: string) => void
}

export function Select({ label, help, options, onChange, ...rest }: SelectProps) {
  return (
    <Field label={label} help={help}>
      {({ id, describedBy }) => (
        <select id={id} className={s.select} aria-describedby={describedBy} onChange={(e) => onChange(e.target.value)} {...rest}>
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  )
}

interface CheckboxProps {
  label: ReactNode
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}

export function Checkbox({ label, checked, onChange, disabled }: CheckboxProps) {
  return (
    <label className={s.check}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  )
}

interface RangeProps {
  label: ReactNode
  value: number
  min: number
  max: number
  step: number
  format?: (v: number) => string
  onChange: (value: number) => void
  help?: ReactNode
}

export function Range({ label, value, min, max, step, format = String, onChange, help }: RangeProps) {
  return (
    <Field label={label} help={help}>
      {({ id, describedBy }) => (
        <div className={s.range}>
          <input
            id={id}
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            aria-describedby={describedBy}
            aria-valuetext={format(value)}
            onChange={(e) => onChange(Number(e.target.value))}
          />
          <span className={`${s.rangeValue} num`}>{format(value)}</span>
        </div>
      )}
    </Field>
  )
}
