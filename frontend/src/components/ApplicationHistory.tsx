import type { EventLog } from '../api/types'
import { cx, formatDate, formatDateTime } from '../lib/format'
import { Icon } from './ui/Icon'

const EVENT_STYLE: Record<
  string,
  { icon: string; dot: string; ring: string }
> = {
  created: { icon: 'plus', dot: 'bg-ink-3', ring: 'ring-surface-2' },
  stage: { icon: 'arrowRight', dot: 'bg-brand', ring: 'ring-brand-soft' },
  outcome: { icon: 'check', dot: 'bg-good', ring: 'ring-good/15' },
  edited: { icon: 'edit', dot: 'bg-ink-3', ring: 'ring-surface-2' },
}

function headline(log: EventLog) {
  switch (log.event_type) {
    case 'stage':
      return (
        <>
          Moved to <strong className="font-semibold">{log.curr_stage_display}</strong>
          {log.prev_stage_display ? (
            <span className="text-ink-3"> from {log.prev_stage_display}</span>
          ) : null}
        </>
      )
    case 'outcome':
      return (
        <>
          Marked <strong className="font-semibold">{log.curr_outcome_display}</strong>
        </>
      )
    case 'edited':
      return <>Edited</>
    default:
      return <>Application created</>
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * `null` reads better as an explicit "empty" than as a blank gap, and dates
 * are formatted here rather than server-side — the viewer's locale is a client
 * concern, not something the API should have an opinion about.
 */
function value(text: string | null) {
  if (text === null) return '—'
  return ISO_DATE.test(text) ? formatDate(text) : text
}

/**
 * Append-only timeline for one application.
 *
 * Every save shows up here — stage moves, outcome changes and ordinary field
 * edits alike — with the field-level diff the API recorded, so the history
 * answers "what did I change?" and not only "where is this in the pipeline?".
 */
export function ApplicationHistory({ logs }: { logs: EventLog[] }) {
  if (logs.length === 0) {
    return <p className="mt-3 text-[13px] text-ink-3">Nothing recorded yet.</p>
  }

  const ordered = [...logs].sort((a, b) => b.changed_at.localeCompare(a.changed_at))

  return (
    <ol className="mt-4 flex flex-col">
      {ordered.map((log, index) => {
        const style = EVENT_STYLE[log.event_type] ?? EVENT_STYLE.edited
        const last = index === ordered.length - 1

        return (
          <li key={log.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span
                className={cx(
                  'mt-1 grid size-5 shrink-0 place-items-center rounded-full text-white ring-4',
                  style.dot,
                  style.ring,
                )}
              >
                <Icon name={style.icon} size={11} />
              </span>
              {last ? null : <span className="w-px flex-1 bg-line" />}
            </div>

            <div className={cx('min-w-0 flex-1', last ? 'pb-1' : 'pb-4')}>
              <p className="text-[13.5px] text-ink">{headline(log)}</p>

              {log.note ? (
                <p className="mt-0.5 text-[12.5px] text-ink-2">{log.note}</p>
              ) : null}

              {log.changes.length > 0 ? (
                <ul className="mt-1.5 flex flex-col gap-1">
                  {log.changes.map((change) => (
                    <li
                      key={change.field}
                      className="rounded-md border border-line bg-surface-2 px-2 py-1 text-[12px]"
                    >
                      <span className="font-medium text-ink-2">{change.label}</span>
                      <span className="mx-1 text-ink-3">·</span>
                      <span className="text-ink-3 line-through">{value(change.from)}</span>
                      <span className="mx-1 text-ink-3">→</span>
                      <span className="text-ink">{value(change.to)}</span>
                    </li>
                  ))}
                </ul>
              ) : null}

              <p className="mt-1 text-[11.5px] text-ink-3">
                {formatDateTime(log.changed_at)}
              </p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
