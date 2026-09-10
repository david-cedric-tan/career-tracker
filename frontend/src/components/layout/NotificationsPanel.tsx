import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { dashboard } from '../../api/resources'
import type { Attention } from '../../api/types'
import { useAuth } from '../../auth/context'
import {
  clearFiredAlerts,
  dismissFiredAlert,
  readFiredAlerts,
  subscribeFiredAlerts,
} from '../../lib/firedAlerts'
import { cx, formatDate, relativeDay, relativeTime } from '../../lib/format'
import { useResource } from '../../hooks/useResource'
import { Icon } from '../ui/Icon'
import { Loading } from '../ui/States'

type Item = {
  key: string
  icon: string
  title: string
  meta: string
  /** ISO date for a due-soon item; ISO timestamp for a fired alert. */
  date: string
  to: string
  /** A fired reminder is history, not something coming up — it dismisses
      out of its own store rather than the due-soon dismissal map. */
  kind: 'attention' | 'alert'
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
 * It reads the same "needs attention" feed the dashboard panel does rather
 * than inventing a second notion of what's urgent — the difference is that
 * this one is reachable from every page, and remembers what you've already
 * looked at.
 */
export function NotificationsPanel({ onNavigate }: { onNavigate?: () => void }) {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [seen, setSeen] = useState<string[]>(() => readJson(seenKey(user?.id), []))
  // key -> the date it was dismissed *for*. Storing the date means a
  // rescheduled follow-up comes back rather than staying hidden forever
  // because you cleared its previous due date months ago.
  const [dismissed, setDismissed] = useState<Record<string, string>>(() =>
    readJson(dismissedKey(user?.id), {}),
  )
  const attention = useResource(() => dashboard.attention(), [])
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

  const fired: Item[] = useMemo(
    () =>
      readFiredAlerts(user?.id).map((alert) => ({
        key: `alert-${alert.id}`,
        kind: 'alert' as const,
        icon: 'bell',
        title: alert.title,
        meta: alert.subtitle,
        date: alert.firedAt,
        to: alert.to,
      })),
    // firedTick is the subscription's signal that localStorage changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user?.id, firedTick],
  )

  const items = useMemo(
    () => [
      // Something that already went off outranks something merely due soon.
      ...fired,
      ...toItems(attention.data).filter((item) => dismissed[item.key] !== item.date),
    ],
    [fired, attention.data, dismissed],
  )
  const unread = items.filter((item) => !seen.includes(item.key))

  /** Marks everything currently listed as read. Runs when the panel closes,
      not when it opens — otherwise the "new" highlight vanishes from under
      the user the instant they look at it. */
  function markAllSeen() {
    const keys = items.map((item) => item.key)
    if (keys.every((key) => seen.includes(key))) return
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
    clearFiredAlerts(user?.id)
    const next = { ...dismissed }
    for (const item of items) {
      if (item.kind === 'attention') next[item.key] = item.date
    }
    setDismissed(next)
    writeJson(dismissedKey(user?.id), next)
  }

  return (
    <div ref={wrapperRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-label={
          unread.length ? `Notifications, ${unread.length} unread` : 'Notifications'
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
        {unread.length > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-critical px-1 text-[9.5px] font-semibold leading-none text-white">
            {unread.length > 9 ? '9+' : unread.length}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute bottom-full left-0 z-50 mb-2 w-60 overflow-hidden rounded-xl border border-line bg-surface-solid shadow-2xl"
        >
          <div className="flex items-center justify-between gap-2 border-b border-line px-2.5 py-2">
            <p className="text-[12px] font-semibold text-ink">Notifications</p>
            {items.length > 0 ? (
              <button
                type="button"
                onClick={clearAll}
                className="text-[10.5px] font-medium text-ink-3 transition-colors hover:text-critical"
              >
                Clear all
              </button>
            ) : null}
          </div>

          <div className="scrollbar-thin max-h-72 overflow-y-auto">
            {attention.initial ? (
              <Loading />
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center gap-1 px-3 py-6 text-center">
                <Icon name="check" size={17} className="text-good" />
                <p className="text-[12px] font-medium text-ink">You’re all caught up</p>
                <p className="text-[11px] text-ink-3">
                  No alerts, and nothing due in the next 7 days.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {items.map((item) => {
                  const isAlert = item.kind === 'alert'
                  const overdue = !isAlert && isOverdue(item.date)
                  return (
                    <li
                      key={item.key}
                      className={cx(
                        'group relative transition-colors hover:bg-surface-2',
                        !seen.includes(item.key) && 'bg-brand-soft/40',
                      )}
                    >
                      <Link
                        to={item.to}
                        onClick={() => {
                          close()
                          onNavigate?.()
                        }}
                        className="flex items-start gap-2 py-2 pl-2.5 pr-12"
                      >
                        <span
                          className={cx(
                            'mt-0.5 grid size-5 shrink-0 place-items-center rounded-lg',
                            isAlert
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
                          <span className="block truncate text-[10.5px] capitalize text-ink-3">
                            {item.meta}
                          </span>
                        </span>
                      </Link>

                      {/* Date and the per-row dismiss share a corner: the date
                          gives way on hover/focus so the button never has to
                          fight it for space. */}
                      <span
                        className={cx(
                          'pointer-events-none absolute right-2.5 top-2.5 text-[10px] font-medium transition-opacity group-hover:opacity-0 group-focus-within:opacity-0',
                          overdue ? 'text-critical' : 'text-ink-3',
                        )}
                        title={isAlert ? undefined : formatDate(item.date)}
                      >
                        {isAlert ? relativeTime(item.date) : relativeDay(item.date)}
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

          <Link
            to="/calendar"
            onClick={() => {
              close()
              onNavigate?.()
            }}
            className="block border-t border-line px-2.5 py-1.5 text-center text-[11px] font-medium text-brand hover:bg-surface-2"
          >
            Open calendar
          </Link>
        </div>
      ) : null}
    </div>
  )
}
