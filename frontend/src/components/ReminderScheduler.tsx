import { useEffect, useRef, useState } from 'react'
import { calendarEvents, refinements } from '../api/resources'
import type { CalendarEventRecord, EventReminder } from '../api/types'
import { useAuth } from '../auth/context'
import { recordFiredAlert } from '../lib/firedAlerts'
import { displayName, formatTime } from '../lib/format'
import { diffTickets, readSignatures, writeSignatures } from '../lib/ticketWatch'
import { playNotificationSound } from '../lib/notificationSound'
import { IOSNotificationStack, type ReminderAlert } from './ui/IOSNotification'

// A safety-net poll — discovers newly-created/edited reminders and
// re-establishes the precise alarm below. Actual firing doesn't wait for
// this; see `scheduleNextAlarm`.
const POLL_MS = 10_000
// A reminder only fires client-side within this recent a window of its
// moment — otherwise every reminder the tab missed while closed would all
// fire at once the next time it's opened. Ninety seconds late still reads as
// "on time"; anything older just doesn't get a client-side alert (there's no
// push-notification backend behind this — see the README's Reminders note).
const FIRE_WINDOW_MS = 90_000
const LOOKAHEAD_DAYS = 14
// setTimeout delays beyond ~24 days silently misfire in some browsers; the
// next poll re-schedules a closer alarm well before this cap could matter.
const MAX_TIMEOUT_MS = 24 * 60 * 60 * 1000

/**
 * No visual footprint of its own beyond the toast stack it renders — alerts
 * both ways: the in-app iOS-style banner (+ sound) always, and — only when
 * the tab isn't the one you're looking at — a real OS notification too, so a
 * reminder isn't silent just because you tabbed away.
 *
 * Fires via a precise `setTimeout` targeting the single soonest upcoming
 * reminder, not by waiting for the next poll tick — a pure-polling design
 * means up to a full `POLL_MS` of lateness on every reminder, which reads as
 * "the alert is late" even though it technically fired within the window.
 */
// Quick enough that a reply lands within a few seconds of being sent.
const TICKET_POLL_MS = 6_000

