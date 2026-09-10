import { cx } from '../../lib/format'

/**
 * A radial meter: one value against a known whole.
 *
 * Not a two-slice pie — that would be a chart of two categories, which a bar or
 * a plain number does better. This encodes completion against 0–100%, and the
 * percentage is printed in the middle so the value never depends on reading an
 * arc.
 */
export function ProgressRing({
  done,
  total,
  size = 56,
  stroke = 6,
  label,
}: {
  done: number
  total: number
  size?: number
  stroke?: number
  label?: string
}) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  // Fixed at 12px this overran a small ring's stroke (the reported "number
  // sits on top of the border" bug) — scale it with the ring instead.
  const fontSize = Math.max(9, Math.round(size * 0.26))

  return (
    <div className="flex items-center gap-3">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          role="img"
          aria-label={`${done} of ${total} done, ${pct}%`}
          // Start the arc at 12 o'clock and sweep clockwise.
          className="-rotate-90"
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--color-surface-2)"
            strokeWidth={stroke}
          />
          {done > 0 ? (
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke="var(--series-1)"
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - pct / 100)}
              className="transition-[stroke-dashoffset] duration-500"
            />
          ) : null}
        </svg>

        <span
          className={cx('absolute inset-0 grid place-items-center font-semibold text-ink')}
          style={{ fontSize }}
        >
          {pct}%
        </span>
      </div>

      {label ? (
        <div className="min-w-0">
          <p className="text-[12.5px] font-medium text-ink">{label}</p>
          <p className="text-[11.5px] tabular-nums text-ink-3">
            {done} of {total} done
          </p>
        </div>
      ) : null}
    </div>
  )
}
