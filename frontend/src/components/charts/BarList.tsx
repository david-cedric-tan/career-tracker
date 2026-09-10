import { cx } from '../../lib/format'

export type BarRow = {
  key: string
  label: string
  count: number
  color?: string
  /** A subset of `count` to mark off in red — rejections at this stage. */
  rejected?: number
  /** A subset waiting on the employer, marked in amber. */
  awaiting?: number
}

/** Which slice of a bar was clicked, so the caller can filter accordingly. */
export type BarSegment = 'all' | 'awaiting' | 'rejected'

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
  onSelect?: (row: BarRow, segment: BarSegment) => void
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
        // A share of this row's own bar, not of the chart — the red is the
        // slice of *these* applications that ended in a rejection.
        const rejected = row.rejected ?? 0
        const rejectedWidth = row.count === 0 ? 0 : (rejected / row.count) * 100
        const awaiting = row.awaiting ?? 0
        const awaitingWidth = row.count === 0 ? 0 : (awaiting / row.count) * 100
        const Wrapper = onSelect ? 'button' : 'div'

        const live = row.count - awaiting - rejected

        /** "3 live · 2 waiting · 1 rejected" — only the parts that exist. */
        const breakdown = [
          live > 0 ? `${live} live` : null,
          awaiting > 0 ? `${awaiting} waiting` : null,
          rejected > 0 ? `${rejected} rejected` : null,
        ]
          .filter(Boolean)
          .join(' · ')

        return (
          <li key={row.key}>
            <Wrapper
              {...(onSelect
                ? { type: 'button' as const, onClick: () => onSelect(row, 'all') }
                : {})}
              className={cx(
                'flex w-full items-center gap-3 rounded-md text-left',
                onSelect && 'cursor-pointer',
              )}
            >
              <span className="w-32 shrink-0 truncate text-[12.5px] text-ink-2 sm:w-40">
                {row.label}
              </span>
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <span
                  className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-2"
                  title={breakdown ? `${row.label} — ${breakdown}` : undefined}
                >
                  {/* Tinted and outlined rather than filled solid — the same
                      treatment the status badges get. At full saturation a row
                      of these read as blocks of colour competing for attention;
                      the wash states the category just as clearly while
                      letting the numbers stay the loudest thing. */}
                  <span
                    className="relative block h-full overflow-hidden rounded-full border transition-[width] duration-500"
                    style={{
                      width: `${width}%`,
                      backgroundColor: `color-mix(in srgb, ${color} 22%, transparent)`,
                      borderColor: `color-mix(in srgb, ${color} 45%, transparent)`,
                    }}
                  >
                    {/* Hatched, not just red: on a short bar a flat block of
                        colour reads as another category, while the stripes
                        read as "part of this one is written off". */}
                    {rejected > 0 ? (
                      <span
                        role={onSelect ? 'button' : undefined}
                        tabIndex={onSelect ? 0 : undefined}
                        onClick={(event) => {
                          event.stopPropagation()
                          onSelect?.(row, 'rejected')
                        }}
                        className="bar-rejected absolute inset-y-0 right-0 block"
                        style={{ width: `${rejectedWidth}%` }}
                        title={`${rejected} rejected at ${row.label}`}
                      />
                    ) : null}
                    {/* Sits inboard of the rejected slice, so the two never
                        overlap: rejections are finished, waiting is live. */}
                    {awaiting > 0 ? (
                      <span
                        role={onSelect ? 'button' : undefined}
                        tabIndex={onSelect ? 0 : undefined}
                        onClick={(event) => {
                          event.stopPropagation()
                          onSelect?.(row, 'awaiting')
                        }}
                        className="absolute inset-y-0 block"
                        style={{
                          right: `${rejectedWidth}%`,
                          width: `${awaitingWidth}%`,
                          backgroundColor:
                            'color-mix(in srgb, var(--color-warning) 55%, transparent)',
                        }}
                        title={`${awaiting} waiting for a response at ${row.label}`}
                      />
                    ) : null}
                  </span>
                </span>
                {/* Just the total. The split is in the bar itself, and in the
                    hover — three numbers per row turned the chart into a
                    table with a decorative bar attached. */}
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
