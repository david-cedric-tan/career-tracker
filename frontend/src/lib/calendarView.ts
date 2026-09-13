/** Per-day chip order for the calendar month/week grids (view preference). */

const ORDER_KEY = 'career-tracker:calendar-day-order'
const EXPAND_KEY = 'career-tracker:calendar-expand-all'

export function readExpandAll(): boolean {
  try {
    return localStorage.getItem(EXPAND_KEY) === '1'
  } catch {
    return false
  }
}

export function writeExpandAll(value: boolean) {
  try {
    localStorage.setItem(EXPAND_KEY, value ? '1' : '0')
  } catch {
    /* ignore */
  }
}

type OrderMap = Record<string, string[]>

function readOrderMap(): OrderMap {
  try {
    const raw = localStorage.getItem(ORDER_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as OrderMap
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeOrderMap(map: OrderMap) {
  try {
    localStorage.setItem(ORDER_KEY, JSON.stringify(map))
  } catch {
    /* ignore */
  }
}

/** Apply a saved id order, appending any new ids at the end. */
export function sortEventsBySavedOrder<T extends { id: string }>(
  date: string,
  events: T[],
): T[] {
  const order = readOrderMap()[date]
  if (!order?.length) return events
  const rank = new Map(order.map((id, index) => [id, index]))
  return [...events].sort((a, b) => {
    const ai = rank.has(a.id) ? rank.get(a.id)! : order.length
    const bi = rank.has(b.id) ? rank.get(b.id)! : order.length
    return ai - bi
  })
}

/** Persist a new order for one day after a same-day reorder. */
export function saveDayOrder(date: string, ids: string[]) {
  const map = readOrderMap()
  map[date] = ids
  writeOrderMap(map)
}

/** Move `dragId` to sit before `beforeId` (or at end if beforeId is null). */
export function reorderIds(ids: string[], dragId: string, beforeId: string | null): string[] {
  const without = ids.filter((id) => id !== dragId)
  if (beforeId == null) return [...without, dragId]
  const index = without.indexOf(beforeId)
  if (index === -1) return [...without, dragId]
  const next = [...without]
  next.splice(index, 0, dragId)
  return next
}

export function parseTimeToMinutes(value: string | null | undefined): number | null {
  if (!value) return null
  const match = /^(\d{1,2}):(\d{2})/.exec(value)
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

export function minutesToTime(total: number): string {
  const clamped = ((total % 1440) + 1440) % 1440
  const h = Math.floor(clamped / 60)
  const m = clamped % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Sunday-start week containing `iso` (YYYY-MM-DD). */
export function weekDaysFor(iso: string): Date[] {
  const date = new Date(`${iso}T12:00:00`)
  const start = new Date(date)
  start.setDate(date.getDate() - date.getDay())
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(start)
    day.setDate(start.getDate() + i)
    return day
  })
}

export function addDaysIso(iso: string, delta: number): string {
  const date = new Date(`${iso}T12:00:00`)
  date.setDate(date.getDate() + delta)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
