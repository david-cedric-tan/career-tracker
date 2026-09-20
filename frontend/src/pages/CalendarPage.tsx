import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { formatApiError } from '../api/client'
import { calendarEvents, catchups, dashboard, todos } from '../api/resources'
import type { CalendarEvent, CalendarEventRecord, Catchup, Todo } from '../api/types'
import { CALENDAR_TIME_CLASS } from '../components/calendar/DayEventChip'
import { DayTimeline } from '../components/calendar/DayTimeline'
import { CalendarComposeModal } from '../components/calendar/CalendarComposeModal'
import {
  composeOriginKind,
  emptyCompose,
  type CalendarComposeState,
  type ComposeKind,
} from '../lib/calendarCompose'
import { CalendarItemView, type CalendarItem } from '../components/calendar/CalendarItemView'
import { CalendarLinkedPreview } from '../components/calendar/CalendarLinkedPreview'
import {
  MonthDayEventStack,
  MonthDayPeek,
  sortMonthCellEvents,
} from '../components/calendar/MonthDayEvents'
import { WeekView } from '../components/calendar/WeekView'
import { PageHeader } from '../components/layout/PageHeader'
import { Avatar } from '../components/ui/Avatar'
import { Button } from '../components/ui/Button'
import { CompanyMark } from '../components/ui/CompanyMark'
import { Card } from '../components/ui/Card'
import { FilterDrawer } from '../components/ui/FilterDrawer'
import { Icon } from '../components/ui/Icon'
import { ErrorState, Loading } from '../components/ui/States'
import { Switch } from '../components/ui/Switch'
import { useToast } from '../components/ui/toast-context'
import { useAutoOpenFromQuery } from '../hooks/useAutoOpenFromQuery'
import { useResource } from '../hooks/useResource'
import {
  addDaysIso,
  minutesToTime,
  parseTimeToMinutes,
  reorderIds,
  saveDayOrder,
  sortDayEvents,
  weekDaysFor,
} from '../lib/calendarView'
import {
  CALENDAR_EFFECT_COLORS,
  calendarEffectCssVar,
  useCalendarEffects,
} from '../lib/calendarEffects'
import { downloadFile } from '../lib/download'
import { cx, formatTimeRangeShort } from '../lib/format'
import { rememberList } from '../lib/listState'
import { CALENDAR_DOMAIN_META, TONE_CHIP, TONE_DOT, calendarEventTone } from '../lib/tones'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DOMAINS = Object.keys(CALENDAR_DOMAIN_META) as (keyof typeof CALENDAR_DOMAIN_META)[]
const DRAG_MIME = 'application/x-career-tracker-calendar'
const VIEW_MODES = ['day', 'week', 'month', 'year'] as const
type ViewMode = (typeof VIEW_MODES)[number]

/** Kinds that own a row of their own here, so a copy can be created. */
function isDuplicable(event: CalendarEvent): boolean {
  return (
    event.domain === 'custom' ||
    event.domain === 'todo' ||
    event.domain === 'catchup' ||
    event.domain === 'catchup_followup'
  )
}

function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

function isMovable(event: CalendarEvent): boolean {
  return event.domain === 'custom' || event.domain === 'todo'
}

function isTimed(event: CalendarEvent): boolean {
  return (
    (event.domain === 'custom' || event.domain === 'todo') && event.all_day === false
  )
}

function parseEventId(event: CalendarEvent): number {
  const raw = event.id.includes('-') ? event.id.slice(event.id.indexOf('-') + 1) : event.id
  return Number(raw)
}

function toIsoDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function isSameDay(a: Date, b: Date): boolean {
  return toIsoDate(a) === toIsoDate(b)
}

function buildMonthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1)
  const start = new Date(year, month, 1 - first.getDay())
  return Array.from({ length: 42 }, (_, i) => {
    const date = new Date(start)
    date.setDate(start.getDate() + i)
    return date
  })
}

function toMonthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function parseViewMode(raw: string | null): ViewMode {
  if (raw === 'year' || raw === 'week' || raw === 'day') return raw
  return 'month'
}

/**
 * FR-CAL — every date-bearing domain in one place. Month / week / day / year
 * views share one feed; chip order and expand-all are local view preferences.
 */
