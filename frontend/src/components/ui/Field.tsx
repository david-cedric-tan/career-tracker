import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react'
import { useId } from 'react'
import { cx } from '../../lib/format'

const CONTROL =
  'w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink ' +
  'placeholder:text-ink-3 transition-colors hover:border-line-strong ' +
  'focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-ring ' +
  'disabled:bg-surface-2 disabled:text-ink-3'

export function Label({
  htmlFor,
  children,
  hint,
}: {
  htmlFor?: string
  children: ReactNode
  hint?: ReactNode
}) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-2">
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-ink-2">
        {children}
      </label>
      {hint ? <span className="text-[11px] text-ink-3">{hint}</span> : null}
    </div>
  )
}

export function FieldShell({
  label,
  error,
  help,
  hint,
  id,
  className,
  children,
}: {
  label?: ReactNode
  error?: string
  help?: ReactNode
  hint?: ReactNode
  id: string
  className?: string
  children: ReactNode
}) {
  return (
    <div className={className}>
      {label ? (
        <Label htmlFor={id} hint={hint}>
          {label}
        </Label>
      ) : null}
      {children}
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-[12px] text-critical">
          {error}
        </p>
      ) : help ? (
        <p className="mt-1 text-[12px] text-ink-3">{help}</p>
      ) : null}
    </div>
  )
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label?: ReactNode
  error?: string
  help?: ReactNode
  hint?: ReactNode
  wrapperClassName?: string
}

export function Input({
  label,
  error,
  help,
  hint,
  wrapperClassName,
  className,
  id: providedId,
  ...rest
}: InputProps) {
  const generatedId = useId()
  const id = providedId ?? generatedId
  return (
    <FieldShell
      label={label}
      error={error}
      help={help}
      hint={hint}
      id={id}
      className={wrapperClassName}
    >
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={cx(CONTROL, 'h-10', error && 'border-critical', className)}
        {...rest}
      />
    </FieldShell>
  )
}

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label?: ReactNode
  error?: string
  help?: ReactNode
  wrapperClassName?: string
}

export function Select({
  label,
  error,
  help,
  wrapperClassName,
  className,
  id: providedId,
  children,
  ...rest
}: SelectProps) {
  const generatedId = useId()
  const id = providedId ?? generatedId
  return (
    <FieldShell
      label={label}
      error={error}
      help={help}
      id={id}
      className={wrapperClassName}
    >
      <select
        id={id}
        aria-invalid={error ? true : undefined}
        className={cx(
          CONTROL,
          'h-10 cursor-pointer appearance-none bg-no-repeat pr-9',
          error && 'border-critical',
          className,
        )}
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%238b95a5' stroke-width='2.5' stroke-linecap='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
          backgroundPosition: 'right 0.65rem center',
          backgroundSize: '1rem',
        }}
        {...rest}
      >
        {children}
      </select>
    </FieldShell>
  )
}

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: ReactNode
  error?: string
  help?: ReactNode
  wrapperClassName?: string
}

export function Textarea({
  label,
  error,
  help,
  wrapperClassName,
  className,
  id: providedId,
  ...rest
}: TextareaProps) {
  const generatedId = useId()
  const id = providedId ?? generatedId
  return (
    <FieldShell
      label={label}
      error={error}
      help={help}
      id={id}
      className={wrapperClassName}
    >
      <textarea
        id={id}
        rows={3}
        aria-invalid={error ? true : undefined}
        className={cx(CONTROL, 'resize-y py-2', error && 'border-critical', className)}
        {...rest}
      />
    </FieldShell>
  )
}

export function Checkbox({
  label,
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label
      className={cx(
        'flex cursor-pointer select-none items-center gap-2.5 text-sm text-ink',
        className,
      )}
    >
      <input
        type="checkbox"
        className="size-4 shrink-0 cursor-pointer rounded border-line-strong accent-[var(--color-brand)]"
        {...rest}
      />
      {label}
    </label>
  )
}
