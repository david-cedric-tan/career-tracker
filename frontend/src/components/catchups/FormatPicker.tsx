import type { Choice } from '../../api/types'
import { cx } from '../../lib/format'
import { CATCHUP_FORMAT_ICON } from '../../lib/tones'
import { Label } from '../ui/Field'
import { Icon } from '../ui/Icon'

/**
 * Catch-up format as a row of icon chips — coffee, call, video… — rather
 * than a bare dropdown. Used by the form and, with `allowAll`, as the
 * page filter, so the two look and behave the same.
 */
export function FormatPicker({
  value,
  onChange,
  choices,
  label,
  allowAll = false,
  size = 'md',
}: {
  value: string
  onChange: (next: string) => void
  choices: Choice[] | undefined
  label?: string
  /** Adds a leading "All formats" chip that clears the value. */
  allowAll?: boolean
  size?: 'sm' | 'md'
}) {
  const options = [
    ...(allowAll ? [{ value: '', label: 'All' }] : []),
    ...(choices ?? []),
  ]
  return (
    <div>
      {label ? <Label>{label}</Label> : null}
      <div role="radiogroup" aria-label={label ?? 'Format'} className="flex flex-wrap gap-1.5">
        {options.map((choice) => {
          const active = value === choice.value
          return (
            <button
              key={choice.value || 'all'}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(choice.value)}
              className={cx(
                'inline-flex items-center gap-1.5 rounded-full border font-medium transition-colors',
                size === 'sm' ? 'px-2.5 py-1 text-[11.5px]' : 'px-3 py-1.5 text-[12.5px]',
                active
                  ? 'border-brand bg-brand-soft text-brand-strong'
                  : 'border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink',
              )}
            >
              <span
                className={cx(
                  'grid shrink-0 place-items-center rounded-full',
                  size === 'sm' ? 'size-4' : 'size-5',
                  active ? 'bg-brand text-white' : 'bg-surface-2 text-ink-3',
                )}
              >
                <Icon
                  name={choice.value ? (CATCHUP_FORMAT_ICON[choice.value] ?? 'sparkles') : 'list'}
                  size={size === 'sm' ? 10 : 12}
                />
              </span>
              {choice.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