export function CalendarPage() {
  const { notify } = useToast()
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const today = new Date()
  const todayIso = toIsoDate(today)

  const viewMode = parseViewMode(params.get('view'))
  const cursor = useMemo(() => {
    const raw = params.get('month')
    if (raw && /^\d{4}-\d{2}$/.test(raw)) {
      const [y, m] = raw.split('-').map(Number)
      return new Date(y, m - 1, 1)
    }
    return new Date(today.getFullYear(), today.getMonth(), 1)
  }, [params, today])
  const selectedDay = params.get('day') || todayIso
  const activeDomains = useMemo(() => {
    const raw = params.get('domains')
    return raw ? new Set(raw.split(',')) : new Set<string>(DOMAINS)
  }, [params])
  // Narrows application entries to the ones still unsubmitted — the
  // deadlines that need an application written, not the ones already in.
  const unsubmittedOnly = params.get('unsubmitted') === '1'

  useEffect(() => {
    rememberList('calendar', params.toString() ? `?${params}` : '')
  }, [params])

  const [exporting, setExporting] = useState(false)
  const [compose, setCompose] = useState<CalendarComposeState>(() => emptyCompose(selectedDay))
  const [viewing, setViewing] = useState<CalendarItem | null>(null)
  const [linkedPreview, setLinkedPreview] = useState<CalendarEvent | null>(null)
  const [loadingEvent, setLoadingEvent] = useState<string | null>(null)
  const [peekDay, setPeekDay] = useState<string | null>(null)
  const [orderVersion, setOrderVersion] = useState(0)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [dropBeforeId, setDropBeforeId] = useState<string | null>(null)
  const [dropHour, setDropHour] = useState<number | null>(null)
  const [movingId, setMovingId] = useState<string | null>(null)
  // Right-click → "Duplicate / Copy"; ⌘C copies the chip under the pointer,
  // ⌘V pastes the copy onto the selected day. Both go through duplicateItem.
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    item: CalendarEvent
  } | null>(null)
  const [clipboard, setClipboard] = useState<CalendarEvent | null>(null)
  const hoveredRef = useRef<CalendarEvent | null>(null)

  const year = cursor.getFullYear()
  const month = cursor.getMonth()
  const weekDays = useMemo(() => weekDaysFor(selectedDay), [selectedDay])

  const range = useMemo(() => {
    if (viewMode === 'year') {
      return { start: toIsoDate(new Date(year, 0, 1)), end: toIsoDate(new Date(year, 11, 31)) }
    }
    if (viewMode === 'week') {
      return {
        start: toIsoDate(weekDays[0]),
        end: toIsoDate(weekDays[6]),
      }
    }
    if (viewMode === 'day') {
      return { start: selectedDay, end: selectedDay }
    }
    const start = new Date(year, month, 1 - 7)
    const end = new Date(year, month + 1, 7)
    return { start: toIsoDate(start), end: toIsoDate(end) }
  }, [year, month, viewMode, weekDays, selectedDay])

  const calendar = useResource(() => dashboard.calendar(range), [range.start, range.end])
  const todoChoices = useResource(() => todos.choices(), [])
  const catchupChoices = useResource(() => catchups.choices(), [])

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>()
    for (const event of calendar.data?.events ?? []) {
      if (!activeDomains.has(event.domain)) continue
      if (unsubmittedOnly && event.stage !== undefined && event.stage !== 'not_submitted') continue
      const list = map.get(event.date) ?? []
      list.push(event)
      map.set(event.date, list)
    }
    for (const [date, list] of map) {
      map.set(date, sortDayEvents(date, list))
    }
    return map
    // orderVersion forces re-sort after a same-day reorder.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendar.data, activeDomains, unsubmittedOnly, orderVersion])

  const days = useMemo(() => buildMonthGrid(year, month), [year, month])
  const months = useMemo(
    () => (viewMode === 'year' ? Array.from({ length: 12 }, (_, m) => buildMonthGrid(year, m)) : []),
    [year, viewMode],
  )

  // Equal week rows that grow to fill leftover viewport height.
  const monthRowCount = Math.max(1, Math.round(days.length / 7))
  const monthEqualRowStyle = useMemo(
    () =>
      ({
        gridTemplateRows: `repeat(${monthRowCount}, minmax(4.75rem, 1fr))`,
      }) as CSSProperties,
    [monthRowCount],
  )

  function updateParams(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) next.delete(key)
      else next.set(key, value)
    }
    setParams(next, { replace: true })
  }

  function setViewMode(mode: ViewMode) {
    updateParams({ view: mode === 'month' ? null : mode })
  }

  function setSelectedDay(day: string) {
    const monthStart = new Date(`${day}T12:00:00`)
    const monthKey = toMonthKey(new Date(monthStart.getFullYear(), monthStart.getMonth(), 1))
    const isCurrentMonth =
      monthStart.getFullYear() === today.getFullYear() && monthStart.getMonth() === today.getMonth()
    updateParams({
      day: day === todayIso ? null : day,
      month: isCurrentMonth ? null : monthKey,
    })
  }

  function openDayPeek(iso: string) {
    setSelectedDay(iso)
    setPeekDay(iso)
  }

  function toggleDomain(domain: string) {
    const next = new Set(activeDomains)
    if (next.has(domain)) next.delete(domain)
    else next.add(domain)
    const isEverything = DOMAINS.every((d) => next.has(d))
    updateParams({ domains: isEverything ? null : Array.from(next).join(',') })
  }

  function jump(delta: number) {
    if (viewMode === 'year') {
      const next = new Date(year + delta, month, 1)
      const isCurrent =
        next.getFullYear() === today.getFullYear() && next.getMonth() === today.getMonth()
      updateParams({ month: isCurrent ? null : toMonthKey(next) })
      return
    }
    if (viewMode === 'week') {
      setSelectedDay(addDaysIso(selectedDay, delta * 7))
      return
    }
    if (viewMode === 'day') {
      setSelectedDay(addDaysIso(selectedDay, delta))
      return
    }
    const next = new Date(year, month + delta, 1)
    const isCurrent =
      next.getFullYear() === today.getFullYear() && next.getMonth() === today.getMonth()
    updateParams({ month: isCurrent ? null : toMonthKey(next) })
  }

  function openDayInMonthView(date: Date) {
    const monthStart = new Date(date.getFullYear(), date.getMonth(), 1)
    const isCurrentMonth =
      monthStart.getFullYear() === today.getFullYear() && monthStart.getMonth() === today.getMonth()
    const iso = toIsoDate(date)
    updateParams({
      view: null,
      month: isCurrentMonth ? null : toMonthKey(monthStart),
      day: iso === todayIso ? null : iso,
    })
  }

  function openCompose(options: {
    kind?: ComposeKind
    date?: string
    startTime?: string | null
    allDay?: boolean
    existingTodo?: Todo | null
    existingEvent?: CalendarEventRecord | null
    existingCatchup?: Catchup | null
  }) {
    const date = options.date ?? selectedDay
    if (options.date) setSelectedDay(options.date)
    setCompose({
      open: true,
      kind: options.kind ?? 'event',
      date,
      startTime: options.startTime ?? null,
      allDay: options.allDay ?? options.startTime == null,
      existingTodo: options.existingTodo ?? null,
      existingEvent: options.existingEvent ?? null,
      existingCatchup: options.existingCatchup ?? null,
      // A fresh open never inherits the last switch's carried-over values.
      draft: null,
    })
  }

  /**
   * After a save from the compose dialog. If the kind was switched while
   * editing, the form has just *created* the new record — so the one it
   * replaces is removed here, which is the only point at which a switch
   * actually changes anything.
   */
  async function finishCompose() {
    const origin = composeOriginKind(compose)
    if (origin && origin !== compose.kind) {
      try {
        if (origin === 'todo' && compose.existingTodo) {
          await todos.remove(compose.existingTodo.id)
        } else if (origin === 'event' && compose.existingEvent) {
          await calendarEvents.remove(compose.existingEvent.id)
        } else if (origin === 'catchup' && compose.existingCatchup) {
          await catchups.remove(compose.existingCatchup.id)
        }
      } catch (err) {
        // The new record exists either way — say what didn't happen rather
        // than leaving them to find the duplicate themselves.
        notify(`Saved, but the old ${origin} could not be removed: ${formatApiError(err)}`, 'error')
      }
    }
    closeCompose()
    calendar.reload()
  }

  function closeCompose() {
    setCompose((prev) => ({ ...prev, open: false }))
  }

  function addEvent(options?: { allDay?: boolean; startTime?: string; date?: string }) {
    openCompose({
      kind: 'event',
      date: options?.date,
      allDay: options?.allDay,
      startTime: options?.startTime,
    })
  }

  /** Double-click a date panel → pick todo / event / catch-up for that day. */
  function composeOnDate(iso: string, options?: { startTime?: string; allDay?: boolean }) {
    openCompose({
      kind: 'event',
      date: iso,
      startTime: options?.startTime ?? null,
      allDay: options?.allDay ?? options?.startTime == null,
    })
  }

  useAutoOpenFromQuery('new', () => addEvent())

  useAutoOpenFromQuery('event', (value) => {
    const id = Number(value)
    if (!Number.isFinite(id)) return
    void calendarEvents
      .get(id)
      .then((record) => openCompose({ kind: 'event', date: record.date, existingEvent: record }))
      .catch((err) => notify(formatApiError(err), 'error'))
  })

  // `?open=<feed id>` names the popup that's showing, so a link out of it
  // (a face, "Open full page") and the Back button land on the same popup
  // rather than a bare calendar.
  function markOpen(id: string | null) {
    const next = new URLSearchParams(params)
    if (id) next.set('open', id)
    else next.delete('open')
    if (next.toString() !== params.toString()) setParams(next, { replace: true })
  }
  const reopenId = params.get('open')
  const [reopened, setReopened] = useState<string | null>(null)
  useEffect(() => {
    if (!reopenId || reopenId === reopened || !calendar.data) return
    const match = calendar.data.events.find((event) => event.id === reopenId)
    // Deferred: opening fetches the record, so it's a task, not a render step.
    queueMicrotask(() => {
      setReopened(reopenId)
      if (match) void openCalendarItem(match)
    })
  }, [reopenId, calendar.data]) // eslint-disable-line react-hooks/exhaustive-deps

  // A plain click opens the read-only card; a drop (dateOverride) is already
  // an edit, so that goes straight to the compose form with the new date filled in.
  async function openCalendarItem(event: CalendarEvent, dateOverride?: string) {
    setLoadingEvent(event.id)
    if (!dateOverride) markOpen(event.id)
    try {
      if (event.domain === 'custom') {
        const record = await calendarEvents.get(parseEventId(event))
        if (dateOverride) {
          openCompose({
            kind: 'event',
            date: dateOverride,
            existingEvent: { ...record, date: dateOverride },
          })
        } else setViewing({ kind: 'event', record })
        return
      }
      if (event.domain === 'todo') {
        const record = await todos.get(parseEventId(event))
        if (dateOverride) {
          openCompose({
            kind: 'todo',
            date: dateOverride,
            existingTodo: { ...record, due_date: dateOverride },
          })
        } else setViewing({ kind: 'todo', record })
        return
      }
      if (event.domain === 'catchup' || event.domain === 'catchup_followup') {
        const record = await catchups.get(parseEventId(event))
        openCompose({
          kind: 'catchup',
          date: dateOverride ?? record.met_on,
          existingCatchup: dateOverride
            ? { ...record, met_on: dateOverride }
            : record,
        })
        return
      }
      setLinkedPreview(event)
    } catch (err) {
      notify(formatApiError(err), 'error')
    } finally {
      setLoadingEvent(null)
    }
  }

  async function editEvent(event: CalendarEvent, dateOverride?: string) {
    await openCalendarItem(event, dateOverride)
  }

  /** Timed drop onto an hour: open compose with that start time on the target day. */
  async function editTimedAtHour(event: CalendarEvent, iso: string, hour: number) {
    const id = parseEventId(event)
    setLoadingEvent(event.id)
    try {
      const record = await calendarEvents.get(id)
      // Preserve however long it already was — dropping an event somewhere
      // else moves it, it doesn't reset it to an hour.
      const previousStart = parseTimeToMinutes(event.start_time)
      const previousEnd = parseTimeToMinutes(event.end_time)
      const duration =
        previousStart != null && previousEnd != null && previousEnd > previousStart
          ? previousEnd - previousStart
          : 60
      const startMinutes = Math.round(hour * 60)
      const start = minutesToTime(startMinutes)
      const end = minutesToTime(Math.min(startMinutes + duration, 23 * 60 + 59))
      openCompose({
        kind: 'event',
        date: iso,
        existingEvent: {
          ...record,
          date: iso,
          all_day: false,
          start_time: `${start}:00`,
          end_time: `${end}:00`,
        },
      })
    } catch (err) {
      notify(formatApiError(err), 'error')
    } finally {
      setLoadingEvent(null)
    }
  }

  /** Silent hour drop for todos — keeps duration when already timed. */
  async function moveTodoAtHour(item: CalendarEvent, iso: string, hour: number) {
    setMovingId(item.id)
    try {
      const start = hour * 60
      const oldStart = parseTimeToMinutes(item.start_time) ?? start
      const oldEnd = parseTimeToMinutes(item.end_time) ?? oldStart + 60
      const duration = Math.max(15, oldEnd - oldStart)
      const end = Math.min(start + duration, 23 * 60 + 59)
      await todos.update(parseEventId(item), {
        due_date: iso,
        due_time: `${minutesToTime(start)}:00`,
        due_end_time: `${minutesToTime(end)}:00`,
      })
      notify('Todo moved.')
      calendar.reload()
    } catch (err) {
      notify(formatApiError(err), 'error')
    } finally {
      setMovingId(null)
    }
  }

  /** Bottom-edge resize on the day timeline — snap already applied by DayTimeline. */
  async function resizeTimedItem(item: CalendarEvent, endMinutes: number) {
    setMovingId(item.id)
    try {
      const end = `${minutesToTime(Math.min(endMinutes, 23 * 60 + 59))}:00`
      if (item.domain === 'todo') {
        await todos.update(parseEventId(item), { due_end_time: end })
        notify('Todo duration updated.')
      } else {
        const record = await calendarEvents.get(parseEventId(item))
        await calendarEvents.update(record.id, {
          title: record.title,
          date: record.date,
          all_day: false,
          start_time: record.start_time,
          end_time: end,
          notes: record.notes,
          is_done: record.is_done,
          company: record.company,
          application: record.application,
          people: record.people,
          reminders: record.reminders.map((reminder) => ({
            minutes_before: reminder.minutes_before,
          })),
        })
        notify('Event duration updated.')
      }
      calendar.reload()
    } catch (err) {
      notify(formatApiError(err), 'error')
    } finally {
      setMovingId(null)
    }
  }

  function onChipDragStart(event: DragEvent, item: CalendarEvent) {
    if (!isMovable(item)) return
    event.dataTransfer.setData(DRAG_MIME, item.id)
    event.dataTransfer.effectAllowed = 'move'
    setDraggingId(item.id)
  }

  function onChipDragEnd() {
    setDraggingId(null)
    setDropTarget(null)
    setDropBeforeId(null)
    setDropHour(null)
  }

  function onChipDragOver(_event: DragEvent, item: CalendarEvent) {
    if (!draggingId || draggingId === item.id) return
    setDropTarget(item.date)
    setDropBeforeId(item.id)
    setDropHour(null)
  }

  function onDayDragOver(event: DragEvent, iso: string) {
    if (!draggingId) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    if (dropTarget !== iso) setDropTarget(iso)
    // Dropping on empty day area appends.
    if (dropBeforeId != null) setDropBeforeId(null)
    setDropHour(null)
  }

  function onDayDragLeave(iso: string) {
    setDropTarget((current) => (current === iso ? null : current))
  }

  function onHourDragOver(event: DragEvent, hour: number) {
    if (!draggingId) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setDropTarget(selectedDay)
    setDropHour(hour)
    setDropBeforeId(null)
  }

  function applySameDayReorder(iso: string, dragId: string, beforeId: string | null) {
    const dayEvents = eventsByDay.get(iso) ?? []
    const dragged = dayEvents.find((event) => event.id === dragId)
    // Timed cards stay sorted by clock; custom order is for all-day only.
    if (!dragged || isTimed(dragged)) return
    const untimed = dayEvents.filter((event) => !isTimed(event))
    const ids = untimed.map((event) => event.id)
    if (!ids.includes(dragId)) return
    const before =
      beforeId && untimed.some((event) => event.id === beforeId) ? beforeId : null
    saveDayOrder(iso, reorderIds(ids, dragId, before))
    setOrderVersion((value) => value + 1)
  }

  async function moveAllDayItem(item: CalendarEvent, iso: string) {
    setMovingId(item.id)
    try {
      if (item.domain === 'todo') {
        await todos.update(parseEventId(item), { due_date: iso })
        notify('Todo moved.')
      } else {
        const record = await calendarEvents.get(parseEventId(item))
        await calendarEvents.update(record.id, {
          title: record.title,
          date: iso,
          all_day: record.all_day,
          start_time: record.start_time,
          end_time: record.end_time,
          notes: record.notes,
          is_done: record.is_done,
          company: record.company,
          application: record.application,
          people: record.people,
          reminders: record.reminders.map((reminder) => ({
            minutes_before: reminder.minutes_before,
          })),
        })
        notify('Event moved.')
      }
      calendar.reload()
    } catch (err) {
      notify(formatApiError(err), 'error')
    } finally {
      setMovingId(null)
    }
  }

  async function onDayDrop(event: DragEvent, iso: string) {
    event.preventDefault()
    const beforeId = dropBeforeId
    const id = event.dataTransfer.getData(DRAG_MIME) || draggingId
    setDraggingId(null)
    setDropTarget(null)
    setDropBeforeId(null)
    setDropHour(null)
    if (!id) return

    const item = (calendar.data?.events ?? []).find((row) => row.id === id)
    if (!item || !isMovable(item)) return

    if (item.date === iso) {
      applySameDayReorder(iso, id, beforeId)
      return
    }

    setSelectedDay(iso)

    if (isTimed(item)) {
      // Todos keep their clock time when the day changes; custom events open
      // the editor so the user can confirm the new day.
      if (item.domain === 'todo') {
        await moveAllDayItem(item, iso)
        return
      }
      await editEvent(item, iso)
      return
    }

    await moveAllDayItem(item, iso)
  }

  /** The all-day strip: a timed todo/event dropped here becomes all-day. */
  async function onAllDayDrop(event: DragEvent, iso: string) {
    const id = event.dataTransfer.getData(DRAG_MIME) || draggingId
    const item = (calendar.data?.events ?? []).find((row) => row.id === id)
    if (!item || !isMovable(item) || !isTimed(item)) {
      await onDayDrop(event, iso)
      return
    }
    event.preventDefault()
    setDraggingId(null)
    setDropTarget(null)
    setDropBeforeId(null)
    setDropHour(null)
    setMovingId(item.id)
    try {
      if (item.domain === 'todo') {
        await todos.update(parseEventId(item), {
          due_date: iso,
          due_time: null,
          due_end_time: null,
        })
        notify('Todo is now all-day.')
      } else {
        const record = await calendarEvents.get(parseEventId(item))
        await calendarEvents.update(record.id, {
          title: record.title,
          date: iso,
          all_day: true,
          start_time: null,
          end_time: null,
          notes: record.notes,
          is_done: record.is_done,
          company: record.company,
          application: record.application,
          people: record.people,
          reminders: record.reminders.map((reminder) => ({
            minutes_before: reminder.minutes_before,
          })),
        })
        notify('Event is now all-day.')
      }
      calendar.reload()
    } catch (err) {
      notify(formatApiError(err), 'error')
    } finally {
      setMovingId(null)
    }
  }

  /** Create a fresh copy of a todo / event / catch-up on `targetDate`. */
  async function duplicateItem(item: CalendarEvent, targetDate: string) {
    setMovingId(item.id)
    try {
      const id = parseEventId(item)
      if (item.domain === 'todo') {
        const record = await todos.get(id)
        await todos.create({
          title: record.title,
          description: record.description,
          due_date: targetDate,
          due_time: record.due_time,
          due_end_time: record.due_end_time,
          priority: record.priority,
          status: 'open',
          application: record.application,
          person: record.person,
          company: record.company,
        })
        notify(`Todo duplicated onto ${targetDate}.`)
      } else if (item.domain === 'custom') {
        const record = await calendarEvents.get(id)
        await calendarEvents.create({
          title: record.title,
          date: targetDate,
          all_day: record.all_day,
          start_time: record.start_time,
          end_time: record.end_time,
          notes: record.notes,
          is_done: false,
          company: record.company,
          application: record.application,
          people: record.people,
          reminders: record.reminders.map((reminder) => ({
            minutes_before: reminder.minutes_before,
          })),
        })
        notify(`Event duplicated onto ${targetDate}.`)
      } else {
        const record = await catchups.get(id)
        await catchups.create({
          person: record.person,
          met_on: targetDate,
          title: record.title,
          format: record.format,
          format_other: record.format_other,
          message_channel: record.message_channel,
          location: record.location,
          minutes: record.minutes,
          takeaways: record.takeaways,
          follow_up_on: null,
        })
        notify(`Catch-up duplicated onto ${targetDate}.`)
      }
      setSelectedDay(targetDate)
      calendar.reload()
    } catch (err) {
      notify(formatApiError(err), 'error')
    } finally {
      setMovingId(null)
    }
  }

  function chipFromTarget(target: EventTarget | null): CalendarEvent | null {
    const el = (target as HTMLElement | null)?.closest?.('[data-event-id]') as HTMLElement | null
    const id = el?.dataset.eventId
    if (!id) return null
    return (calendar.data?.events ?? []).find((row) => row.id === id) ?? null
  }

  function onCalendarContextMenu(event: ReactMouseEvent<HTMLDivElement>) {
    const item = chipFromTarget(event.target)
    if (!item || !isDuplicable(item)) return
    event.preventDefault()
    setContextMenu({ x: event.clientX, y: event.clientY, item })
  }

  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('keydown', close)
    }
  }, [contextMenu])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
      if (isEditableTarget(event.target) || compose.open || viewing) return
      const key = event.key.toLowerCase()
      if (key === 'c') {
        const item = hoveredRef.current
        if (!item || !isDuplicable(item)) return
        // Only claim the shortcut when there's something to copy — a plain
        // text selection elsewhere on the page still copies as usual.
        event.preventDefault()
        setClipboard(item)
        notify(`Copied "${item.title}" — press ⌘V on a day to paste.`)
      } else if (key === 'v') {
        if (!clipboard) return
        event.preventDefault()
        void duplicateItem(clipboard, selectedDay)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipboard, selectedDay, compose.open, viewing, calendar.data])

  async function onHourDrop(event: DragEvent, hour: number) {
    event.preventDefault()
    const id = event.dataTransfer.getData(DRAG_MIME) || draggingId
    setDraggingId(null)
    setDropTarget(null)
    setDropBeforeId(null)
    setDropHour(null)
    if (!id) return

    const item = (calendar.data?.events ?? []).find((row) => row.id === id)
    if (!item || !isMovable(item)) return

    if (item.domain === 'todo') {
      await moveTodoAtHour(item, selectedDay, hour)
      return
    }

    await editTimedAtHour(item, selectedDay, hour)
  }

  async function exportCalendar() {
    setExporting(true)
    try {
      const [start, end, label] =
        viewMode === 'year'
          ? [toIsoDate(new Date(year, 0, 1)), toIsoDate(new Date(year, 11, 31)), String(year)]
          : viewMode === 'week'
            ? [
                toIsoDate(weekDays[0]),
                toIsoDate(weekDays[6]),
                `week-${toIsoDate(weekDays[0])}`,
              ]
            : viewMode === 'day'
              ? [selectedDay, selectedDay, selectedDay]
              : [
                  toIsoDate(new Date(year, month, 1)),
                  toIsoDate(new Date(year, month + 1, 0)),
                  cursor
                    .toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
                    .replace(' ', '-'),
                ]
      const url = dashboard.calendarIcsUrl({ start, end })
      await downloadFile(url, `career-tracker-${label}.ics`)
      notify('Calendar exported.')
    } catch (err) {
      notify(formatApiError(err), 'error')
    } finally {
      setExporting(false)
    }
  }

  const selectedEvents = eventsByDay.get(selectedDay) ?? []

  const navLabel =
    viewMode === 'year'
      ? String(year)
      : viewMode === 'week'
        ? `${weekDays[0].toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${weekDays[6].toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
        : viewMode === 'day'
          ? new Date(`${selectedDay}T12:00:00`).toLocaleDateString(undefined, {
              weekday: 'short',
              month: 'long',
              day: 'numeric',
              year: 'numeric',
            })
          : cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onContextMenu={onCalendarContextMenu}
      onMouseOver={(event) => {
        hoveredRef.current = chipFromTarget(event.target)
      }}
    >
      <PageHeader
        className="mb-3 shrink-0"
        title="Calendar"
        subtitle="Every follow-up, catch-up and task due date, in one place."
        action={
          <>
            <Button variant="primary" onClick={() => openCompose({ kind: 'event' })} icon={<Icon name="plus" size={15} />}>
              Add
            </Button>
            <Button
              onClick={() => void exportCalendar()}
              loading={exporting}
              icon={<Icon name="calendar" size={15} />}
            >
              Export (.ics)
            </Button>
          </>
        }
      />

      <div className="mb-2 flex shrink-0 flex-wrap items-center gap-2">
        <div className="inline-flex items-center rounded-lg border border-line bg-surface p-0.5">
          <button
            type="button"
            onClick={() => jump(-1)}
            aria-label="Previous"
            className="rounded-md p-1.5 text-ink-2 hover:bg-surface-2 hover:text-ink"
          >
            <Icon name="chevronLeft" size={15} />
          </button>
          <span className="min-w-36 px-1 text-center text-[13px] font-medium text-ink">{navLabel}</span>
          <button
            type="button"
            onClick={() => jump(1)}
            aria-label="Next"
            className="rounded-md p-1.5 text-ink-2 hover:bg-surface-2 hover:text-ink"
          >
            <Icon name="chevronRight" size={15} />
          </button>
        </div>
        <button
          type="button"
          onClick={() => updateParams({ month: null, day: null })}
          className="rounded-lg border border-line bg-surface px-3 py-1.5 text-[13px] font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
        >
          Today
        </button>

        <div className="inline-flex items-center rounded-lg border border-line bg-surface p-0.5">
          {VIEW_MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setViewMode(mode)}
              aria-pressed={viewMode === mode}
              className={cx(
                'rounded-md px-2.5 py-1 text-[12.5px] font-medium capitalize transition-colors',
                viewMode === mode ? 'bg-brand-soft text-brand-strong' : 'text-ink-2 hover:bg-surface-2',
              )}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      <FilterDrawer
        id="calendar"
        label="Show"
        className="mb-2 shrink-0"
        // Hidden kinds count as live filters; all-on is the default and shows no badge.
        activeCount={DOMAINS.length - activeDomains.size + (unsubmittedOnly ? 1 : 0)}
        trailing={<CalendarGlowSettings />}
      >
        {DOMAINS.map((domain) => {
          const meta = CALENDAR_DOMAIN_META[domain]
          const active = activeDomains.has(domain)
          return (
            <button
              key={domain}
              type="button"
              onClick={() => toggleDomain(domain)}
              aria-pressed={active}
              className={cx(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors',
                // The filter doubles as the legend: lit in the chip colour
                // it filters, muted when off.
                active ? TONE_CHIP[meta.tone] : 'border-line text-ink-3 hover:bg-surface-2',
              )}
            >
              <Icon name={meta.icon} size={12} />
              {meta.label}
            </button>
          )
        })}
        <span className="mx-1 hidden h-4 w-px bg-line sm:inline-block" aria-hidden />
        <button
          type="button"
          onClick={() => updateParams({ unsubmitted: unsubmittedOnly ? null : '1' })}
          aria-pressed={unsubmittedOnly}
          title="Only application dates for applications you haven't submitted yet"
          className={cx(
            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors',
            unsubmittedOnly
              ? 'border-brand bg-brand-soft text-brand-strong'
              : 'border-dashed border-line text-ink-3 hover:bg-surface-2',
          )}
        >
          <Icon name="edit" size={12} />
          Not submitted only
        </button>
      </FilterDrawer>

      {calendar.error && !calendar.data ? (
        <ErrorState message={calendar.error} onRetry={calendar.reload} />
      ) : calendar.initial ? (
        <Loading />
      ) : viewMode === 'year' ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {months.map((grid, monthIndex) => (
            <MiniMonth
              key={monthIndex}
              year={year}
              month={monthIndex}
              days={grid}
              today={today}
              eventsByDay={eventsByDay}
              onPick={openDayInMonthView}
              onCompose={(date) => composeOnDate(toIsoDate(date))}
            />
          ))}
        </div>
      ) : viewMode === 'week' ? (
        <WeekView
          days={weekDays}
          today={today}
          selectedDay={selectedDay}
          eventsByDay={eventsByDay}
          draggingId={draggingId}
          dropTarget={dropTarget}
          dropBeforeId={dropBeforeId}
          movingId={movingId}
          onSelectDay={setSelectedDay}
          onOpenDay={(iso) => {
            updateParams({
              view: 'day',
              day: iso === todayIso ? null : iso,
            })
          }}
          onComposeDay={(iso) => composeOnDate(iso)}
          onDayDragOver={onDayDragOver}
          onDayDragLeave={onDayDragLeave}
          onDayDrop={(event, iso) => void onDayDrop(event, iso)}
          onChipDragStart={onChipDragStart}
          onChipDragEnd={onChipDragEnd}
          onChipDragOver={onChipDragOver}
          onOpen={(event) => void openCalendarItem(event)}
        />
      ) : viewMode === 'day' ? (
        <DayTimeline
          iso={selectedDay}
          events={selectedEvents}
          draggingId={draggingId}
          dropTarget={dropTarget}
          dropBeforeId={dropBeforeId}
          dropHour={dropHour}
          movingId={movingId}
          onDayDragOver={onDayDragOver}
          onDayDragLeave={onDayDragLeave}
          onDayDrop={(event, iso) => void onDayDrop(event, iso)}
          onAllDayDrop={(event, iso) => void onAllDayDrop(event, iso)}
          onHourDragOver={onHourDragOver}
          onHourDrop={(event, hour) => void onHourDrop(event, hour)}
          onHourDragLeave={() => setDropHour(null)}
          onChipDragStart={onChipDragStart}
          onChipDragEnd={onChipDragEnd}
          onChipDragOver={onChipDragOver}
          onOpen={(event) => void openCalendarItem(event)}
          onComposeAtHour={(hour) =>
            composeOnDate(selectedDay, {
              allDay: false,
              startTime: minutesToTime(hour * 60),
            })
          }
          onComposeAllDay={() => composeOnDate(selectedDay, { allDay: true })}
          onResizeEnd={(event, endMinutes) => void resizeTimedItem(event, endMinutes)}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden lg:flex-row lg:items-stretch lg:gap-4">
          <Card padded={false} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <div className="grid shrink-0 grid-cols-7 border-b border-line text-center text-[11px] font-semibold uppercase tracking-wide text-ink-3">
              {WEEKDAYS.map((day) => (
                <div key={day} className="py-2">
                  {day}
                </div>
              ))}
            </div>
            <div
              className="grid min-h-0 flex-1 grid-cols-7 overflow-hidden"
              style={monthEqualRowStyle}
            >
              {days.map((date) => {
                const iso = toIsoDate(date)
                const inMonth = date.getMonth() === month
                const isToday = isSameDay(date, today)
                const isSelected = iso === selectedDay
                const dayEvents = sortMonthCellEvents(eventsByDay.get(iso) ?? [])
                const isDropTarget = dropTarget === iso && draggingId != null

                return (
                  <div
                    key={iso}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedDay(iso)}
                    onDoubleClick={() => composeOnDate(iso)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        setSelectedDay(iso)
                      }
                    }}
                    onDragOver={(event) => onDayDragOver(event, iso)}
                    onDragLeave={() => onDayDragLeave(iso)}
                    onDrop={(event) => void onDayDrop(event, iso)}
                    className={cx(
                      'flex h-full min-h-0 flex-col items-stretch gap-0.5 overflow-hidden border-b border-r border-line p-1 text-left transition-colors sm:p-1.5',
                      inMonth ? 'bg-surface' : 'bg-surface-2/60',
                      isSelected && 'ring-2 ring-inset ring-brand',
                      isDropTarget && 'bg-brand-soft/70 ring-2 ring-inset ring-brand',
                    )}
                  >
                    <span
                      className={cx(
                        'mx-auto grid size-5 shrink-0 place-items-center rounded-full text-[11.5px] font-medium md:mx-0',
                        isToday ? 'bg-brand text-white' : inMonth ? 'text-ink' : 'text-ink-3',
                      )}
                    >
                      {date.getDate()}
                    </span>
                    {/* Phones: tone dots + more — full lines need desktop width. */}
                    {dayEvents.length > 0 ? (
                      <span className="mt-auto flex flex-wrap items-center gap-0.5 pb-0.5 md:hidden">
                        {dayEvents.slice(0, 4).map((event) => (
                          <span
                            key={event.id}
                            className={cx(
                              'size-1.5 rounded-full',
                              TONE_DOT[calendarEventTone(event)],
                            )}
                            title={event.title}
                          />
                        ))}
                        {dayEvents.length > 4 ? (
                          <button
                            type="button"
                            onClick={(click) => {
                              click.stopPropagation()
                              openDayPeek(iso)
                            }}
                            className="text-[9px] font-semibold leading-none text-ink-3 hover:text-ink"
                          >
                            {dayEvents.length - 4} more
                          </button>
                        ) : null}
                      </span>
                    ) : null}
                    <MonthDayEventStack
                      events={dayEvents}
                      draggingId={draggingId}
                      movingId={movingId}
                      dropBeforeId={dropBeforeId}
                      dropTargetIso={dropTarget}
                      cellIso={iso}
                      onDragStart={onChipDragStart}
                      onDragEnd={onChipDragEnd}
                      onDragOverChip={onChipDragOver}
                      onOpen={(event) => void openCalendarItem(event)}
                      onMore={() => openDayPeek(iso)}
                    />
                  </div>
                )
              })}
            </div>
          </Card>

          <div className="flex w-full shrink-0 flex-col lg:h-auto lg:w-[17.5rem] lg:self-stretch xl:w-[21rem]">
            <DaySidebar
              selectedDay={selectedDay}
              selectedEvents={selectedEvents}
              loadingEvent={loadingEvent}
              draggingId={draggingId}
              onAdd={() => openCompose({ kind: 'event', date: selectedDay })}
              onOpen={(event) => void openCalendarItem(event)}
              onChipDragStart={onChipDragStart}
              onChipDragEnd={onChipDragEnd}
            />
          </div>
        </div>
      )}

      {peekDay ? (
        <MonthDayPeek
          iso={peekDay}
          events={eventsByDay.get(peekDay) ?? []}
          onClose={() => setPeekDay(null)}
          onOpen={(event) => void openCalendarItem(event)}
          onAdd={() => openCompose({ kind: 'event', date: peekDay })}
        />
      ) : null}

      <CalendarComposeModal
        state={compose}
        todoChoices={todoChoices.data}
        catchupChoices={catchupChoices.data}
        onClose={closeCompose}
        onKindChange={(kind, draft) => setCompose((prev) => ({ ...prev, kind, draft }))}
        onSaved={() => void finishCompose()}
      />

      {viewing ? (
        <CalendarItemView
          item={viewing}
          from={location.pathname + location.search}
          onClose={() => {
            setViewing(null)
            markOpen(null)
          }}
          onEdit={() => {
            if (viewing.kind === 'event') {
              openCompose({
                kind: 'event',
                date: viewing.record.date,
                existingEvent: viewing.record,
              })
            } else {
              openCompose({
                kind: 'todo',
                date: viewing.record.due_date ?? selectedDay,
                existingTodo: viewing.record,
              })
            }
            setViewing(null)
          }}
        />
      ) : null}

      {contextMenu ? (
        <div
          role="menu"
          className="fixed z-50 min-w-44 overflow-hidden rounded-lg border border-line bg-surface py-1 text-[13px] shadow-lg"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onContextMenu={(event) => event.preventDefault()}
        >
          <p className="truncate px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
            {contextMenu.item.title}
          </p>
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-ink hover:bg-surface-2"
            onClick={() => {
              const { item } = contextMenu
              setContextMenu(null)
              void duplicateItem(item, item.date)
            }}
          >
            <Icon name="copy" size={14} />
            Duplicate here
          </button>
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-ink hover:bg-surface-2"
            onClick={() => {
              const { item } = contextMenu
              setContextMenu(null)
              setClipboard(item)
              notify(`Copied "${item.title}" — press ⌘V on a day to paste.`)
            }}
          >
            <Icon name="copy" size={14} />
            Copy (⌘C)
          </button>
          {clipboard ? (
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-ink hover:bg-surface-2"
              onClick={() => {
                const target = contextMenu.item.date
                setContextMenu(null)
                void duplicateItem(clipboard, target)
              }}
            >
              <Icon name="plus" size={14} />
              Paste "{clipboard.title}" on {contextMenu.item.date}
            </button>
          ) : null}
        </div>
      ) : null}

      {linkedPreview ? (
        <CalendarLinkedPreview
          event={linkedPreview}
          from={location.pathname + location.search}
          onClose={() => {
            setLinkedPreview(null)
            markOpen(null)
          }}
          onSaved={() => calendar.reload()}
        />
      ) : null}
    </div>
  )
}

function CalendarGlowSettings() {
  const [effects, setEffects] = useCalendarEffects()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Calendar display settings"
        className={cx(
          'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors',
          open || effects.enabled
            ? 'border-brand bg-brand-soft text-brand-strong'
            : 'border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink',
        )}
      >
        <Icon name="settings" size={13} />
        Effects
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="Deadline glow"
          className="absolute right-0 top-[calc(100%+0.4rem)] z-30 w-56 rounded-xl border border-line bg-surface-solid p-3 shadow-xl"
        >
          <p className="text-[12px] font-semibold text-ink">Deadline glow</p>
          <p className="mt-0.5 text-[11px] text-ink-3">
            Soft orbit around application closing dates.
          </p>
          <div className="mt-3 flex items-center justify-between gap-2">
            <span className="text-[12.5px] text-ink-2">Enabled</span>
            <Switch
              checked={effects.enabled}
              onChange={(enabled) => setEffects({ ...effects, enabled })}
              label="Deadline glow effects"
            />
          </div>
          {effects.enabled ? (
            <div className="mt-3">
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-3">
                Colour
              </p>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Glow colour">
                {CALENDAR_EFFECT_COLORS.map((row) => (
                  <button
                    key={row.value}
                    type="button"
                    title={row.label}
                    aria-label={row.label}
                    aria-pressed={effects.color === row.value}
                    onClick={() => setEffects({ ...effects, color: row.value })}
                    className={cx(
                      'size-5 rounded-full border-2 transition-transform',
                      effects.color === row.value
                        ? 'scale-110 border-ink'
                        : 'border-transparent opacity-70 hover:opacity-100',
                    )}
                    style={{ background: row.cssVar }}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function DaySidebar({
  selectedDay,
  selectedEvents,
  loadingEvent,
  draggingId,
  onAdd,
  onOpen,
  onChipDragStart,
  onChipDragEnd,
}: {
  selectedDay: string
  selectedEvents: CalendarEvent[]
  loadingEvent: string | null
  draggingId: string | null
  onAdd: () => void
  onOpen: (event: CalendarEvent) => void
  onChipDragStart: (event: DragEvent, item: CalendarEvent) => void
  onChipDragEnd: () => void
}) {
  const [effects] = useCalendarEffects()

  return (
    <Card className="flex h-full min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-hidden">
      <div className="flex shrink-0 items-baseline justify-between gap-2">
        <h2 className="min-w-0 truncate text-sm font-semibold text-ink">
          {new Date(`${selectedDay}T12:00:00`).toLocaleDateString(undefined, {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          })}
        </h2>
        <button
          type="button"
          onClick={onAdd}
          className="shrink-0 text-[12px] font-medium text-brand hover:underline"
        >
          + Add
        </button>
      </div>
      {selectedEvents.length === 0 ? (
        <p className="mt-3 text-[13px] text-ink-3">Nothing due this day.</p>
      ) : (
        <ul className="mt-3 flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-x-hidden overflow-y-auto">
          {selectedEvents.map((event) => {
            const meta = CALENDAR_DOMAIN_META[event.domain]
            const movable = isMovable(event)
            const timeRange =
              event.all_day === false && event.start_time
                ? formatTimeRangeShort(event.start_time, event.end_time)
                : null
            const isDeadline = event.domain === 'application_deadline' && !event.done
            return (
              <li key={event.id} className="min-w-0">
                <button
                  type="button"
                  draggable={movable}
                  onDragStart={(drag) => onChipDragStart(drag, event)}
                  onDragEnd={onChipDragEnd}
                  onClick={() => onOpen(event)}
                  disabled={loadingEvent === event.id}
                  aria-label={`Open ${event.title}`}
                  data-deadline-fx={isDeadline ? (effects.enabled ? 'on' : 'off') : undefined}
                  style={
                    isDeadline
                      ? ({
                          ['--deadline-glow' as string]: calendarEffectCssVar(effects.color),
                        } as CSSProperties)
                      : undefined
                  }
                  className={cx(
                    'flex w-full min-w-0 max-w-full items-start gap-2.5 rounded-lg border border-transparent px-1.5 py-2 text-left transition-colors hover:bg-surface-2',
                    draggingId === event.id && 'opacity-40',
                    movable && 'cursor-grab active:cursor-grabbing',
                    isDeadline && 'calendar-deadline-chip border-critical/40 bg-critical/5',
                  )}
                >
                  {event.person ? (
                    <Avatar name={event.person.full_name} src={event.person.photo} size="xs" className="mt-0.5 shrink-0" />
                  ) : event.company ? (
                    <CompanyMark
                      name={event.company.name}
                      logo={event.company.logo}
                      size={28}
                      className="mt-0.5 shrink-0 rounded-lg shadow-none"
                    />
                  ) : (
                    <span
                      className={cx(
                        'mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg border',
                        TONE_CHIP[calendarEventTone(event)],
                      )}
                    >
                      <Icon name={meta.icon} size={14} />
                    </span>
                  )}
                  <span className="min-w-0 flex-1 overflow-hidden">
                    <span
                      className={cx(
                        'block truncate text-[13px]',
                        event.done ? 'text-ink-3 line-through' : 'text-ink',
                      )}
                    >
                      {event.title}
                    </span>
                    <span className="mt-1 flex min-w-0 items-end justify-between gap-2">
                      <span className="min-w-0 truncate text-[11.5px] text-ink-3">
                        {meta.label}
                        {event.details ? ` · ${event.details}` : ''}
                      </span>
                      {timeRange ? (
                        <span className={cx('shrink-0 text-[11.5px]', CALENDAR_TIME_CLASS)}>
                          {timeRange}
                        </span>
                      ) : null}
                    </span>
                  </span>
                  {loadingEvent === event.id ? (
                    <Icon name="clock" size={13} className="mt-1 shrink-0 animate-pulse text-ink-3" />
                  ) : null}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

const MINI_WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

function MiniMonth({
  year,
  month,
  days,
  today,
  eventsByDay,
  onPick,
  onCompose,
}: {
  year: number
  month: number
  days: Date[]
  today: Date
  eventsByDay: Map<string, CalendarEvent[]>
  onPick: (date: Date) => void
  onCompose: (date: Date) => void
}) {
  return (
    <Card>
      <h3 className="text-[13px] font-semibold text-ink">
        {new Date(year, month, 1).toLocaleDateString(undefined, { month: 'long' })}
      </h3>
      <div className="mt-2 grid grid-cols-7 gap-y-1 text-center">
        {MINI_WEEKDAYS.map((day, i) => (
          <div key={i} className="text-[9.5px] font-semibold uppercase text-ink-3">
            {day}
          </div>
        ))}
        {days.map((date) => {
          const iso = toIsoDate(date)
          const inMonth = date.getMonth() === month
          const isToday = isSameDay(date, today)
          const hasEvents = (eventsByDay.get(iso)?.length ?? 0) > 0

          return (
            <button
              key={iso}
              type="button"
              onClick={() => onPick(date)}
              onDoubleClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                if (inMonth) onCompose(date)
              }}
              disabled={!inMonth}
              className={cx(
                'mx-auto flex size-6 flex-col items-center justify-center rounded-full text-[10.5px]',
                !inMonth && 'invisible',
                isToday ? 'bg-brand text-white font-medium' : 'text-ink-2 hover:bg-surface-2',
              )}
            >
              {date.getDate()}
              <span
                className={cx(
                  'mt-0.5 size-1 rounded-full',
                  hasEvents ? (isToday ? 'bg-white' : 'bg-brand') : 'bg-transparent',
                )}
              />
            </button>
          )
        })}
      </div>
    </Card>
  )
}
