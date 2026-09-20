import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useLocation } from 'react-router-dom'
import { formatApiError } from '../../api/client'
import { refinements } from '../../api/resources'
import type { RefinementNote } from '../../api/types'
import { useAuth } from '../../auth/context'
import { cx, daysSince, formatDateTime } from '../../lib/format'
import { writeScene } from '../../lib/brandScene'
import { Avatar } from '../ui/Avatar'
import { Icon } from '../ui/Icon'
import { Spinner } from '../ui/Button'
import { useToast } from '../ui/toast-context'
import { TicketWindow } from './TicketWindow'
import { usePanelGeometry, type Dock } from './usePanelGeometry'

const KINDS = [
  { value: 'improvement', label: 'Improvement', icon: 'sparkles' },
  { value: 'bug', label: 'Bug', icon: 'alert' },
  { value: 'complaint', label: 'Complaint', icon: 'coffee' },
] as const

type Kind = (typeof KINDS)[number]['value']

const GEOMETRY_KEY = 'career-tracker:refinement-log-geometry'

const DOCKS: { value: Dock; label: string; icon: string }[] = [
  { value: 'bottom-left', label: 'Dock bottom left', icon: 'chevronLeft' },
  { value: 'bottom-right', label: 'Dock bottom right', icon: 'chevronRight' },
  { value: 'right', label: 'Dock to the right edge', icon: 'panelRight' },
]

/**
 * Developer mode's refinement log — a floating panel for jotting down "this
 * annoyed me" the moment it happens, without leaving the page it happened on.
 *
 * Shaped like a chat rather than a form because the point is to lower the cost
 * of writing one down: type, hit enter, keep working. Each note records the
 * route it was written on, so a note like "this is confusing" is still
 * actionable a fortnight later.
 *
 * It reads two ways. Everyone sees their own notes. The maintainer
 * (`user.is_developer`) sees every account's and can reply that something is
 * fixed; that reply comes back to whoever raised it, which is the only reason
 * writing a complaint here is worth anyone's time.
 *
 * Resolved notes drop out of the main view rather than piling up — the panel is
 * a list of what's still wrong. "Previous complaints" shows only the fixed
 * ones, with their reply still attached.
 */
