import { cx } from '../../lib/format'

/**
 * On/off control. Solid fill when liquid glass is off; frosted capsule and
 * glass knob when `[data-glass]` is on (see index.css). Callers keep the
 * same markup either way so turning the slider to zero looks like before.
 */
export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label?: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation()
        onChange(!checked)
      }}
      className={cx(
        'ui-switch relative h-6 w-11 shrink-0 rounded-full transition-colors',
        checked ? 'bg-brand' : 'bg-surface-2 ring-1 ring-inset ring-line',
      )}
    >
      <span
        className={cx(
          'ui-switch-knob absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-5' : 'translate-x-0',
        )}
      />
    </button>
  )
}
