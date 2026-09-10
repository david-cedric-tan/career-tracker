import { cx } from '../../lib/format'

export type BarRow = { key: string; label: string; count: number; color?: string }

/**
 * Horizontal magnitude bars with a direct value label on every row.
 *
 * Values are always readable as text, so the encoding never depends on colour
 * alone and no tooltip is required to read a number.
 */
export function BarList({
  rows,
  emptyText = 'No data yet.',
  /** Ordered categories get the ordinal ramp; nominal ones share one colour. */
  ramp = false,
  onSelect,
}: {
  rows: BarRow[]
  emptyText?: string
  ramp?: boolean
  onSelect?: (row: BarRow) => void
}) {
  const max = Math.max(1, ...rows.map((row) => row.count))
  const total = rows.reduce((sum, row) => sum + row.count, 0)

  if (total === 0) {
    return <p className="py-8 text-center text-[13px] text-ink-3">{emptyText}</p>
  }

  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((row, index) => {
        const color =
          row.color ?? (ramp ? `var(--stage-${Math.min(index + 1, 7)})` : 'var(--series-1)')
        const width = row.count === 0 ? 0 : Math.max(2, (row.count / max) * 100)
        const Wrapper = onSelect ? 'button' : 'div'

        return (
          <li key={row.key}>
            <Wrapper
              {...(onSelect
                ? { type: 'button' as const, onClick: () => onSelect(row) }
                : {})}
              className={cx(
                'flex w-full items-center gap-3 rounded-md text-left',
                onSelect && 'cursor-pointer transition-opacity hover:opacity-80',
              )}
            >
              <span className="w-32 shrink-0 truncate text-[12.5px] text-ink-2 sm:w-40">
                {row.label}
              </span>
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <span className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-2">
                  <span
                    className="block h-full rounded-full transition-[width] duration-500"
                    style={{ width: `${width}%`, backgroundColor: color }}
                  />
                </span>
                <span className="w-7 shrink-0 text-right text-[12.5px] font-semibold tabular-nums text-ink">
                  {row.count}
                </span>
              </span>
            </Wrapper>
          </li>
        )
      })}
    </ul>
  )
}
