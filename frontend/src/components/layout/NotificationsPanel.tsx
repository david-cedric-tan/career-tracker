import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { dashboard, refinements } from '../../api/resources'
import type { Attention, RefinementNote } from '../../api/types'
import { useAuth } from '../../auth/context'
import {
  dismissFiredAlert,
  readFiredAlerts,
  subscribeFiredAlerts,
} from '../../lib/firedAlerts'
import { cx, formatDate, relativeDay, relativeTime } from '../../lib/format'
import { useResource } from '../../hooks/useResource'
import { Icon } from '../ui/Icon'
import { Loading } from '../ui/States'

type Feed = 'normal' | 'tickets'

type Item = {
  key: string
  icon: string
  title: string
  meta: string
  /** ISO date for a due-soon item; ISO timestamp for a fired alert / ticket. */
  date: string
  to?: string
  ticketId?: number
  /** A fired reminder is history, not something coming up — it dismisses
      out of its own store rather than the due-soon dismissal map. */
  kind: 'attention' | 'alert' | 'ticket'
}

const FEED_KEY = 'notificationsFeed'

function readFeed(): Feed {
  try {
    return localStorage.getItem(FEED_KEY) === 'tickets' ? 'tickets' : 'normal'
  } catch {
    return 'normal'
  }
}

function writeFeed(feed: Feed) {
  try {
    localStorage.setItem(FEED_KEY, feed)
  } catch {
    /* preference only */
  }
}

/** Flattens the four attention buckets into one dated, sorted feed. */
function toItems(data: Attention | null): Item[] {
  if (!data) return []
  const items: Item[] = [
    ...data.follow_ups.map((entry) => ({
      key: `follow-${entry.id}`,
      kind: 'attention' as const,
      icon: 'briefcase',
      title: entry.company,
      meta: `Follow-up · ${entry.stage}`,
      date: entry.follow_up_date,
      to: `/applications/${entry.id}`,
    })),
    ...data.chats.map((entry) => ({
      key: `chat-${entry.id}`,
      kind: 'attention' as const,
      icon: 'users',
      title: entry.full_name,
      meta: `Catch-up due · ${entry.status}`,
      date: entry.next_chat_at,
      to: `/network/${entry.id}`,
    })),
    ...data.tasks.map((entry) => ({
      key: `task-${entry.id}`,
      kind: 'attention' as const,
      icon: 'checklist',
      title: entry.title,
      meta: `Todo · ${entry.priority}`,
      date: entry.due_date,
      to: '/todos',
    })),
    ...data.reapplies.map((entry) => ({
      key: `reapply-${entry.id}`,
      kind: 'attention' as const,
      icon: 'calendar',
      title: entry.company,
      meta: `Reapply · ${entry.outcome}`,
      date: entry.reapply_at,
      to: `/applications/${entry.id}`,
    })),
  ]
  return items.sort((a, b) => a.date.localeCompare(b.date))
}

/** Ticket rows that need this viewer's attention — fix replies, chat, or
 *  (for the developer) brand-new filings they've never opened. */
function toTicketItems(notes: RefinementNote[] | null): Item[] {
  if (!notes) return []
  const items: Item[] = []
  for (const note of notes) {
    if (!note.needs_attention) continue
    const snippet = note.body.trim().slice(0, 48) || `Ticket #${note.id}`
    const fixedUnseen =
      note.is_mine && Boolean(note.resolution) && !note.resolution_seen_at
    const unreadChat = note.unread_count > 0
    let title: string
    let meta: string
    let icon: string
    let date: string

    if (fixedUnseen) {
      title = snippet
      meta = `Fixed · ${note.resolved_by_name ?? 'Developer'}`
      icon = 'check'
      date = note.resolved_at ?? note.updated_at
    } else if (unreadChat && note.last_message) {
      title = snippet
      meta = note.is_mine
        ? `Reply · ${note.last_message.author}`
        : `Message · ${note.last_message.author}`
      icon = 'mail'
      date = note.last_message.created_at
    } else if (!note.is_mine) {
      title = snippet
      meta = `New ticket · ${note.author} · ${note.kind_display}`
      icon = 'tools'
      date = note.created_at
    } else {
      continue
    }

    items.push({
      key: `ticket-${note.id}`,
      kind: 'ticket',
      icon,
      title,
      meta,
      date,
      ticketId: note.id,
    })
  }
  return items.sort((a, b) => b.date.localeCompare(a.date))
}

