import { useMemo, useState } from 'react'
import { useMeasure } from '../../hooks/useMeasure'
import { cx, formatPeriodLabel } from '../../lib/format'

export type Series = { key: string; label: string; color: string; values: number[] }

const PAD = { top: 14, right: 52, bottom: 26, left: 30 }
const HEIGHT = 220

/**
 * Multi-series line chart on a single y-axis.
 *
 * Deliberately one scale for every series — a second axis would invent a
 * relationship between counts that share no unit. Identity is carried by the
 * legend *and* an endpoint label per series, never by colour alone, which is
 * also the relief for the aqua slot's sub-3:1 contrast in light mode.
 */
export function TrendChart({
  labels,
  series,
  valueLabel = 'count',
}: {
  labels: string[]
  series: Series[]
  valueLabel?: string
}) {
  const { ref, width } = useMeasure<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)

  const max = Math.max(1, ...series.flatMap((entry) => entry.values))
  const plotWidth = Math.max(width - PAD.left - PAD.right, 10)
  const plotHeight = HEIGHT - PAD.top - PAD.bottom

  const x = (index: number) =>
    PAD.left + (labels.length <= 1 ? plotWidth / 2 : (index / (labels.length - 1)) * plotWidth)
  const y = (value: number) => PAD.top + plotHeight - (value / max) * plotHeight

  // A tick every ~1/4 of the range, snapped to whole counts.
  const ticks = useMemo(() => {
    const step = Math.max(1, Math.ceil(max / 4))
    const out: number[] = []
    for (let value = 0; value <= max; value += step) out.push(value)
    if (out[out.length - 1] !== max) out.push(max)
    return out
  }, [max])

  // Show at most ~6 x labels so they never collide on a narrow card. The last
  // bucket is always labelled, so suppress any strided label that would land
  // too close to it.
  const labelStride = Math.max(1, Math.ceil(labels.length / (width < 480 ? 4 : 6)))
  const lastIndex = labels.length - 1
  const showLabel = (index: number) =>
    index === lastIndex ||
    (index % labelStride === 0 && lastIndex - index >= Math.ceil(labelStride * 0.75))

  const empty = series.every((entry) => entry.values.every((value) => value === 0))

  return (
    <div ref={ref} className="relative">
      {width > 0 ? (
        <>
          <svg
            width={width}
            height={HEIGHT}
            role="img"
            aria-label={`${series.map((s) => s.label).join(', ')} by ${valueLabel}`}
            className="overflow-visible"
            onMouseLeave={() => setHover(null)}
            onMouseMove={(event) => {
              const bounds = event.currentTarget.getBoundingClientRect()
              const offset = event.clientX - bounds.left - PAD.left
              const ratio = labels.length <= 1 ? 0 : offset / plotWidth
              const index = Math.round(ratio * (labels.length - 1))
              setHover(Math.min(Math.max(index, 0), labels.length - 1))
            }}
          >
            {/* Recessive solid hairline grid — never dashed. */}
            {ticks.map((tick) => (
              <g key={tick}>
                <line
                  x1={PAD.left}
                  x2={PAD.left + plotWidth}
                  y1={y(tick)}
                  y2={y(tick)}
                  stroke="var(--color-line)"
                  strokeWidth="1"
                />
                <text
                  x={PAD.left - 8}
                  y={y(tick) + 3.5}
                  textAnchor="end"
                  className="fill-[var(--color-ink-3)] text-[10px] tabular-nums"
                >
                  {tick}
                </text>
              </g>
            ))}

            {labels.map((label, index) =>
              showLabel(index) ? (
                <text
                  key={label}
                  x={x(index)}
                  y={HEIGHT - 8}
                  textAnchor={index === 0 ? 'start' : index === lastIndex ? 'end' : 'middle'}
                  className="fill-[var(--color-ink-3)] text-[10px]"
                >
                  {formatPeriodLabel(label)}
                </text>
              ) : null,
            )}

            {hover !== null && !empty ? (
              <line
                x1={x(hover)}
                x2={x(hover)}
                y1={PAD.top}
                y2={PAD.top + plotHeight}
                stroke="var(--color-line-strong)"
                strokeWidth="1"
              />
            ) : null}

            {series.map((entry) => {
              const path = entry.values
                .map((value, index) => `${index === 0 ? 'M' : 'L'}${x(index)},${y(value)}`)
                .join(' ')
              const endIndex = entry.values.length - 1
              return (
                <g key={entry.key}>
                  <path
                    d={path}
                    fill="none"
                    stroke={entry.color}
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  {/* Endpoint marker + direct label: identity without the legend. */}
                  <circle
                    cx={x(endIndex)}
                    cy={y(entry.values[endIndex] ?? 0)}
                    r="4"
                    fill={entry.color}
                    stroke="var(--color-surface)"
                    strokeWidth="2"
                  />
                  <text
                    x={x(endIndex) + 9}
                    y={y(entry.values[endIndex] ?? 0) + 3.5}
                    className="fill-[var(--color-ink-2)] text-[10px] font-semibold tabular-nums"
                  >
                    {entry.values[endIndex] ?? 0}
                  </text>
                  {hover !== null ? (
                    <circle
                      cx={x(hover)}
                      cy={y(entry.values[hover] ?? 0)}
                      r="4.5"
                      fill={entry.color}
                      stroke="var(--color-surface)"
                      strokeWidth="2"
                    />
                  ) : null}
                </g>
              )
            })}
          </svg>

          {hover !== null ? (
            <div
              className="pointer-events-none absolute top-1 z-10 min-w-40 -translate-x-1/2 rounded-lg border border-line bg-surface px-2.5 py-2 text-[12px] shadow-lg"
              style={{
                left: Math.min(Math.max(x(hover), 84), Math.max(width - 84, 84)),
              }}
            >
              <p className="mb-1 font-semibold text-ink">{formatPeriodLabel(labels[hover])}</p>
              {series.map((entry) => (
                <p key={entry.key} className="flex items-center gap-1.5 text-ink-2">
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: entry.color }}
                  />
                  <span className="flex-1">{entry.label}</span>
                  <span className="font-semibold tabular-nums text-ink">
                    {entry.values[hover] ?? 0}
                  </span>
                </p>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <div style={{ height: HEIGHT }} />
      )}

      <Legend series={series} />
    </div>
  )
}

function Legend({ series }: { series: Series[] }) {
  return (
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
      {series.map((entry) => (
        <li key={entry.key} className="flex items-center gap-1.5 text-[12px] text-ink-2">
          <span
            className="size-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          {entry.label}
        </li>
      ))}
    </ul>
  )
}

/** The WCAG-clean twin of the chart — every value reachable as text. */
export function TrendTable({
  labels,
  series,
}: {
  labels: string[]
  series: Series[]
}) {
  return (
    <div className="scrollbar-thin max-h-64 overflow-auto">
      <table className="w-full text-[12.5px]">
        <thead className="sticky top-0 bg-surface">
          <tr className="border-b border-line text-left text-ink-3">
            <th className="py-1.5 pr-3 font-medium">Period</th>
            {series.map((entry) => (
              <th key={entry.key} className="py-1.5 pr-3 text-right font-medium">
                {entry.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {labels.map((label, index) => (
            <tr key={label} className="border-b border-line/60 last:border-0">
              <td className="py-1.5 pr-3 text-ink-2">{formatPeriodLabel(label)}</td>
              {series.map((entry) => (
                <td
                  key={entry.key}
                  className={cx('py-1.5 pr-3 text-right tabular-nums text-ink')}
                >
                  {entry.values[index] ?? 0}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
