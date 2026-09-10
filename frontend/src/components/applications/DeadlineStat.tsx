import { cx, daysFromToday, formatDate } from '../../lib/format'
import { Icon } from '../ui/Icon'
import { Tooltip } from '../ui/Tooltip'

/** Inside this many days, the countdown warns rather than informs. */
const URGENT_DAYS = 7
/** Inside this many, it's worth noticing but not alarming. */
const SOON_DAYS = 21

/**
 * How long is left to apply, from the soonest closing date across this
 * application's listings.
 *
 * A chip rather than a line of grey text: as plain `ink-2` under the role it
 * read as part of the role name and disappeared entirely at a glance. Given a
 * background, a clock and a border it reads as its own fact — and the colour
 * can then carry urgency without being the only thing that does, since the
 * number is right there in the label.
 *
 * Renders nothing at all when there's no deadline. Most listings never carry
 * one, and "No deadline" in every row is noise that hides the rows that do.
 */
export function DeadlineStat({
  deadline,
  className,
}: {
  deadline: string | null
  className?: string
}) {
  if (!deadline) return null

  const days = daysFromToday(deadline)
  const closed = days < 0
  const urgent = !closed && days <= URGENT_DAYS
  const soon = !closed && !urgent && days <= SOON_DAYS

  // One shape for every state — a number and a unit — so a column of these
  // lines up instead of reading as a ragged list of sentences. "Closes today"
  // and "28 days left" were the same fact told two different ways.
  const label = closed ? 'Closed' : days === 0 ? 'Today' : `${days}d left`

  return (
    <Tooltip
      label={closed ? `Closed ${formatDate(deadline)}` : `Closes ${formatDate(deadline)}`}
      className={className}
    >
      <span
        className={cx(
          // Fixed width and centred: the chips sit under each other in the
          // table, and a shared footprint is what makes the column read as one
          // consistent thing rather than eight differently-sized labels.
          'inline-flex w-[5.25rem] items-center justify-center gap-1 rounded-md border',
          'whitespace-nowrap px-1.5 py-0.5 text-[11px] font-semibold tabular-nums',
          closed && 'border-line bg-surface-2 text-ink-3',
          urgent && 'border-critical/30 bg-critical/10 text-critical',
          soon && 'border-warning/30 bg-warning/15 text-[#8a5d00] dark:text-warning',
          !closed && !urgent && !soon && 'border-line bg-surface-2 text-ink-2',
        )}
      >
        <Icon name="clock" size={11} className="shrink-0" />
        {label}
      </span>
    </Tooltip>
  )
}
