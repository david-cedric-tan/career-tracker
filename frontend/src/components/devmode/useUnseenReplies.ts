import { useEffect, useState } from 'react'
import { refinements } from '../../api/resources'

/** How often to check for replies. Slow on purpose — this is "your complaint
    was dealt with", not a chat, and nobody is waiting on the second. */
const POLL_MS = 60_000

/**
 * Watches for replies to the notes *you* raised.
 *
 * Without this the answer would only exist inside the log panel, so you'd have
 * to open it on the off-chance something had been fixed. The count drives a
 * badge on the launcher; the toast fires once per reply so a fix that lands
 * while you're using the app is visible immediately.
 */
export function useUnseenReplies(enabled: boolean) {
  const [count, setCount] = useState(0)

  useEffect(() => {
    if (!enabled) return

    let cancelled = false

    async function check() {
      try {
        const notes = await refinements.list({ status: 'done', scope: 'mine' })
        if (cancelled) return

        const fresh = notes.filter(
          (note) => note.is_mine && note.resolution && !note.resolution_seen_at,
        )
        setCount(fresh.length)

        // The ring-and-banner alert (ReminderScheduler's ticket watcher)
        // announces fixes now; this only keeps the launcher badge honest.
      } catch {
        // Offline or signed out — try again on the next tick rather than
        // putting an error toast in front of someone who didn't ask for this.
      }
    }

    void check()
    const timer = window.setInterval(() => void check(), POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [enabled])

  // Reported as zero rather than cleared when disabled, so turning developer
  // mode off doesn't need a state write from inside the effect.
  return { count: enabled ? count : 0, clear: () => setCount(0) }
}
