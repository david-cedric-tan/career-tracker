import { useEffect, useMemo, useState, type DragEvent } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { formatApiError } from '../api/client'
import { calendarEvents, dashboard, todos } from '../api/resources'
import type { CalendarEvent, CalendarEventRecord, Todo } from '../api/types'
import { DayEventChip } from '../components/calendar/DayEventChip'
import { DayTimeline } from '../components/calendar/DayTimeline'
import { CalendarItemView, type CalendarItem } from '../components/calendar/CalendarItemView'
import { CalendarLinkedPreview } from '../components/calendar/CalendarLinkedPreview'
import { WeekView } from '../components/calendar/WeekView'
import { CalendarEventForm } from '../components/CalendarEventForm'
import { TodoForm } from '../components/TodoForm'
import { PageHeader } from '../components/layout/PageHeader'
import { Avatar } from '../components/ui/Avatar'
import { Button } from '../components/ui/Button'
import { CompanyMark } from '../components/ui/CompanyMark'
import { Card } from '../components/ui/Card'
import { FilterDrawer } from '../components/ui/FilterDrawer'
import { Icon } from '../components/ui/Icon'
import { ErrorState, Loading } from '../components/ui/States'
import { useToast } from '../components/ui/toast-context'
import { useAutoOpenFromQuery } from '../hooks/useAutoOpenFromQuery'
import { useResource } from '../hooks/useResource'
import {
  addDaysIso,
  minutesToTime,
  readExpandAll,
  reorderIds,
  saveDayOrder,
  sortEventsBySavedOrder,
  weekDaysFor,
  writeExpandAll,
} from '../lib/calendarView'
import { downloadFile } from '../lib/download'
import { cx, formatTime } from '../lib/format'
import { rememberList } from '../lib/listState'
import { CALENDAR_DOMAIN_META, TONE_CHIP, calendarEventTone } from '../lib/tones'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DOMAINS = Object.keys(CALENDAR_DOMAIN_META) as (keyof typeof CALENDAR_DOMAIN_META)[]
const MAX_VISIBLE_PER_DAY = 3
const DRAG_MIME = 'application/x-career-tracker-calendar'
const VIEW_MODES = ['day', 'week', 'month', 'year'] as const
type ViewMode = (typeof VIEW_MODES)[number]

function isMovable(event: CalendarEvent): boolean {
  return event.domain === 'custom' || event.domain === 'todo'
}