export function RefinementLog({
  onClose,
  initialTicketId = null,
}: {
  onClose: () => void
  /** Open this ticket as soon as the log mounts / the id changes. */
  initialTicketId?: number | null
}) {
  const { notify } = useToast()
  const { user } = useAuth()
  const location = useLocation()
  const isDeveloper = Boolean(user?.is_developer)

  const [notes, setNotes] = useState<RefinementNote[] | null>(null)
  const [body, setBody] = useState('')
  const [kind, setKind] = useState<Kind>('improvement')
  const [sending, setSending] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  // The developer's two views: everyone's backlog, or just their own notes.
  const [scope, setScope] = useState<'all' | 'mine'>('all')
  const [replyingTo, setReplyingTo] = useState<number | null>(null)
  const [openTicket, setOpenTicket] = useState<number | null>(initialTicketId)
  // Developer-only triage: "show me what's been waiting at least this long".
  const [minDays, setMinDays] = useState(0)
  const [screens, setScreens] = useState<{ value: string; label: string }[]>([])
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (initialTicketId != null) setOpenTicket(initialTicketId)
  }, [initialTicketId])

  // Fetched rather than hard-coded so the tag list can't drift from the one the
  // server validates against.
  useEffect(() => {
    refinements.screens().then(setScreens).catch(() => setScreens([]))
  }, [])

  const { geometry, snapPreview, startDrag, startResize, dockTo } =
    usePanelGeometry(GEOMETRY_KEY)
  // On a phone the floating, draggable panel is the wrong shape: it lands
  // half off-screen and the keyboard eats what's left. Below the `sm`
  // breakpoint it's a fixed sheet filling the screen instead — not
  // resizable, and it doesn't need to be.
  const [phone, setPhone] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches,
  )
  useEffect(() => {
    const query = window.matchMedia('(max-width: 639px)')
    const onChange = (event: MediaQueryListEvent) => setPhone(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    let cancelled = false

    function load(quiet: boolean) {
      refinements
        .list(isDeveloper ? { scope } : undefined)
        .then((rows) => {
          if (!cancelled) setNotes(rows)
        })
        .catch((err) => {
          // A failed background poll is not worth a toast — it'll try again in
          // fifteen seconds, and the list on screen is still the last good one.
          if (!quiet) notify(formatApiError(err), 'error')
        })
    }

    load(false)
    // Open ticket chat polls every second; keep the list behind it nearly as
    // fresh so status / unread badges track the same conversation.
    const timer = window.setInterval(() => load(true), openTicket ? 2_000 : 15_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [notify, isDeveloper, scope, openTicket])

  // Opening the log is the moment you've read your replies, so the unseen
  // marker clears here rather than needing a separate "dismiss".
  const unseen = useMemo(
    () => (notes ?? []).filter((note) => note.is_mine && note.resolution && !note.resolution_seen_at),
    [notes],
  )
  const acknowledged = useRef(false)
  useEffect(() => {
    if (acknowledged.current || unseen.length === 0) return
    acknowledged.current = true
    refinements.acknowledge().catch(() => {
      // Purely cosmetic — it'll clear on the next open.
      acknowledged.current = false
    })
  }, [unseen])

  // Newest note sits at the bottom, so the log reads like a conversation.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [notes, showHistory])

  // Looked up rather than held as its own copy, so a ticket open on screen
  // shows the reply the moment one arrives.
  const ticket = (notes ?? []).find((note) => note.id === openTicket) ?? null
  const open = (notes ?? []).filter((note) => note.status !== 'done')
  const resolved = (notes ?? []).filter((note) => note.status === 'done')
  // Oldest unanswered first when filtering by age: the point of the filter is
  // "what have I left sitting the longest".
  const aged = open
    .filter((note) => daysSince(note.created_at) >= minDays)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
  const visible = showHistory ? resolved : minDays > 0 ? aged : open

  function replace(saved: RefinementNote) {
    setNotes((current) => (current ?? []).map((row) => (row.id === saved.id ? saved : row)))
  }

  async function send(event: FormEvent) {
    event.preventDefault()
    if (!body.trim() || sending) return
    setSending(true)
    try {
      const saved = await refinements.create({
        body: body.trim(),
        kind,
        page: location.pathname + location.search,
      })
      setNotes((current) => [...(current ?? []), saved])
      setBody('')
    } catch (err) {
      notify(formatApiError(err), 'error')
    } finally {
      setSending(false)
    }
  }

  /** Reopening your own answered note, or a developer ticking their own note
      off directly. Closing someone *else's* note — including a plain user
      closing their own complaint with no fix attached — is the backend's
      call to block (see `perform_update`); a user withdraws a complaint by
      deleting it instead (see `remove`), not by marking it done themselves. */
  async function toggle(note: RefinementNote) {
    const next = note.status === 'done' ? 'open' : 'done'
    try {
      replace(await refinements.update(note.id, { status: next }))
    } catch (err) {
      notify(formatApiError(err), 'error')
    }
  }

  async function reply(note: RefinementNote, message: string) {
    try {
      replace(await refinements.resolve(note.id, message))
      setReplyingTo(null)
      notify(note.is_mine ? 'Marked as fixed.' : `${note.author} will see your reply.`)
    } catch (err) {
      notify(formatApiError(err), 'error')
    }
  }

  async function remove(note: RefinementNote) {
    try {
      await refinements.remove(note.id)
      setNotes((current) => (current ?? []).filter((row) => row.id !== note.id))
    } catch (err) {
      notify(formatApiError(err), 'error')
    }
  }

  return (
    <div
      className={cx(
        'glass-panel fixed z-50 flex flex-col overflow-hidden rounded-card border bg-surface/95 shadow-xl',
        // While a snap is pending, show where it's about to land.
        snapPreview ? 'border-brand ring-2 ring-brand/30' : 'border-line/80',
      )}
      style={
        phone
          ? { left: 8, right: 8, top: 8, bottom: 8, width: 'auto', height: 'auto' }
          : {
              left: geometry.x,
              top: geometry.y,
              width: geometry.width,
              height: geometry.height,
            }
      }
    >
      {/* Resize grips on the edges facing open space. A bottom-docked panel
          can't usefully be dragged from its bottom edge. */}
      {phone ? null : (
        <>
          <span
            onPointerDown={startResize('top')}
            className="absolute inset-x-3 top-0 h-1.5 cursor-ns-resize"
            aria-hidden
          />
          <span
            onPointerDown={startResize('left')}
            className="absolute inset-y-3 left-0 w-1.5 cursor-ew-resize"
            aria-hidden
          />
          <span
            onPointerDown={startResize('corner')}
            className="absolute left-0 top-0 size-3 cursor-nwse-resize"
            aria-hidden
          />
        </>
      )}

      <header
        onPointerDown={phone ? undefined : startDrag}
        className={cx(
          'flex items-center gap-2 border-b border-line px-3 py-2',
          !phone && 'cursor-grab active:cursor-grabbing',
        )}
      >
        <span className="grid size-6 place-items-center rounded-md bg-brand-soft text-brand-strong">
          <Icon name="tools" size={13} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-ink">
            {isDeveloper && scope === 'all' ? 'Refinement inbox' : 'Refinement log'}
          </p>
          <p className="truncate text-[11px] text-ink-3">
            {open.length} open {open.length === 1 ? 'item' : 'items'}
            {unseen.length > 0 ? ` · ${unseen.length} new reply` : ''}
          </p>
        </div>

        {isDeveloper ? (
          <>
            <button
              type="button"
              onClick={() => setScope((value) => (value === 'all' ? 'mine' : 'all'))}
              className="rounded-full bg-surface-2 px-2 py-0.5 text-[10.5px] font-medium text-ink-2 transition-colors hover:text-ink"
            >
              {scope === 'all' ? 'Everyone' : 'Just me'}
            </button>
            <select
              value={minDays}
              onChange={(event) => setMinDays(Number(event.target.value))}
              aria-label="Filter by how long a ticket has been waiting"
              title="How long it's been waiting"
              className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[10.5px] font-medium text-ink-2 outline-none"
            >
              <option value={0}>Any age</option>
              <option value={1}>1 day+</option>
              <option value={3}>3 days+</option>
              <option value={7}>7 days+</option>
            </select>
          </>
        ) : null}

        <div className="flex items-center">
          {DOCKS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => dockTo(option.value)}
              aria-label={option.label}
              title={option.label}
              className={cx(
                'rounded-lg p-1 transition-colors hover:bg-surface-2',
                geometry.dock === option.value ? 'text-brand' : 'text-ink-3',
              )}
            >
              <Icon name={option.icon} size={12} />
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close refinement log"
          className="rounded-lg p-1.5 text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <Icon name="close" size={14} />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-3 py-2.5">
        {notes === null ? (
          <div className="grid h-full place-items-center">
            <Spinner className="size-4" />
          </div>
        ) : visible.length === 0 ? (
          <p className="py-8 text-center text-[12.5px] text-ink-3">
            {showHistory
              ? 'Nothing here yet.'
              : 'Nothing open. Jot down anything that felt off and come back to it later.'}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {visible.map((note) => (
              <NoteRow
                key={note.id}
                note={note}
                isDeveloper={isDeveloper}
                replying={replyingTo === note.id}
                onStartReply={() => setReplyingTo(note.id)}
                onCancelReply={() => setReplyingTo(null)}
                onReply={(message) => void reply(note, message)}
                onToggle={() => void toggle(note)}
                onDelete={() => void remove(note)}
                onOpenTicket={() => setOpenTicket(note.id)}
              />
            ))}
          </ul>
        )}
        <div ref={endRef} />
      </div>

      {resolved.length > 0 ? (
        <button
          type="button"
          onClick={() => setShowHistory((value) => !value)}
          className="border-t border-line px-3 py-1.5 text-left text-[11.5px] font-medium text-brand transition-colors hover:bg-surface-2"
        >
          {showHistory
            ? 'Hide previous complaints'
            : `View all previous complaints (${resolved.length})`}
        </button>
      ) : null}

      <form onSubmit={send} className="border-t border-line p-2.5">
        <div className="mb-1.5 flex gap-1">
          {KINDS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setKind(option.value)}
              aria-pressed={kind === option.value}
              className={cx(
                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors',
                kind === option.value
                  ? 'bg-brand-soft text-brand-strong'
                  : 'text-ink-3 hover:text-ink',
              )}
            >
              <Icon name={option.icon} size={11} />
              {option.label}
            </button>
          ))}
        </div>
        <div className="flex items-end gap-2">
          <textarea
            value={body}
            onChange={(event) => {
              const next = event.target.value
              setBody(next)
              // Undocumented: a word typed here switches the logo to its bear.
              if (/abeoji$/i.test(next)) writeScene('lotso')
            }}
            onKeyDown={(event) => {
              // Enter sends, shift+enter breaks the line — the log is for
              // one-liners, and reaching for a button each time adds friction.
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void send(event)
              }
            }}
            rows={2}
            placeholder="What should be better?"
            aria-label="Refinement note"
            className="flex-1 resize-none rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-[12.5px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-brand"
          />
          <button
            type="submit"
            disabled={!body.trim() || sending}
            aria-label="Log it"
            className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand text-white transition-opacity disabled:opacity-40"
          >
            {sending ? <Spinner className="size-3.5" /> : <Icon name="arrowRight" size={14} />}
          </button>
        </div>
      </form>

      {ticket ? (
        <TicketWindow
          // Keyed so opening a different ticket starts from its own text
          // rather than inheriting the last one's draft.
          key={ticket.id}
          note={ticket}
          screens={screens}
          isDeveloper={isDeveloper}
          onClose={() => setOpenTicket(null)}
          onChange={replace}
          onRead={() =>
            setNotes((current) =>
              (current ?? []).map((row) =>
                row.id === ticket.id ? { ...row, unread_count: 0 } : row,
              ),
            )
          }
        />
      ) : null}
    </div>
  )
}

