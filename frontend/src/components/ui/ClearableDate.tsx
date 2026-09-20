import { Input } from './Field'
import { Icon } from './Icon'

/**
 * A date input that can be emptied with one click. Browsers' own clear
 * affordance on `<input type="date">` is inconsistent (absent on Safari), and
 * "I never met this person" needs to be a state you can get back to.
 */
export function ClearableDate({
  label,
  value,
  onChange,
  error,
  help,
}: {
  label: string
  value: string
  onChange: (next: string) => void
  error?: string
  help?: string
}) {
  return (
    <div className="relative">
      <Input
        label={label}
        type="date"
        value={value}
        error={error}
        help={help}
        onChange={(event) => onChange(event.target.value)}
        className={value ? 'pr-9' : undefined}
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label={`Clear ${label.toLowerCase()}`}
          title="Clear"
          className="absolute right-2 top-[30px] rounded-md p-1 text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <Icon name="close" size={13} />
        </button>
      ) : null}
    </div>
  )
}