function isOverdue(date: string) {
  return new Date(`${date}T12:00:00`) < new Date(new Date().toDateString())
}

/** Read state and dismissals are per-user and per-browser — both are local
    reading gestures, not something worth a round trip or a shared record. */
function seenKey(userId: number | undefined) {
  return `notificationsSeen:${userId ?? 'anon'}`
}

function dismissedKey(userId: number | undefined) {
  return `notificationsDismissed:${userId ?? 'anon'}`
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Reading state is a convenience — losing it just re-shows the item.
  }
}

/**
 * The bell in the sidebar, between the profile card and Settings.
 *
 * Two feeds share the same panel: everyday due-soon / reminder alerts, and
 * ticket traffic (fix replies and chat for reporters; new filings and user
 * messages for the developer). A header icon flips between them.
 */
export function NotificationsPanel({
  onNavigate,
  onOpenTicket,
}: {
  onNavigate?: () => void
  /** Opens the refinement log — optionally focused on one ticket. */
  onOpenTicket?: (ticketId?: number) => void
}) {
  const { user } = useAuth()
  const isAccountDeveloper = Boolean(user?.is_developer)
  const [open, setOpen] = useState(false)
  const [feed, setFeed] = useState<Feed>(readFeed)
  const [seen, setSeen] = useState<string[]>(() => readJson(seenKey(user?.id), []))
  // key -> the date it was dismissed *for*. Storing the date means a
  // rescheduled follow-up comes back rather than staying hidden forever
  // because you cleared its previous due date months ago.
  const [dismissed, setDismissed] = useState<Record<string, string>>(() =>
    readJson(dismissedKey(user?.id), {}),
  )
  const attention = useResource(() => dashboard.attention(), [])
  // Always load tickets so the badge can include them even on the Normal tab.
  // Developers see everyone's; everyone else sees their own.
  const tickets = useResource(
    () => refinements.list(isAccountDeveloper ? { scope: 'all' } : { scope: 'mine' }),
    [isAccountDeveloper, user?.id],
  )
  const wrapperRef = useRef<HTMLDivElement>(null)

  // A different account's read state is not this account's — re-read rather
  // than carrying the previous user's dismissals over.
  const [syncedForUserId, setSyncedForUserId] = useState<number | null>(null)
  if (user && user.id !== syncedForUserId) {
    setSyncedForUserId(user.id)
    setSeen(readJson(seenKey(user.id), []))
    setDismissed(readJson(dismissedKey(user.id), {}))
  }

  // Fired reminders live in their own store (they're history, written by the
  // scheduler), so subscribe rather than poll — a reminder that fires while
  // the panel is open should appear in it immediately.
  const [firedTick, setFiredTick] = useState(0)
  useEffect(() => subscribeFiredAlerts(() => setFiredTick((n) => n + 1)), [])

  const reloadTickets = tickets.reload
  useEffect(() => {
    if (!open) return
    const timer = window.setInterval(() => reloadTickets(), 15_000)
    return () => window.clearInterval(timer)
  }, [open, reloadTickets])

  const fired: Item[] = useMemo(
    () =>
      readFiredAlerts(user?.id).map((alert) => ({
        key: `alert-${alert.id}`,
        kind: 'alert' as const,
        icon: alert.ticketId ? 'tools' : 'bell',
        title: alert.title,
        meta: alert.subtitle,
        date: alert.firedAt,
        to: alert.to || undefined,
        ticketId: alert.ticketId,
      })),
    // firedTick is the subscription's signal that localStorage changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user?.id, firedTick],
  )

  // Ticket traffic — filings, messages, status moves, fixes — lives on the
  // Tickets feed only; the everyday feed stays about your own pipeline.
  const normalItems = useMemo(
    () => [
      ...fired.filter((item) => item.ticketId == null),
      ...toItems(attention.data).filter((item) => dismissed[item.key] !== item.date),
    ],
    [fired, attention.data, dismissed],
  )
  const ticketItems = useMemo(
    () =>
      [
        ...fired.filter((item) => item.ticketId != null),
        ...toTicketItems(tickets.data).filter((item) => dismissed[item.key] !== item.date),
      ].sort((a, b) => b.date.localeCompare(a.date)),
    [fired, tickets.data, dismissed],
  )
  const items = feed === 'tickets' ? ticketItems : normalItems
  const unreadNormal = normalItems.filter((item) => !seen.includes(item.key))
  const unreadTickets = ticketItems.filter((item) => !seen.includes(item.key))
  // Badge on the closed bell covers both feeds so a ticket reply isn't invisible
  // while you're parked on Normal.
  const badgeCount = unreadNormal.length + unreadTickets.length

  function chooseFeed(next: Feed) {
    setFeed(next)
    writeFeed(next)
  }

  /** Marks everything currently listed as read. Runs when the panel closes,
      not when it opens — otherwise the "new" highlight vanishes from under
      the user the instant they look at it. */
  function markAllSeen() {
    const keys = [...new Set([...seen, ...items.map((item) => item.key)])]
    if (keys.length === seen.length && keys.every((key) => seen.includes(key))) return
    setSeen(keys)
    writeJson(seenKey(user?.id), keys)
  }

  function close() {
    markAllSeen()
    setOpen(false)
  }

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: PointerEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) close()
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, items, seen])

  function dismiss(item: Item) {
    if (item.kind === 'alert') {
      dismissFiredAlert(user?.id, item.key.replace(/^alert-/, ''))
      return
    }
    const next = { ...dismissed, [item.key]: item.date }
    setDismissed(next)
    writeJson(dismissedKey(user?.id), next)
  }

  function clearAll() {
    // Fired alerts belong to whichever feed is showing — clearing Tickets
    // must not wipe reminder history, and vice versa.
    for (const alert of readFiredAlerts(user?.id)) {
      const isTicket = alert.ticketId != null
      if (isTicket === (feed === 'tickets')) dismissFiredAlert(user?.id, alert.id)
    }
    const next = { ...dismissed }
    for (const item of items) {
      if (item.kind === 'attention' || item.kind === 'ticket') next[item.key] = item.date
    }
    setDismissed(next)
    writeJson(dismissedKey(user?.id), next)
  }

  function activate(item: Item) {
    if (item.ticketId != null && onOpenTicket) {
      close()
      onOpenTicket(item.ticketId)
      onNavigate?.()
      return
    }
    close()
    onNavigate?.()
  }

  const loading = feed === 'normal' ? attention.initial : tickets.initial

  return (
    <div ref={wrapperRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-label={
          badgeCount ? `Notifications, ${badgeCount} unread` : 'Notifications'
        }
        aria-expanded={open}
        title="Notifications"
        className={cx(
          'relative rounded-lg p-2 transition-colors',
          open
            ? 'bg-brand-soft text-brand-strong'
            : 'text-ink-3 hover:bg-surface-2 hover:text-ink',
        )}
      >
        <Icon name="bell" size={17} />
        {badgeCount > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-critical px-1 text-[9.5px] font-semibold leading-none text-white">
            {badgeCount > 9 ? '9+' : badgeCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute bottom-full left-0 z-50 mb-2 w-64 overflow-hidden rounded-xl border border-line bg-surface-solid shadow-2xl"
        >
          <div className="flex items-center gap-2 border-b border-line px-2.5 py-2">
            <p className="min-w-0 flex-1 text-[12px] font-semibold text-ink">
              {feed === 'tickets' ? 'Tickets' : 'Notifications'}
            </p>
            <div className="flex items-center gap-0.5 rounded-lg border border-line bg-surface-2 p-0.5">
              <button
                type="button"
                onClick={() => chooseFeed('normal')}
                aria-pressed={feed === 'normal'}
                title="Due soon & reminders"
                aria-label="Normal notifications"
                className={cx(
                  'relative rounded-md p-1 transition-colors',
                  feed === 'normal'
                    ? 'bg-surface text-brand-strong shadow-sm'
                    : 'text-ink-3 hover:text-ink',
                )}
              >
                <Icon name="bell" size={13} />
                {unreadNormal.length > 0 && feed !== 'normal' ? (
                  <span className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-critical" />
                ) : null}
              </button>
              <button
                type="button"
                onClick={() => chooseFeed('tickets')}
                aria-pressed={feed === 'tickets'}
                title={
                  isAccountDeveloper
                    ? 'New tickets & messages from users'
                    : 'Ticket updates & replies'
                }
                aria-label="Ticket notifications"
                className={cx(
                  'relative rounded-md p-1 transition-colors',
                  feed === 'tickets'
                    ? 'bg-surface text-brand-strong shadow-sm'
                    : 'text-ink-3 hover:text-ink',
                )}
              >
                <Icon name="tools" size={13} />
                {unreadTickets.length > 0 && feed !== 'tickets' ? (
                  <span className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-critical" />
                ) : null}
              </button>
            </div>
          </div>

          <div className="scrollbar-thin max-h-72 overflow-y-auto">
            {loading ? (
              <Loading />
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center gap-1 px-3 py-6 text-center">
                <Icon name="check" size={17} className="text-good" />
                <p className="text-[12px] font-medium text-ink">You’re all caught up</p>
                <p className="text-[11px] text-ink-3">
                  {feed === 'tickets'
                    ? isAccountDeveloper
                      ? 'No new tickets or unread messages.'
                      : 'No ticket updates or unread replies.'
                    : 'No alerts, and nothing due in the next 7 days.'}
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {items.map((item) => {
                  const isAlert = item.kind === 'alert'
                  const isTicket = item.kind === 'ticket'
                  const overdue = !isAlert && !isTicket && isOverdue(item.date)
                  const rowClass = cx(
                    'group relative transition-colors hover:bg-surface-2',
                    !seen.includes(item.key) && 'bg-brand-soft/40',
                  )
                  const body = (
                    <>
                      <span
                        className={cx(
                          'mt-0.5 grid size-5 shrink-0 place-items-center rounded-lg',
                          isTicket
                            ? 'bg-brand-soft text-brand-strong'
                            : isAlert
                              ? 'bg-brand-soft text-brand-strong'
                              : overdue
                                ? 'bg-critical/10 text-critical'
                                : 'bg-surface-2 text-ink-3',
                        )}
                      >
                        <Icon name={item.icon} size={11} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12px] font-medium text-ink">
                          {item.title}
                        </span>
                        <span
                          className={cx(
                            'block truncate text-[10.5px] text-ink-3',
                            !isTicket && 'capitalize',
                          )}
                        >
                          {item.meta}
                        </span>
                      </span>
                    </>
                  )
                  return (
                    <li key={item.key} className={rowClass}>
                      {item.to ? (
                        <Link
                          to={item.to}
                          onClick={() => activate(item)}
                          className="flex items-start gap-2 py-2 pl-2.5 pr-12"
                        >
                          {body}
                        </Link>
                      ) : (
                        <button
                          type="button"
                          onClick={() => activate(item)}
                          className="flex w-full items-start gap-2 py-2 pl-2.5 pr-12 text-left"
                        >
                          {body}
                        </button>
                      )}

                      <span
                        className={cx(
                          'pointer-events-none absolute right-2.5 top-2.5 text-[10px] font-medium transition-opacity group-hover:opacity-0 group-focus-within:opacity-0',
                          overdue ? 'text-critical' : 'text-ink-3',
                        )}
                        title={isAlert || isTicket ? undefined : formatDate(item.date)}
                      >
                        {isAlert || isTicket
                          ? relativeTime(item.date)
                          : relativeDay(item.date)}
                      </span>
                      <button
                        type="button"
                        onClick={() => dismiss(item)}
                        aria-label={`Dismiss ${item.title}`}
                        title="Dismiss"
                        className="absolute right-1.5 top-1.5 rounded-lg p-1 text-ink-3 opacity-0 transition-opacity hover:bg-surface hover:text-critical focus-visible:opacity-100 group-hover:opacity-100"
                      >
                        <Icon name="close" size={11} />
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <div className="flex items-stretch border-t border-line">
            {feed === 'normal' ? (
              <Link
                to="/calendar"
                onClick={() => {
                  close()
                  onNavigate?.()
                }}
                className="min-w-0 flex-1 px-2.5 py-1.5 text-center text-[11px] font-medium text-brand hover:bg-surface-2"
              >
                Open calendar
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => {
                  close()
                  onOpenTicket?.()
                  onNavigate?.()
                }}
                className="min-w-0 flex-1 px-2.5 py-1.5 text-center text-[11px] font-medium text-brand hover:bg-surface-2"
              >
                Open refinement log
              </button>
            )}
            <button
              type="button"
              onClick={clearAll}
              disabled={items.length === 0}
              title="Clear all"
              aria-label="Clear all notifications"
              className={cx(
                'grid shrink-0 place-items-center border-l border-line px-2.5 transition-colors',
                items.length === 0
                  ? 'cursor-not-allowed text-ink-3/40'
                  : 'text-ink-3 hover:bg-surface-2 hover:text-critical',
              )}
            >
              <Icon name="trash" size={13} />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
