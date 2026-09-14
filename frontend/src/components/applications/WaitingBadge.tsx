import { cx, formatDate } from '../../lib/format'
import { Tooltip } from '../ui/Tooltip'

/** Past this many days a wait is worth a second look — not a verdict, just a
    prompt. Never applied automatically: only you know whether silence means
    they've gone quiet or the process is simply slow. */
export const GHOSTING_SUGGESTION_DAYS = 30

/**
 * "Waiting For Response" — the employer owes the next move.
 *
 * Sits alongside the stage and outcome badges rather than replacing either:
 * you are still *at* the video interview and still *in progress*; all that's
 * changed is whose court the ball is in.
 */
export function WaitingBadge({
  since,
  days,
  className,
}: {
  since: string | null
  days: number | null
  className?: string
}) {
  return (
    <Tooltip
      label={
        since ? (
          <span className="flex items-center gap-1.5">
            Waiting since {formatDate(since.slice(0, 10))}
            {days === null ? null : (
              <span className="text-ink-3">
                · {days} day{days === 1 ? '' : 's'}
              </span>
            )}
          </span>
        ) : (
          'Waiting for a reply'
        )
      }
      className={className}
    >
      <span
        className={cx(
          'waiting-badge relative inline-flex items-center gap-1.5 rounded-full',
          'border border-warning/30 bg-warning/15 px-2 py-0.5',
          // Matches the Badge component's own warning tone, which darkens the
          // text in light mode so amber-on-white stays readable.
          'text-[11.5px] font-medium text-[#8a5d00] dark:text-warning',
          'cursor-default transition-colors hover:bg-warning/25',
        )}
      >
        {/* Expands out of the badge on hover — a small acknowledgement that
            it's interactive, gone in under a second so it never nags. */}
        <span className="waiting-ripple" aria-hidden="true" />
        <span className="waiting-dot size-1.5 shrink-0 rounded-full bg-warning" aria-hidden="true" />
        Waiting For Response
      </span>
    </Tooltip>
  )
}

/** Shown only once a wait has run long enough to be worth questioning. */
export function GhostingHint({ days }: { days: number | null }) {
  if (days === null || days < GHOSTING_SUGGESTION_DAYS) return null
  return (
    <p className="mt-2 text-[12.5px] text-ink-2">
      No reply for {days} days — consider marking this as Ghosted.
    </p>
  )
}