function isTimed(event: CalendarEvent): boolean {
  return event.domain === 'custom' && event.all_day === false
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

  useEffect(() => {
    rememberList('calendar', params.toString() ? `?${params}` : '')
  }, [params])

  const [exporting, setExporting] = useState(false)
  const [eventForm, setEventForm] = useState<{
    open: boolean
    existing: CalendarEventRecord | null
    defaultAllDay?: boolean
    defaultStartTime?: string
  }>({ open: false, existing: null })
  const [viewing, setViewing] = useState<CalendarItem | null>(null)
  const [todoForm, setTodoForm] = useState<{ open: boolean; existing: Todo | null }>({
    open: false,
    existing: null,
  })
  const [linkedPreview, setLinkedPreview] = useState<CalendarEvent | null>(null)
  const [loadingEvent, setLoadingEvent] = useState<string | null>(null)
  const [daysExpanded, setDaysExpanded] = useState(readExpandAll)
  const [orderVersion, setOrderVersion] = useState(0)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [dropBeforeId, setDropBeforeId] = useState<string | null>(null)
  const [dropHour, setDropHour] = useState<number | null>(null)
  const [movingId, setMovingId] = useState<string | null>(null)

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

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>()
    for (const event of calendar.data?.events ?? []) {
      if (!activeDomains.has(event.domain)) continue
      const list = map.get(event.date) ?? []
      list.push(event)
      map.set(event.date, list)
    }
    for (const [date, list] of map) {
      map.set(date, sortEventsBySavedOrder(date, list))
    }
    return map
    // orderVersion forces re-sort after a same-day reorder.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendar.data, activeDomains, orderVersion])

  const days = useMemo(() => buildMonthGrid(year, month), [year, month])
  const months = useMemo(
    () => (viewMode === 'year' ? Array.from({ length: 12 }, (_, m) => buildMonthGrid(year, m)) : []),
    [year, viewMode],
  )

  const monthHasOverflow = useMemo(() => {
    if (viewMode !== 'month') return false
    return days.some((date) => (eventsByDay.get(toIsoDate(date))?.length ?? 0) > MAX_VISIBLE_PER_DAY)
  }, [days, eventsByDay, viewMode])

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

  function setDaysExpandedAll(value: boolean) {
    setDaysExpanded(value)
    writeExpandAll(value)
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

  function addEvent(options?: { allDay?: boolean; startTime?: string; date?: string }) {
    if (options?.date) setSelectedDay(options.date)
    setEventForm({
      open: true,
      existing: null,
      defaultAllDay: options?.allDay,
      defaultStartTime: options?.startTime,
    })
  }

  useAutoOpenFromQuery('new', () => addEvent())

  useAutoOpenFromQuery('event', (value) => {
    const id = Number(value)
    if (!Number.isFinite(id)) return
    void calendarEvents
      .get(id)
      .then((record) => setEventForm({ open: true, existing: record }))
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
  // an edit, so that goes straight to the form with the new date filled in.
  async function openCalendarItem(event: CalendarEvent, dateOverride?: string) {
    setLoadingEvent(event.id)
    if (!dateOverride) markOpen(event.id)
    try {
      if (event.domain === 'custom') {
        const record = await calendarEvents.get(parseEventId(event))
        if (dateOverride) setEventForm({ open: true, existing: { ...record, date: dateOverride } })
        else setViewing({ kind: 'event', record })
        return
      }
      if (event.domain === 'todo') {
        const record = await todos.get(parseEventId(event))
        if (dateOverride) setTodoForm({ open: true, existing: { ...record, due_date: dateOverride } })
        else setViewing({ kind: 'todo', record })
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

  /** Timed drop onto an hour: open editor with that start time on the target day. */
  async function editTimedAtHour(event: CalendarEvent, iso: string, hour: number) {
    const id = parseEventId(event)
    setLoadingEvent(event.id)
    try {
      const record = await calendarEvents.get(id)
      const start = minutesToTime(hour * 60)
      const end = minutesToTime(hour * 60 + 60)
      setEventForm({
        open: true,
        existing: {
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
    const current = (eventsByDay.get(iso) ?? []).map((event) => event.id)
    if (!current.includes(dragId)) return
    const next = reorderIds(current, dragId, beforeId)
    saveDayOrder(iso, next)
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
      await editEvent(item, iso)
      return
    }

    await moveAllDayItem(item, iso)
  }

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
      if (item.date !== selectedDay) await moveAllDayItem(item, selectedDay)
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
    <>
      <PageHeader
        title="Calendar"
        subtitle="Every follow-up, catch-up and task due date, in one place."
        action={
          <>
            <Button variant="primary" onClick={() => addEvent()} icon={<Icon name="plus" size={15} />}>
              Add event
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

      <div className="mb-4 flex flex-wrap items-center gap-2">
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

        {viewMode === 'month' && monthHasOverflow ? (
          <button
            type="button"
            onClick={() => setDaysExpandedAll(!daysExpanded)}
            className="rounded-lg border border-line bg-surface px-3 py-1.5 text-[12.5px] font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
          >
            {daysExpanded ? 'Collapse all' : 'Expand all'}
          </button>
        ) : null}

      </div>

      <FilterDrawer
        id="calendar"
        label="Show"
        className="mb-4"
        // Hidden kinds count as live filters; all-on is the default and shows no badge.
        activeCount={DOMAINS.length - activeDomains.size}
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
          onHourDragOver={onHourDragOver}
          onHourDrop={(event, hour) => void onHourDrop(event, hour)}
          onChipDragStart={onChipDragStart}
          onChipDragEnd={onChipDragEnd}
          onChipDragOver={onChipDragOver}
          onOpen={(event) => void openCalendarItem(event)}
          onCreateAtHour={(hour) =>
            addEvent({
              allDay: false,
              startTime: minutesToTime(hour * 60),
              date: selectedDay,
            })
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_20rem] xl:grid-cols-[1fr_23rem]">
          <Card padded={false}>
            <div className="grid grid-cols-7 border-b border-line text-center text-[11px] font-semibold uppercase tracking-wide text-ink-3">
              {WEEKDAYS.map((day) => (
                <div key={day} className="py-2">
                  {day}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {days.map((date) => {
                const iso = toIsoDate(date)
                const inMonth = date.getMonth() === month
                const isToday = isSameDay(date, today)
                const isSelected = iso === selectedDay
                const dayEvents = eventsByDay.get(iso) ?? []
                const visible = daysExpanded
                  ? dayEvents
                  : dayEvents.slice(0, MAX_VISIBLE_PER_DAY)
                const overflow = dayEvents.length - MAX_VISIBLE_PER_DAY
                const isDropTarget = dropTarget === iso && draggingId != null

                return (
                  <div
                    key={iso}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedDay(iso)}
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
                      'flex min-h-20 flex-col items-stretch gap-1 border-b border-r border-line p-1.5 text-left transition-colors sm:min-h-24 xl:min-h-28',
                      inMonth ? 'bg-surface' : 'bg-surface-2/60',
                      isSelected && 'ring-2 ring-inset ring-brand',
                      isDropTarget && 'bg-brand-soft/70 ring-2 ring-inset ring-brand',
                    )}
                  >
                    <span
                      className={cx(
                        'grid size-5 place-items-center rounded-full text-[11.5px] font-medium',
                        isToday ? 'bg-brand text-white' : inMonth ? 'text-ink' : 'text-ink-3',
                      )}
                    >
                      {date.getDate()}
                    </span>
                    <span className="flex flex-col gap-0.5">
                      {visible.map((event) => (
                        <DayEventChip
                          key={event.id}
                          event={event}
                          dragging={draggingId === event.id}
                          moving={movingId === event.id}
                          dropBefore={dropBeforeId === event.id && dropTarget === iso}
                          onDragStart={onChipDragStart}
                          onDragEnd={onChipDragEnd}
                          onDragOverChip={onChipDragOver}
                          onOpen={() => void openCalendarItem(event)}
                        />
                      ))}
                      {overflow > 0 ? (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            setDaysExpandedAll(!daysExpanded)
                          }}
                          className="text-left text-[10px] font-medium text-ink-3 transition-colors hover:text-brand"
                        >
                          {daysExpanded ? 'Show less' : `+${overflow} more`}
                        </button>
                      ) : null}
                    </span>
                  </div>
                )
              })}
            </div>
          </Card>

          <DaySidebar
            selectedDay={selectedDay}
            selectedEvents={selectedEvents}
            loadingEvent={loadingEvent}
            draggingId={draggingId}
            onAdd={() => addEvent()}
            onOpen={(event) => void openCalendarItem(event)}
            onChipDragStart={onChipDragStart}
            onChipDragEnd={onChipDragEnd}
          />
        </div>
      )}

      <CalendarEventForm
        open={eventForm.open}
        existing={eventForm.existing}
        defaultDate={selectedDay}
        defaultAllDay={eventForm.defaultAllDay}
        defaultStartTime={eventForm.defaultStartTime}
        onClose={() => setEventForm({ open: false, existing: null })}
        onSaved={() => calendar.reload()}
        onDeleted={() => calendar.reload()}
      />

      <TodoForm
        open={todoForm.open}
        existing={todoForm.existing}
        choices={todoChoices.data}
        onClose={() => setTodoForm({ open: false, existing: null })}
        onSaved={() => calendar.reload()}
        onDeleted={() => calendar.reload()}
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
            if (viewing.kind === 'event') setEventForm({ open: true, existing: viewing.record })
            else setTodoForm({ open: true, existing: viewing.record })
            setViewing(null)
          }}
        />
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
    </>
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
  return (
    <Card>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">
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
          + Add event
        </button>
      </div>
      {selectedEvents.length === 0 ? (
        <p className="mt-3 text-[13px] text-ink-3">Nothing due this day.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {selectedEvents.map((event) => {
            const meta = CALENDAR_DOMAIN_META[event.domain]
            const movable = isMovable(event)
            return (
              <li key={event.id}>
                <button
                  type="button"
                  draggable={movable}
                  onDragStart={(drag) => onChipDragStart(drag, event)}
                  onDragEnd={onChipDragEnd}
                  onClick={() => onOpen(event)}
                  disabled={loadingEvent === event.id}
                  aria-label={`Open ${event.title}`}
                  className={cx(
                    '-mx-2 flex w-[calc(100%+1rem)] items-start gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-surface-2',
                    draggingId === event.id && 'opacity-40',
                    movable && 'cursor-grab active:cursor-grabbing',
                  )}
                >
                  {event.person ? (
                    <Avatar name={event.person.full_name} src={event.person.photo} size="xs" className="mt-0.5" />
                  ) : event.company ? (
                    <CompanyMark
                      name={event.company.name}
                      logo={event.company.logo}
                      size={28}
                      className="mt-0.5 rounded-lg shadow-none"
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
                  <span className="min-w-0 flex-1">
                    <span
                      className={cx(
                        'block truncate text-[13px]',
                        event.done ? 'text-ink-3 line-through' : 'text-ink',
                      )}
                    >
                      {event.title}
                    </span>
                    <span className="block text-[11.5px] text-ink-3">
                      {event.start_time
                        ? `${formatTime(event.start_time)}${event.end_time ? ` – ${formatTime(event.end_time)}` : ''} · `
                        : ''}
                      {meta.label}
                      {event.details ? ` · ${event.details}` : ''}
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
}: {
  year: number
  month: number
  days: Date[]
  today: Date
  eventsByDay: Map<string, CalendarEvent[]>
  onPick: (date: Date) => void
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
