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

function isTimedEvent(event: { all_day?: boolean; start_time?: string | null }): boolean {
  return event.all_day === false && Boolean(event.start_time)
}

/**
 * Day list order: timed cards by start clock, then all-day / untimed by the
 * user's saved custom order (drag reorder).
 */
export function sortDayEvents<
  T extends { id: string; all_day?: boolean; start_time?: string | null },
>(date: string, events: T[]): T[] {
  const timed: T[] = []
  const untimed: T[] = []
  for (const event of events) {
    if (isTimedEvent(event)) timed.push(event)
    else untimed.push(event)
  }

  timed.sort((a, b) => {
    const am = parseTimeToMinutes(a.start_time) ?? 0
    const bm = parseTimeToMinutes(b.start_time) ?? 0
    if (am !== bm) return am - bm
    return a.id.localeCompare(b.id)
  })

  return [...timed, ...sortEventsBySavedOrder(date, untimed)]
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

/** Fill remaining viewport under the calendar chrome (header, nav, filters).
 *  Height-locked from `md` up — phones scroll the page so month/week rows
 *  aren't crushed into unreadable bars. */
export const CALENDAR_PANEL_HEIGHT =
  'min-h-[22rem] md:h-[max(24rem,calc(100dvh-14.5rem))] lg:h-[max(28rem,calc(100dvh-16.5rem))]'

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

/** Where one block sits when several share the same stretch of the day. */
export type OverlapSlot = { column: number; columns: number }

/**
 * Pack overlapping time blocks into side-by-side columns.
 *
 * Two things happening at 2pm are both real — the calendar shouldn't stack
 * one on top of the other and hide it. Blocks that touch in time form a
 * cluster, every block takes the leftmost column that's free by the time it
 * starts, and the whole cluster is then divided by however many columns it
 * needed. A block with nothing beside it still gets the full width.
 *
 * Keyed by a caller-supplied id so the render can look each block up without
 * depending on array order.
 */
export function packOverlaps<T>(
  items: T[],
  id: (item: T) => string,
  bounds: (item: T) => { start: number; end: number },
): Map<string, OverlapSlot> {
  const rows = items
    .map((item) => ({ id: id(item), ...bounds(item) }))
    // Earliest first; ties broken by the longer block, so it claims column 0
    // and the short ones tuck in beside it rather than the other way round.
    .sort((a, b) => a.start - b.start || b.end - a.end)

  const slots = new Map<string, OverlapSlot>()
  let cluster: string[] = []
  let columnEnds: number[] = []
  let clusterEnd = Number.NEGATIVE_INFINITY

  function close() {
    for (const key of cluster) {
      const slot = slots.get(key)
      if (slot) slot.columns = columnEnds.length
    }
    cluster = []
    columnEnds = []
    clusterEnd = Number.NEGATIVE_INFINITY
  }

  for (const row of rows) {
    // A gap with nothing running through it ends the cluster: what follows
    // is measured on its own, not squeezed by an earlier pile-up.
    if (cluster.length && row.start >= clusterEnd) close()

    let column = columnEnds.findIndex((end) => end <= row.start)
    if (column === -1) {
      column = columnEnds.length
      columnEnds.push(row.end)
    } else {
      columnEnds[column] = row.end
    }

    slots.set(row.id, { column, columns: 1 })
    cluster.push(row.id)
    clusterEnd = Math.max(clusterEnd, row.end)
  }
  close()

  return slots
}
