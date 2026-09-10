import { cx } from '../../lib/format'

/**
 * The Dynamic-mode indicator — adapted from Riccardo Rapelli's
 * "jolly-chicken-91" day/night switch on uiverse.io (MIT licensed), restyled
 * as a controlled React component: `checked` is driven by the resolved
 * theme rather than its own internal state, so it always reflects reality
 * even when something other than a click changed it (the sun moving, or the
 * 60s poll in AppearanceProvider).
 */
export function DayNightSwitch({
  checked,
  onChange,
  label,
  className,
}: {
  /** true = night (moon), false = day (sun). */
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  className?: string
}) {
  return (
    <label className={cx('dn-switch', className)} title={label}>
      <input
        type="checkbox"
        className="dn-input"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        aria-label={label}
      />
      <span className="dn-slider" aria-hidden="true">
        {(['dn-cloud-1', 'dn-cloud-2', 'dn-cloud-3'] as const).map((pos) => (
          <span key={pos} className={`dn-cloud dn-cloud-back ${pos}`}>
            <Puff />
          </span>
        ))}
        {(['dn-cloud-4', 'dn-cloud-5', 'dn-cloud-6'] as const).map((pos) => (
          <span key={pos} className={`dn-cloud dn-cloud-front ${pos}`}>
            <Puff />
          </span>
        ))}

        <span className="dn-sun-moon">
          <span className="dn-light-ray dn-light-ray-1" />
          <span className="dn-light-ray dn-light-ray-2" />
          <span className="dn-light-ray dn-light-ray-3" />
          <span className="dn-moon-dot dn-moon-dot-1" />
          <span className="dn-moon-dot dn-moon-dot-2" />
          <span className="dn-moon-dot dn-moon-dot-3" />
        </span>

        <span className="dn-stars">
          <span className="dn-star dn-star-1">
            <Sparkle />
          </span>
          <span className="dn-star dn-star-2">
            <Sparkle />
          </span>
          <span className="dn-star dn-star-3">
            <Sparkle />
          </span>
          <span className="dn-star dn-star-4">
            <Sparkle />
          </span>
        </span>
      </span>
    </label>
  )
}

function Puff() {
  return (
    <svg viewBox="0 0 100 60" preserveAspectRatio="none">
      <rect x="15" y="35" width="70" height="18" rx="9" />
      <ellipse cx="30" cy="35" rx="22" ry="18" />
      <ellipse cx="55" cy="28" rx="18" ry="15" />
      <ellipse cx="75" cy="38" rx="16" ry="13" />
    </svg>
  )
}

function Sparkle() {
  return (
    <svg viewBox="0 0 20 20">
      <path d="M10 0 12 8 20 10 12 12 10 20 8 12 0 10 8 8Z" />
    </svg>
  )
}