export function ReminderScheduler({ onOpenTicket }: { onOpenTicket?: (ticketId: number) => void }) {
  const { user } = useAuth()
  const [alerts, setAlerts] = useState<ReminderAlert[]>([])
  /** Per-alert "stop the repeating chime" callbacks, keyed like the alerts. */
  const stopSound = useRef(new Map<string, () => void>())
  const shown = useRef<Set<number>>(new Set())
  const alarmTimeout = useRef<number | null>(null)
  // Read through a ref so the layout re-rendering (and handing us a fresh
  // callback) doesn't restart the ticket poll.
  const openTicketRef = useRef(onOpenTicket)
  useEffect(() => {
    openTicketRef.current = onOpenTicket
  })

  useEffect(() => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      void Notification.requestPermission()
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    function subtitleFor(event: CalendarEventRecord, reminder: EventReminder): string {
      if (event.all_day) return event.date === new Date().toISOString().slice(0, 10) ? 'Today' : event.date
      const time = event.start_time ? formatTime(event.start_time) : null
      if (reminder.minutes_before === 0) return time ? `Starting now · ${time}` : 'Starting now'
      return time ? `Starts at ${time}` : 'Starting soon'
    }

    function fire(event: CalendarEventRecord, reminder: EventReminder) {
      shown.current.add(reminder.id)
      const subtitle = subtitleFor(event, reminder)
      // Straight to the event's own popup, on its day — not just the calendar.
      const to = `/calendar?day=${event.date}&month=${event.date.slice(0, 7)}&open=custom-${event.id}`
      setAlerts((prev) => [...prev, { key: String(reminder.id), title: event.title, subtitle, to }])
      // The chime repeats until this is called — dismissing the banner is
      // what stops it, so hold the canceller against that alert's key.
      stopSound.current.set(String(reminder.id), playNotificationSound())
      // The banner is gone in six seconds; this is what keeps the alert
      // reachable in the notifications panel afterwards.
      recordFiredAlert(user?.id, {
        id: String(reminder.id),
        title: event.title,
        subtitle,
        firedAt: new Date().toISOString(),
        to,
      })

      if (
        document.hidden &&
        typeof Notification !== 'undefined' &&
        Notification.permission === 'granted'
      ) {
        new Notification(event.title, { body: subtitle, icon: '/favicon.svg' })
      }
    }

    function clearAlarm() {
      if (alarmTimeout.current !== null) {
        window.clearTimeout(alarmTimeout.current)
        alarmTimeout.current = null
      }
    }

    async function check() {
      const start = new Date().toISOString().slice(0, 10)
      const end = new Date(Date.now() + LOOKAHEAD_DAYS * 86_400_000).toISOString().slice(0, 10)
      try {
        const events = await calendarEvents.list({ start, end })
        if (cancelled) return
        const now = Date.now()
        let soonest: { event: CalendarEventRecord; reminder: EventReminder; firesAt: number } | null =
          null

        for (const event of events) {
          if (event.is_done) continue
          for (const reminder of event.reminders) {
            if (shown.current.has(reminder.id)) continue
            const firesAt = new Date(reminder.fires_at).getTime()
            const lateness = now - firesAt
            if (lateness >= 0 && lateness <= FIRE_WINDOW_MS) {
              fire(event, reminder)
              continue
            }
            if (firesAt > now && (!soonest || firesAt < soonest.firesAt)) {
              soonest = { event, reminder, firesAt }
            }
          }
        }

        clearAlarm()
        if (soonest) {
          const target = soonest
          const delay = Math.min(target.firesAt - now, MAX_TIMEOUT_MS)
          alarmTimeout.current = window.setTimeout(() => {
            if (!cancelled) fire(target.event, target.reminder)
          }, delay)
        }
      } catch {
        // Quiet — the next poll just tries again.
      }
    }

    void check()
    const interval = window.setInterval(() => void check(), POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(interval)
      clearAlarm()
    }
    // Re-established on sign-in so fired alerts are filed under the account
    // that's actually looking at them.
  }, [user?.id])

  // Tickets: every update — a new filing (developer), a message either way, a
  // status move or a fix — rings and banners like a reminder does, and lands
  // in the notifications panel if it isn't clicked.
  useEffect(() => {
    if (!user) return
    let cancelled = false
    const userId = user.id
    const self = {
      isDeveloper: Boolean(user.is_developer),
      names: [displayName(user), user.username, user.first_name].filter(Boolean),
    }

    async function check() {
      try {
        const notes = await refinements.list(self.isDeveloper ? { scope: 'all' } : { scope: 'mine' })
        if (cancelled) return
        const previous = readSignatures(userId)
        // First look on this browser is a baseline, not a backlog of alerts.
        if (previous) {
          for (const change of diffTickets(notes, previous, self)) {
            const key = change.key
            setAlerts((prev) =>
              prev.some((alert) => alert.key === key)
                ? prev
                : [
                    ...prev,
                    {
                      key,
                      title: change.title,
                      subtitle: change.subtitle,
                      icon: 'tools',
                      onOpen: () => openTicketRef.current?.(change.note.id),
                    },
                  ],
            )
            stopSound.current.set(key, playNotificationSound())
            recordFiredAlert(userId, {
              id: key,
              title: change.title,
              subtitle: change.subtitle,
              firedAt: new Date().toISOString(),
              to: '',
              ticketId: change.note.id,
            })
            if (
              document.hidden &&
              typeof Notification !== 'undefined' &&
              Notification.permission === 'granted'
            ) {
              new Notification(change.title, { body: change.subtitle, icon: '/favicon.svg' })
            }
          }
        }
        writeSignatures(userId, notes)
      } catch {
        // Offline or signed out — the next tick tries again.
      }
    }

    void check()
    const timer = window.setInterval(() => void check(), TICKET_POLL_MS)
    // Coming back to the tab checks straight away rather than waiting out
    // the remainder of the interval.
    const onVisible = () => {
      if (!document.hidden) void check()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [user])

  function dismiss(key: string) {
    stopSound.current.get(key)?.()
    stopSound.current.delete(key)
    setAlerts((prev) => prev.filter((alert) => alert.key !== key))
  }

  return <IOSNotificationStack alerts={alerts} onDismiss={dismiss} />
}
