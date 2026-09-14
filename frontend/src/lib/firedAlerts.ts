/**
 * A short history of reminders that have actually fired.
 *
 * The banner is transient by design — six seconds and it's gone — so without
 * this a reminder you were away from the screen for leaves no trace at all.
 * The notifications panel reads this alongside the "due soon" feed, so a
 * fired alert stays reachable after the toast disappears.
 *
 * Per-user and per-browser: this is a record of what *this* screen showed,
 * not a server-side notification inbox.
 */

export type FiredAlert = {
  /** The reminder id, as a string — stable, so re-firing can't duplicate. */
  id: string
  title: string
  subtitle: string
  /** ISO timestamp of when it fired. */
  firedAt: string
  /** Where clicking it goes — a calendar deep link, or nothing for tickets. */
  to: string
  /** A ticket alert opens the refinement log on that ticket instead. */
  ticketId?: number
}

const MAX_KEPT = 30
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

function storageKey(userId: number | undefined) {
  return `firedAlerts:${userId ?? 'anon'}`
}

const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

/** Subscribe to changes, including ones made in another tab. */
export function subscribeFiredAlerts(listener: () => void): () => void {
  listeners.add(listener)
  const onStorage = (event: StorageEvent) => {
    if (event.key?.startsWith('firedAlerts:')) listener()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function readFiredAlerts(userId: number | undefined): FiredAlert[] {
  try {
    const raw = localStorage.getItem(storageKey(userId))
    if (!raw) return []
    const parsed = JSON.parse(raw) as FiredAlert[]
    if (!Array.isArray(parsed)) return []
    const cutoff = Date.now() - MAX_AGE_MS
    return parsed.filter((entry) => new Date(entry.firedAt).getTime() > cutoff)
  } catch {
    return []
  }
}

function write(userId: number | undefined, alerts: FiredAlert[]) {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(alerts.slice(0, MAX_KEPT)))
  } catch {
    // History is a convenience — the banner still fired either way.
  }
  emit()
}

/** Newest first, and idempotent: re-recording the same id refreshes it
    rather than stacking a second copy. */
export function recordFiredAlert(userId: number | undefined, alert: FiredAlert): void {
  const existing = readFiredAlerts(userId).filter((entry) => entry.id !== alert.id)
  write(userId, [alert, ...existing])
}

export function dismissFiredAlert(userId: number | undefined, id: string): void {
  write(
    userId,
    readFiredAlerts(userId).filter((entry) => entry.id !== id),
  )
}

export function clearFiredAlerts(userId: number | undefined): void {
  write(userId, [])
}
