import { useEffect, useRef, useState } from 'react'
import { formatApiError } from '../../api/client'
import { refinements } from '../../api/resources'
import type { RefinementNote } from '../../api/types'
import { cx, daysSince, formatDateTime } from '../../lib/format'
import { TicketActivity } from './TicketChat'
import { Avatar } from '../ui/Avatar'
import { Icon } from '../ui/Icon'
import { MentionTextarea } from '../ui/Mention'
import { Modal } from '../ui/Modal'
import { useToast } from '../ui/toast-context'
import { RichText } from '../../lib/richText'

/** Same chip size as Settings → Liquid glass stops (Off / Light / …). */
const FOOTER_CHIP =
  'rounded-lg px-2.5 py-1 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40'

type Tab = 'description' | 'activity'

/**
 * One refinement note, opened as a ticket.
 *
 * Sticky status on top, then Description / Activity. Description is the report
 * itself (text + screens). Activity is the living record — chat and status
 * events on one timeline — so you don't bounce between two panes to follow
 * what happened.
 */
export function TicketWindow({
  note,
  screens,
  isDeveloper,
  onClose,
  onChange,
  onRead,
}: {
  note: RefinementNote
  screens: { value: string; label: string }[]
  isDeveloper: boolean
  onClose: () => void
  onChange: (saved: RefinementNote) => void
  onRead?: () => void
}) {
  const { notify } = useToast()
  const [body, setBody] = useState(note.body)
  const [tags, setTags] = useState<string[]>(note.screens)
  const [saving, setSaving] = useState(false)
  const [tab, setTab] = useState<Tab>('activity')
  const guardedCloseRef = useRef<(() => void) | null>(null)

  // Any live ticket the reporter owns stays editable — not only `open`,
  // Testing / Awaiting validation too. Done (closed or fixed) stays read-only
  // until they reopen.
  const editable = note.is_mine && note.status !== 'done'
  const dirty = body.trim() !== note.body || !sameTags(tags, note.screens)
  const canReopen = note.is_mine && note.status === 'done' && note.is_locked
  const showSave = editable && (tab === 'description' || dirty)

  // Older rows can be status=open while still carrying a leftover resolution,
  // which made screens look dead. Nudge the server once so the lock clears.
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  useEffect(() => {
    if (!(note.is_mine && note.status === 'open' && note.is_locked)) return
    let cancelled = false
    refinements
      .update(note.id, { status: 'open' })
      .then((saved) => {
        if (!cancelled) onChangeRef.current(saved)
      })
      .catch(() => {
        /* keep the local copy; the next Save will retry */
      })
    return () => {
      cancelled = true
    }
  }, [note.id, note.is_mine, note.is_locked, note.status])

  // Only reset the draft when switching tickets. The log polls every couple of
  // seconds while a ticket is open; depending on `note.body` / `note.screens`
  // here wiped the textarea after one keystroke (screens is a fresh array
  // every poll even when unchanged).
  useEffect(() => {
    setBody(note.body)
    setTags(note.screens)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally note.id only
  }, [note.id])

  async function save() {
    if (!dirty || !body.trim()) return
    setSaving(true)
    try {
      const saved = await refinements.update(note.id, { body: body.trim(), screens: tags })
      onChange(saved)
      notify('Ticket updated.')
    } catch (err) {
      notify(formatApiError(err), 'error')
    } finally {
      setSaving(false)
    }
  }

  async function reopen() {
    try {
      onChange(await refinements.update(note.id, { status: 'open' }))
      notify('Reopened — it can be edited again.')
    } catch (err) {
      notify(formatApiError(err), 'error')
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      dirty={dirty}
      guardedCloseRef={guardedCloseRef}
      size="lg"
      title={`Ticket #${note.id}`}
      description={`${note.kind_display} · raised ${formatDateTime(note.created_at)}`}
      bodyClassName="flex h-[min(68dvh,620px)] max-h-[calc(92dvh-9rem)] flex-col overflow-hidden p-0"
      footerClassName="border-line/60 bg-surface/55 backdrop-blur-xl intern:bg-surface/40"
      footer={
        <>
          <button
            type="button"
            onClick={() => guardedCloseRef.current?.()}
            className={cx(
              FOOTER_CHIP,
              'border border-line/70 bg-surface/70 text-ink-2 backdrop-blur-md hover:bg-surface hover:text-ink',
            )}
          >
            Close
          </button>
          {canReopen ? (
            <button
              type="button"
              onClick={() => void reopen()}
              className={cx(
                FOOTER_CHIP,
                'border border-line/70 bg-surface/50 text-ink-2 backdrop-blur-md hover:bg-surface hover:text-ink',
              )}
            >
              Reopen
            </button>
          ) : null}
          {showSave ? (
            <button
              type="button"
              disabled={!dirty || !body.trim() || saving}
              onClick={() => void save()}
              className={cx(FOOTER_CHIP, 'bg-brand text-white hover:bg-brand-strong')}
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          ) : null}
        </>
      }
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="shrink-0 px-5 pt-3">
          {!note.is_mine ? (
            <div className="mb-2 flex items-center gap-2">
              <Avatar name={note.author} src={note.author_avatar} size="xs" />
              <span className="text-[12.5px] font-medium text-ink">{note.author}</span>
            </div>
          ) : null}
          <StatusBanner
            note={note}
            isDeveloper={isDeveloper}
            onStatusChange={onChange}
          />
          <div className="mt-2 flex gap-4 border-b border-line/70">
            {(
              [
                { id: 'description', label: 'Description' },
                { id: 'activity', label: 'Activity' },
              ] as const
            ).map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setTab(option.id)}
                aria-pressed={tab === option.id}
                className={cx(
                  'border-b-2 pb-2 text-[13px] font-semibold transition-colors',
                  tab === option.id
                    ? 'border-brand text-brand'
                    : 'border-transparent text-ink-3 hover:text-ink',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-5 py-3">
          {tab === 'description' ? (
            <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2">
              {editable ? (
                <MentionTextarea
                  label="What was reported"
                  value={body}
                  onChange={setBody}
                  rows={5}
                  placeholder="Describe what should be better…"
                  className="bg-transparent"
                />
              ) : (
                <>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-ink-3">
                    What was reported
                  </p>
                  <RichText text={note.body} className="mt-1 text-[13px] text-ink" />
                </>
              )}

              <p className="mt-4 text-[11px] font-medium uppercase tracking-wide text-ink-3">
                Screens affected
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {screens.map((screen) => {
                  const on = tags.includes(screen.value)
                  return (
                    <button
                      key={screen.value}
                      type="button"
                      disabled={!editable || saving}
                      aria-pressed={on}
                      onClick={() => {
                        if (!editable || saving) return
                        setTags((current) =>
                          on
                            ? current.filter((value) => value !== screen.value)
                            : [...current, screen.value],
                        )
                      }}
                      className={cx(
                        'rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors',
                        on
                          ? 'border-brand bg-brand-soft text-brand-strong'
                          : 'border-line/80 text-ink-3 hover:border-line-strong hover:text-ink',
                        (!editable || saving) && 'cursor-not-allowed opacity-50',
                      )}
                    >
                      {screen.label}
                    </button>
                  )
                })}
              </div>

              {canReopen ? (
                <p className="mt-3 text-[11.5px] text-ink-3">
                  Answered tickets can't be edited. Reopen it if it isn't actually fixed.
                </p>
              ) : null}
            </div>
          ) : (
            <TicketActivity note={note} onRead={onRead} className="min-h-0 flex-1" />
          )}
        </div>
      </div>
    </Modal>
  )
}

const DEV_STATUSES = [
  { value: 'open' as const, label: 'Open' },
  { value: 'testing' as const, label: 'Testing' },
  { value: 'awaiting_validation' as const, label: 'Awaiting validation' },
]

function statusHeadline(note: RefinementNote) {
  const fixed = note.status === 'done' && Boolean(note.resolution)
  const closed = note.status === 'done' && !note.resolution
  const reopened =
    note.status === 'open' &&
    (note.event_logs ?? []).some((event) => event.event_type === 'reopened')

  if (fixed) return { title: 'Fixed', kind: 'fixed' as const }
  if (closed) return { title: 'Closed by you', kind: 'closed' as const }
  if (note.status === 'testing') return { title: 'Testing', kind: 'workflow' as const }
  if (note.status === 'awaiting_validation') {
    return { title: 'Awaiting validation', kind: 'workflow' as const }
  }
  if (reopened) {
    return { title: 'Reopened — waiting on the developer', kind: 'open' as const }
  }
  return { title: 'Open — waiting on the developer', kind: 'open' as const }
}

function StatusBanner({
  note,
  isDeveloper,
  onStatusChange,
}: {
  note: RefinementNote
  isDeveloper: boolean
  onStatusChange: (saved: RefinementNote) => void
}) {
  const { notify } = useToast()
  const [busy, setBusy] = useState(false)
  // Done needs a word on what changed before it closes — that reply is the
  // notification the reporter gets, so it can't be an empty tick.
  const [closing, setClosing] = useState(false)
  const [resolution, setResolution] = useState('')
  const headline = statusHeadline(note)
  const fixed = headline.kind === 'fixed'
  const closed = headline.kind === 'closed'
  const waitingDays = daysSince(note.created_at)
  const canSetStatus = isDeveloper && note.status !== 'done'

  async function markDone() {
    const message = resolution.trim()
    if (!message || busy) return
    setBusy(true)
    try {
      onStatusChange(await refinements.resolve(note.id, message))
      notify('Marked as done — the reporter has been told.')
      setClosing(false)
      setResolution('')
    } catch (err) {
      notify(formatApiError(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function setStatus(next: (typeof DEV_STATUSES)[number]['value']) {
    if (next === note.status || busy) return
    setBusy(true)
    try {
      onStatusChange(await refinements.setStatus(note.id, next))
      notify(
        next === 'open'
          ? 'Status set to Open.'
          : next === 'testing'
            ? 'Status set to Testing.'
            : 'Status set to Awaiting validation.',
      )
    } catch (err) {
      notify(formatApiError(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className={cx(
        'rounded-xl border border-line/70 bg-surface-2/75 px-3 py-2.5 backdrop-blur-md',
        fixed && 'border-good/40',
        headline.kind === 'workflow' && 'border-warning/35',
      )}
    >
      <p className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
        <Icon
          name={fixed || closed ? 'check' : 'clock'}
          size={14}
          className={
            fixed ? 'text-good' : headline.kind === 'workflow' ? 'text-warning' : 'text-ink-3'
          }
        />
        {headline.title}
        {!fixed && !closed ? <span className="typing-dots" aria-hidden="true" /> : null}
      </p>
      {fixed && note.resolution ? (
        <>
          <p className="mt-1 whitespace-pre-wrap break-words text-[12.5px] text-ink-2">
            {note.resolution}
          </p>
          <p className="mt-1 text-[11px] text-ink-3">
            {note.resolved_by_name ?? 'Developer'}
            {note.resolved_at ? ` · ${formatDateTime(note.resolved_at)}` : ''}
          </p>
        </>
      ) : (
        <p className="mt-0.5 text-[12px] text-ink-3">
          {closed
            ? 'You ticked this off yourself.'
            : note.status === 'testing'
              ? 'In testing — confirm it works, then move it on or mark it fixed.'
              : note.status === 'awaiting_validation'
                ? 'Waiting on the reporter to confirm the fix.'
                : headline.kind === 'open' &&
                    (note.event_logs ?? []).some((event) => event.event_type === 'reopened')
                  ? 'Previous fix is in Activity. Say what still needs doing there.'
                  : "You'll get a reply in Activity when it's been dealt with."}
        </p>
      )}

      {canSetStatus ? (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {DEV_STATUSES.map((option) => {
            const on = note.status === option.value
            return (
              <button
                key={option.value}
                type="button"
                disabled={busy}
                aria-pressed={on}
                onClick={() => void setStatus(option.value)}
                className={cx(
                  'rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors',
                  on
                    ? 'border-brand bg-brand-soft text-brand-strong'
                    : 'border-line/80 text-ink-3 hover:border-line-strong hover:text-ink',
                  busy && 'opacity-50',
                )}
              >
                {option.label}
              </button>
            )
          })}
          <button
            type="button"
            disabled={busy}
            aria-pressed={closing}
            onClick={() => setClosing((value) => !value)}
            className={cx(
              'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors',
              closing
                ? 'border-good bg-good/10 text-good'
                : 'border-line/80 text-ink-3 hover:border-good hover:text-good',
              busy && 'opacity-50',
            )}
          >
            <Icon name="check" size={11} />
            Done
          </button>
        </div>
      ) : null}

      {canSetStatus && closing ? (
        <div className="mt-2.5 rounded-lg border border-good/30 bg-surface p-2.5">
          <MentionTextarea
            label="What changed?"
            rows={3}
            value={resolution}
            onChange={setResolution}
            placeholder="Say what you fixed or why it's closing — this is the reply they'll see."
          />
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setClosing(false)}
              className="rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-ink-2 hover:bg-surface-2"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!resolution.trim() || busy}
              onClick={() => void markDone()}
              className="rounded-lg bg-good px-3 py-1.5 text-[12px] font-medium text-white shadow-sm disabled:opacity-50"
            >
              Mark done & reply
            </button>
          </div>
        </div>
      ) : null}

      {isDeveloper && !fixed && !closed ? (
        <p
          className={cx(
            'mt-1.5 text-[11px] font-medium',
            waitingDays >= 7 ? 'text-critical' : waitingDays >= 3 ? 'text-warning' : 'text-ink-3',
          )}
        >
          Open for{' '}
          {waitingDays === 0 ? 'less than a day' : `${waitingDays} day${waitingDays === 1 ? '' : 's'}`}
        </p>
      ) : null}
    </div>
  )
}

function sameTags(a: string[], b: string[]) {
  if (a.length !== b.length) return false
  const other = new Set(b)
  return a.every((value) => other.has(value))
}
