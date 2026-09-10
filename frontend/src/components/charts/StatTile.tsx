import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { cx } from '../../lib/format'
import { Icon } from '../ui/Icon'

type Tone = 'default' | 'good' | 'warning' | 'critical'

const TONES: Record<Tone, { value: string; chip: string }> = {
  default: { value: 'text-ink', chip: 'bg-brand-soft text-brand-strong' },
  good: { value: 'text-ink', chip: 'bg-good/10 text-good' },
  warning: { value: 'text-ink', chip: 'bg-warning/15 text-[#8a5d00] dark:text-warning' },
  critical: { value: 'text-ink', chip: 'bg-critical/10 text-critical' },
}

/**
 * One number is a stat tile, not a chart. `hint` carries the qualifier so the
 * figure itself stays uncluttered.
 */
export function StatTile({
  label,
  value,
  hint,
  icon,
  tone = 'default',
  to,
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  icon: string
  tone?: Tone
  to?: string
}) {
  const styles = TONES[tone]
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[12.5px] font-medium text-ink-2">{label}</p>
        <span className={cx('grid size-7 shrink-0 place-items-center rounded-lg', styles.chip)}>
          <Icon name={icon} size={15} />
        </span>
      </div>
      {/* Proportional figures — tabular-nums would make a hero number look loose. */}
      <p className={cx('mt-2 text-[26px] font-semibold leading-none', styles.value)}>
        {value}
      </p>
      {hint ? <p className="mt-1.5 text-[12px] text-ink-3">{hint}</p> : null}
    </>
  )

  const className =
    'rounded-card border border-line bg-surface p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)] intern:backdrop-blur-xl'

  return to ? (
    <Link
      to={to}
      state={{ from: '/' }}
      className={cx(className, 'block transition-colors hover:bg-surface-2')}
    >
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  )
}