function NoteRow({
  note,
  isDeveloper,
  replying,
  onStartReply,
  onCancelReply,
  onReply,
  onToggle,
  onDelete,
  onOpenTicket,
}: {
  note: RefinementNote
  isDeveloper: boolean
  replying: boolean
  onStartReply: () => void
  onCancelReply: () => void
  onReply: (message: string) => void
  onToggle: () => void
  onDelete: () => void
  onOpenTicket: () => void
}) {
  const [draft, setDraft] = useState('')
  const done = note.status === 'done'
  const isNewReply = note.is_mine && Boolean(note.resolution) && !note.resolution_seen_at
  // Reopening an answered ticket is always the reporter's call either way;
  // marking one done with no reply attached is the developer's only, even on
  // their own note — a plain user closes a complaint by deleting it, not by
  // ticking it off (see `perform_update` on the backend, which enforces this
  // regardless of what the UI allows).
  const canToggle = note.is_mine && (done || isDeveloper)

  return (
    <li
      className={cx(
        'glass-panel group/note rounded-xl border px-3 py-2.5 shadow-sm',
        isNewReply
          ? 'border-brand/50 bg-brand-soft/80'
          : 'border-line/70 bg-surface-2/75',
        done && !isNewReply && 'opacity-60',
      )}
    >
      <div className="flex items-start gap-2.5">
        <button
          type="button"
          onClick={onToggle}
          disabled={!canToggle}
          aria-label={done ? 'Reopen' : 'Mark as done'}
          title={!canToggle && !done ? 'Only a developer can mark this done' : undefined}
          className={cx(
            'mt-1 grid size-4 shrink-0 place-items-center rounded border transition-colors',
            done
              ? 'border-good bg-good text-white'
              : 'border-line-strong text-transparent hover:border-brand',
            !canToggle && 'cursor-not-allowed opacity-50 hover:border-line-strong',
          )}
        >
          <Icon name="check" size={10} />
        </button>

        <div className="min-w-0 flex-1">
          {/* Ticket id + kind sit with the date so the title isn't stranded
              above a sparse meta row. */}
          <div className="flex items-baseline justify-between gap-3">
            <button
              type="button"
              onClick={onOpenTicket}
              title={`Open ticket #${note.id}`}
              className="flex min-w-0 items-baseline gap-1.5 text-left hover:underline"
            >
              <span className="shrink-0 rounded-md border border-line/60 bg-surface/70 px-1.5 py-0.5 font-mono text-[10.5px] font-semibold tabular-nums text-ink-2">
                #{note.id}
              </span>
              <span className="truncate text-[11px] font-medium text-ink-3">
                {note.kind_display}
                {note.status !== 'open' && note.status !== 'done'
                  ? ` · ${note.status_display}`
                  : ''}
              </span>
            </button>
            <time
              dateTime={note.created_at}
              title={formatDateTime(note.created_at)}
              className="shrink-0 text-[10.5px] tabular-nums text-ink-3"
            >
              {formatDateTime(note.created_at)}
            </time>
          </div>

          {/* The body is the ticket's front door — the whole row would be a
              bigger target, but it already carries a checkbox and a delete. */}
          <button
            type="button"
            onClick={onOpenTicket}
            title={`Open ticket #${note.id}`}
            className="mt-1.5 w-full whitespace-pre-wrap break-words text-left text-[12.5px] leading-snug text-ink hover:underline"
          >
            {note.body}
          </button>

          {(note.screen_labels.length > 0 || !note.is_mine) ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {!note.is_mine ? (
                <span className="flex items-center gap-1 rounded-full border border-line/50 bg-surface/60 py-0.5 pl-0.5 pr-1.5 text-[10.5px] font-medium text-ink-2">
                  <Avatar name={note.author} src={note.author_avatar} size="xxs" />
                  {note.author}
                </span>
              ) : null}
              {note.screen_labels.map((label) => (
                <span
                  key={label}
                  className="rounded-full border border-line/50 bg-surface/55 px-1.5 py-0.5 text-[10.5px] text-ink-2"
                >
                  {label}
                </span>
              ))}
            </div>
          ) : null}

          {note.resolution ? (
            <div className="mt-2 rounded-lg border border-line/60 bg-surface/70 px-2 py-1.5 backdrop-blur-sm">
              <p className="text-[11px] font-medium text-good">
                {isNewReply ? 'Fixed — new reply' : 'Fixed'}
                {note.resolved_by_name ? ` · ${note.resolved_by_name}` : ''}
              </p>
              <p className="mt-0.5 whitespace-pre-wrap break-words text-[12px] text-ink-2">
                {note.resolution}
              </p>
            </div>
          ) : null}

          {/* Marking fixed is the developer's move, whether it's someone
              else's note or their own — a reporter closing their own
              complaint this way is the same loophole the checkbox above is
              blocked for, just with an extra message attached. */}
          {!done && isDeveloper ? (
            replying ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault()
                  if (draft.trim()) onReply(draft.trim())
                }}
                className="mt-2 flex items-end gap-1.5"
              >
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  autoFocus
                  rows={2}
                  placeholder="What did you change?"
                  aria-label="Reply"
                  className="flex-1 resize-none rounded-lg border border-line bg-surface/80 px-2 py-1 text-[12px] text-ink outline-none focus:border-brand"
                />
                <button
                  type="submit"
                  disabled={!draft.trim()}
                  className="rounded-lg bg-good px-2 py-1 text-[11px] font-medium text-white disabled:opacity-40"
                >
                  Send
                </button>
                <button
                  type="button"
                  onClick={onCancelReply}
                  className="rounded-lg px-1.5 py-1 text-[11px] text-ink-3 hover:text-ink"
                >
                  Cancel
                </button>
              </form>
            ) : (
              <button
                type="button"
                onClick={onStartReply}
                className="mt-1.5 text-[11px] font-medium text-brand hover:underline"
              >
                Mark fixed &amp; reply
              </button>
            )
          ) : null}
        </div>

        {note.is_mine ? (
          <button
            type="button"
            onClick={onDelete}
            aria-label="Delete note"
            className="shrink-0 rounded p-1 text-ink-3 opacity-0 transition-opacity hover:text-critical focus:opacity-100 group-hover/note:opacity-100"
          >
            <Icon name="trash" size={12} />
          </button>
        ) : null}
      </div>
    </li>
  )
}
