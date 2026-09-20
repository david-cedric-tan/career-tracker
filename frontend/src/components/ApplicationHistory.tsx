import { useState, type FormEvent } from 'react'
import { formatApiError } from '../api/client'
import { applicationStages, applications } from '../api/resources'
import type { Application, EventLog } from '../api/types'
import { useResource } from '../hooks/useResource'
import { cx, formatDate, formatDateTime } from '../lib/format'
import { Button } from './ui/Button'
import { ConfirmDelete } from './ui/ConfirmDelete'
import { Combobox } from './ui/Combobox'
import { Input, Textarea } from './ui/Field'
import { Icon } from './ui/Icon'
import { Modal } from './ui/Modal'
import { useToast } from './ui/toast-context'

const EVENT_STYLE: Record<
  string,
  { icon: string; dot: string; ring: string }
> = {
  created: { icon: 'plus', dot: 'bg-ink-3', ring: 'ring-surface-2' },
  stage: { icon: 'arrowRight', dot: 'bg-brand', ring: 'ring-brand-soft' },
  outcome: { icon: 'check', dot: 'bg-good', ring: 'ring-good/15' },
  edited: { icon: 'edit', dot: 'bg-ink-3', ring: 'ring-surface-2' },
  // Finished on your side — solid green tick before the temporary wait.
  stage_done: { icon: 'check', dot: 'bg-good', ring: 'ring-good/15' },
  // Softer than a stage move on purpose: waiting is a state the application
  // sits in, not a step it took. Hollow rather than filled, so a run of them
  // never competes with the transitions either side.
  waiting_started: {
    icon: 'clock',
    dot: 'bg-transparent text-warning ring-inset ring-2 ring-warning/60',
    ring: 'ring-surface-2',
  },
  waiting_ended: {
    icon: 'mail',
    dot: 'bg-transparent text-ink-3 ring-inset ring-2 ring-line-strong',
    ring: 'ring-surface-2',
  },
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
    case 'stage_done':
      return (
        <>
          <span className="text-good">Finished</span>{' '}
          <strong className="font-semibold">{log.curr_stage_display}</strong>
        </>
      )
    case 'waiting_started':
      return (
        <>
          <span
            className={cx(
              'inline-flex items-center rounded-full border border-warning/30 bg-warning/15',
              'px-2 py-0.5 text-[12px] font-medium text-[#8a5d00] dark:text-warning',
            )}
          >
            Waiting For Response
          </span>
          <span className="text-ink-3"> for {log.curr_stage_display}</span>
        </>
      )
    case 'waiting_ended':
      return <span className="text-ink-2">Response received</span>
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
 * Field edits are hidden by default. Nothing is discarded — every save is
 * still recorded and one click away — but the question this panel is usually
 * opened to answer is "where did this application get to", and a run of
 * "Edited · Roles" rows for tidying up a listing buries the two stage moves
 * that actually matter.
 */
export function ApplicationHistory({
  logs,
  applicationId,
  onChanged,
}: {
  logs: EventLog[]
  /** Omit both to render the timeline read-only. */
  applicationId?: number
  onChanged?: (application: Application) => void
}) {
  const [showEdits, setShowEdits] = useState(false)
  const [editing, setEditing] = useState<EventLog | null>(null)
  const [deleting, setDeleting] = useState<EventLog | null>(null)
  const editable = applicationId !== undefined && onChanged !== undefined

  if (logs.length === 0) {
    return <p className="mt-3 text-[13px] text-ink-3">Nothing recorded yet.</p>
  }

  const ordered = [...logs].sort((a, b) => b.changed_at.localeCompare(a.changed_at))
  const visible = showEdits ? ordered : ordered.filter((log) => log.event_type !== 'edited')
  const hidden = ordered.length - visible.length

  return (
    <>
      {hidden > 0 || showEdits ? (
        <button
          type="button"
          onClick={() => setShowEdits((value) => !value)}
          className="mt-2 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-brand transition-colors hover:underline"
        >
          <Icon name={showEdits ? 'minus' : 'plus'} size={13} />
          {showEdits
            ? 'Hide field edits'
            : `Show ${hidden} field edit${hidden === 1 ? '' : 's'}`}
        </button>
      ) : null}

      {visible.length === 0 ? (
        <p className="mt-3 text-[13px] text-ink-3">
          No stage moves yet — only field edits, hidden above.
        </p>
      ) : (
        <ol className="mt-4 flex flex-col">
      {visible.map((log, index) => {
        const style = EVENT_STYLE[log.event_type] ?? EVENT_STYLE.edited
        const last = index === visible.length - 1

        return (
          <li key={log.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span
                className={cx(
                  'mt-1 grid size-5 shrink-0 place-items-center rounded-full ring-4',
                  // Hollow markers bring their own colour; filled ones are white.
                  style.dot.includes('bg-transparent') ? '' : 'text-white',
                  style.dot,
                  style.ring,
                )}
              >
                <Icon name={style.icon} size={11} />
              </span>
              {last ? null : <span className="w-px flex-1 bg-line" />}
            </div>

            <div className={cx('group/log min-w-0 flex-1', last ? 'pb-1' : 'pb-4')}>
              <div className="flex items-start gap-2">
                <p className="min-w-0 flex-1 text-[13.5px] text-ink">{headline(log)}</p>
                {/* Correcting a mistyped date shouldn't mean deleting the row
                    and re-logging it. Hidden until hover so the timeline still
                    reads as a record rather than a form. */}
                {editable ? (
                  <span className="flex shrink-0 items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover/log:opacity-100">
                    <button
                      type="button"
                      onClick={() => setEditing(log)}
                      aria-label="Edit this entry"
                      className="rounded p-1 text-ink-3 transition-colors hover:text-brand"
                    >
                      <Icon name="edit" size={12} />
                    </button>
                    {log.event_type === 'created' ? null : (
                      <button
                        type="button"
                        onClick={() => setDeleting(log)}
                        aria-label="Delete this entry"
                        className="rounded p-1 text-ink-3 transition-colors hover:text-critical"
                      >
                        <Icon name="trash" size={12} />
                      </button>
                    )}
                  </span>
                ) : null}
              </div>

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
      )}

      {editable && editing ? (
        <EditEventModal
          applicationId={applicationId}
          event={editing}
          onClose={() => setEditing(null)}
          onChanged={onChanged}
        />
      ) : null}

      {editable && deleting ? (
        <ConfirmDelete
          open
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            onChanged(await applications.removeEvent(applicationId, deleting.id))
          }}
          kind="history entry"
          name={deleting.event_type === 'stage' ? `Moved to ${deleting.curr_stage_display}` : null}
          consequence="The application itself is not affected."
        />
      ) : null}
    </>
  )
}

/** `changed_at` as a `datetime-local` value, in the viewer's own timezone. */
function toLocalInput(iso: string): string {
  const when = new Date(iso)
  const pad = (value: number) => String(value).padStart(2, '0')
  return (
    `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}` +
    `T${pad(when.getHours())}:${pad(when.getMinutes())}`
  )
}

/** Only the things a person can actually get wrong: when it happened, what
    they wrote, and — for waiting / stage-done rows — which stage it refers to.

    Time as well as date, because the timeline sorts on the full timestamp: two
    events on the same day are ordered by their clock time, so "finished the
    assessment centre" can otherwise end up filed above the move that led to
    it. */
function EditEventModal({
  applicationId,
  event,
  onClose,
  onChanged,
}: {
  applicationId: number
  event: EventLog
  onClose: () => void
  onChanged: (application: Application) => void
}) {
  const { notify } = useToast()
  const [when, setWhen] = useState(() => toLocalInput(event.changed_at))
  const [note, setNote] = useState(event.note)
  const [stage, setStage] = useState(event.curr_stage)
  const [saving, setSaving] = useState(false)
  const canRetargetStage =
    event.event_type === 'waiting_started' || event.event_type === 'stage_done'

  const stageList = useResource(() => applicationStages.list(), [])
  const stageRows = stageList.data ?? []
  const stageOptions = stageRows.map((row) => ({ id: row.id, label: row.name }))
  const stageOptionId = stageRows.find((row) => row.key === stage)?.id ?? null

  async function onSubmit(submitEvent: FormEvent) {
    submitEvent.preventDefault()
    setSaving(true)
    try {
      onChanged(
        await applications.updateEvent(applicationId, event.id, {
          // Absolute, so the server stores the instant the viewer meant rather
          // than reinterpreting a naive local time in its own timezone.
          changed_at: new Date(when).toISOString(),
          note,
          ...(canRetargetStage ? { stage } : {}),
        }),
      )
      notify('History entry updated.')
      onClose()
    } catch (err) {
      notify(formatApiError(err), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Correct this entry"
      footer={
        <>
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="edit-event-form" variant="primary" loading={saving}>
            Save
          </Button>
        </>
      }
    >
      <form id="edit-event-form" onSubmit={onSubmit} className="flex flex-col gap-4">
        <p className="text-[13px] text-ink-2">{headline(event)}</p>
        <Input
          label="When it happened"
          type="datetime-local"
          required
          autoFocus={!canRetargetStage}
          value={when}
          onChange={(changeEvent) => setWhen(changeEvent.target.value)}
        />
        {canRetargetStage ? (
          <Combobox
            label={
              event.event_type === 'waiting_started'
                ? 'Waiting for which stage'
                : 'Stage that was finished'
            }
            value={stageOptionId}
            options={stageOptions}
            onChange={(id) => {
              const next = stageRows.find((row) => row.id === id)?.key
              if (next) setStage(next)
            }}
          />
        ) : null}
        <Textarea
          label="Note"
          value={note}
          onChange={(changeEvent) => setNote(changeEvent.target.value)}
        />
      </form>
    </Modal>
  )
}
