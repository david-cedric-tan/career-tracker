/** Date helpers. All API dates are ISO `YYYY-MM-DD` or full ISO timestamps. */

export function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function parse(value: string): Date {
  // A bare YYYY-MM-DD parses as UTC midnight, which can render as "yesterday"
  // in western timezones — pin it to local noon instead.
  return value.length === 10 ? new Date(`${value}T12:00:00`) : new Date(value)
}

export function formatDate(value: string | null | undefined, fallback = '—'): string {
  if (!value) return fallback
  return parse(value).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function formatShortDate(value: string): string {
  return parse(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/**
 * A month-and-year label for a chart bucket — "Oct '25".
 *
 * The day is dropped because these are always month or quarter *starts*, so
 * "1" carried no information; the year is added because a chart spanning more
 * than twelve months repeats month names, and without it two different Octobers
 * look like the same point.
 */
export function formatPeriodLabel(value: string): string {
  const date = parse(value)
  const month = date.toLocaleDateString(undefined, { month: 'short' })
  return `${month} '${String(date.getFullYear()).slice(-2)}`
}

export function formatDateTime(value: string): string {
  return parse(value).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** A plain "HH:MM:SS" or "HH:MM" time-of-day string (no date) to "2:30 PM". */
export function formatTime(value: string): string {
  const [hours, minutes] = value.split(':').map(Number)
  return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** Compact clock for calendar chips: always "10:00am", "10:30pm". */
export function formatCompactTime(value: string): string {
  const [hours, minutes = 0] = value.split(':').map(Number)
  if (Number.isNaN(hours)) return value
  const suffix = hours < 12 ? 'am' : 'pm'
  const h12 = hours % 12 === 0 ? 12 : hours % 12
  return `${h12}:${String(Number.isNaN(minutes) ? 0 : minutes).padStart(2, '0')}${suffix}`
}

/**
 * Calendar range — always paired clocks: "10:00am – 11:00am", "10:30pm – 11:30pm".
 */
export function formatTimeRangeShort(
  start: string | null | undefined,
  end?: string | null,
): string {
  if (!start) return ''
  if (!end) return formatCompactTime(start)
  return `${formatCompactTime(start)} – ${formatCompactTime(end)}`
}

/** Whole days from today; negative means in the past. */
export function daysFromToday(value: string): number {
  const target = parse(value)
  target.setHours(12, 0, 0, 0)
  const now = new Date()
  now.setHours(12, 0, 0, 0)
  return Math.round((target.getTime() - now.getTime()) / 86_400_000)
}

export function relativeDay(value: string | null | undefined): string {
  if (!value) return '—'
  const days = daysFromToday(value)
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days === -1) return 'Yesterday'
  if (days < 0) return `${Math.abs(days)} days ago`
  if (days < 7) return `In ${days} days`
  return formatDate(value)
}

/** Whole days elapsed since a timestamp — how long something has been sitting. */
export function daysSince(value: string): number {
  const started = new Date(value).getTime()
  if (Number.isNaN(started)) return 0
  return Math.max(0, Math.floor((Date.now() - started) / 86_400_000))
}

export function relativeTime(value: string): string {
  const diff = Date.now() - new Date(value).getTime()
  const minutes = Math.round(diff / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d ago`
  return formatDate(value.slice(0, 10))
}

/** "First Last", falling back to the username — used everywhere a user's
    name is shown, so accounts created before names were required still
    display sensibly instead of showing a blank. */
export function displayName(
  user: { first_name?: string; last_name?: string; username?: string } | null | undefined,
): string {
  const full = [user?.first_name, user?.last_name].filter(Boolean).join(' ')
  return full || user?.username || ''
}

/** The short name the app addresses you by — preferred name, else first name. */
export function shortName(
  user: { preferred_name?: string; first_name?: string; username?: string } | null | undefined,
): string {
  return user?.preferred_name?.trim() || user?.first_name?.trim() || user?.username || ''
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

/** Merge conditional class names — the tiny subset of `clsx` we need. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}
