import { useMemo, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { formatApiError } from '../api/client'
import { calendarEvents, dashboard } from '../api/resources'
import type { CalendarEvent, CalendarEventRecord } from '../api/types'
import { CalendarEventForm } from '../components/CalendarEventForm'
import { PageHeader } from '../components/layout/PageHeader'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Icon } from '../components/ui/Icon'
import { ErrorState, Loading } from '../components/ui/States'
import { useToast } from '../components/ui/toast-context'
import { useAutoOpenFromQuery } from '../hooks/useAutoOpenFromQuery'
import { useResource } from '../hooks/useResource'
import { cx, formatTime } from '../lib/format'
import { downloadFile } from '../lib/download'
import { CALENDAR_DOMAIN_META } from '../lib/tones'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DOMAINS = Object.keys(CALENDAR_DOMAIN_META) as (keyof typeof CALENDAR_DOMAIN_META)[]
const MAX_VISIBLE_PER_DAY = 3

function toIsoDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function isSameDay(a: Date, b: Date): boolean {
  return toIsoDate(a) === toIsoDate(b)
}

/** Every calendar cell a month grid needs to render, including the days from
    the previous/next month that pad the first/last week. */
function buildMonthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1)
  const start = new Date(year, month, 1 - first.getDay())
  return Array.from({ length: 42 }, (_, i) => {
    const date = new Date(start)
    date.setDate(start.getDate() + i)
    return date
  })
}

type ViewMode = 'month' | 'year'

/** `YYYY-MM` for a first-of-month Date. */
function toMonthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

/**
 * FR-CAL — every date-bearing domain in one place, read-only. This page owns
 * no data of its own; it only draws from what applications, todos, network
 * and catch-ups already have.
 */
export function CalendarPage() {
  const { notify } = useToast()
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const today = new Date()
  const todayIso = toIsoDate(today)

  // FR-NAV-01/02 — the whole view lives in the URL (view/month/day/domains),
  // not local state, so a link away and back — or a reload — restores
  // exactly what was on screen rather than resetting to "today, month view".
  const viewMode: ViewMode = params.get('view') === 'year' ? 'year' : 'month'
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

  const [exporting, setExporting] = useState(false)
  const [eventForm, setEventForm] = useState<{
    open: boolean
    existing: CalendarEventRecord | null
  }>({ open: false, existing: null })
  const [loadingEvent, setLoadingEvent] = useState<string | null>(null)

  const year = cursor.getFullYear()
  const month = cursor.getMonth()

  const range = useMemo(() => {
    if (viewMode === 'year') {
      return { start: toIsoDate(new Date(year, 0, 1)), end: toIsoDate(new Date(year, 11, 31)) }
    }
    const start = new Date(year, month, 1 - 7)
    const end = new Date(year, month + 1, 7)
    return { start: toIsoDate(start), end: toIsoDate(end) }
  }, [year, month, viewMode])

  const calendar = useResource(() => dashboard.calendar(range), [range.start, range.end])

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>()
    for (const event of calendar.data?.events ?? []) {
      if (!activeDomains.has(event.domain)) continue
      const list = map.get(event.date) ?? []
      list.push(event)
      map.set(event.date, list)
    }
    return map
  }, [calendar.data, activeDomains])

  const days = useMemo(() => buildMonthGrid(year, month), [year, month])
  const months = useMemo(
    () => (viewMode === 'year' ? Array.from({ length: 12 }, (_, m) => buildMonthGrid(year, m)) : []),
    [year, viewMode],
  )

  /** One search-param patch at a time — batching multiple field changes into
      a single `setSearchParams` call, since each call only sees the params
      snapshot from its own render (separate calls would clobber each other). */
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
    updateParams({ day: day === todayIso ? null : day })
  }

  function toggleDomain(domain: string) {
    const next = new Set(activeDomains)
    if (next.has(domain)) next.delete(domain)
    else next.add(domain)
    const isEverything = DOMAINS.every((d) => next.has(d))
    updateParams({ domains: isEverything ? null : Array.from(next).join(',') })
  }

  function jump(delta: number) {
    const next =
      viewMode === 'year' ? new Date(year + delta, month, 1) : new Date(year, month + delta, 1)
    const isCurrent = next.getFullYear() === today.getFullYear() && next.getMonth() === today.getMonth()
    updateParams({ month: isCurrent ? null : toMonthKey(next) })
  }

  /** Jump into month view focused on a day picked from the year grid. */
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

  function addEvent() {
    setEventForm({ open: true, existing: null })
  }

  // The onboarding tour's "try it" action for this page — `?new=1` opens the
  // same form the "Add event" button does.
  useAutoOpenFromQuery('new', addEvent)

  // `?event=<id>` opens one directly — the network's event rings link here so
  // "where we met" gets you straight to the entry it came from.
  useAutoOpenFromQuery('event', (value) => {
    const id = Number(value)
    if (!Number.isFinite(id)) return
    void calendarEvents
      .get(id)
      .then((record) => setEventForm({ open: true, existing: record }))
      .catch((err) => notify(formatApiError(err), 'error'))
  })

  /** The aggregated feed only carries what a calendar cell needs to render —
      fetch the full row (notes included) before editing it. */
  async function editEvent(event: CalendarEvent) {
    const id = Number(event.id.replace('custom-', ''))
    setLoadingEvent(event.id)
    try {
      const record = await calendarEvents.get(id)
      setEventForm({ open: true, existing: record })
    } catch (err) {
      notify(formatApiError(err), 'error')
    } finally {
      setLoadingEvent(null)
    }
  }

  /** Year view exports the whole year; month view exports exactly that
      month — narrower than `range`, which pads a week either side for the
      grid's leading/trailing days. */
  async function exportCalendar() {
    setExporting(true)
    try {
      const [start, end, label] =
        viewMode === 'year'
          ? [toIsoDate(new Date(year, 0, 1)), toIsoDate(new Date(year, 11, 31)), String(year)]
          : [
              toIsoDate(new Date(year, month, 1)),
              toIsoDate(new Date(year, month + 1, 0)),
              cursor.toLocaleDateString(undefined, { month: 'short', year: 'numeric' }).replace(' ', '-'),
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

  return (
    <>
      <PageHeader
        title="Calendar"
        subtitle="Every follow-up, catch-up and task due date, in one place."
        action={
          <>
            <Button variant="primary" onClick={addEvent} icon={<Icon name="plus" size={15} />}>
              Add event
            </Button>
            <Button
              onClick={() => void exportCalendar()}
              loading={exporting}
              icon={<Icon name="calendar" size={15} />}
            >
              Export{' '}
              {viewMode === 'year' ? year : cursor.toLocaleDateString(undefined, { month: 'short' })}{' '}
              (.ics)
            </Button>
          </>
        }
      />

      {/* One filter row above everything it scopes. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center rounded-lg border border-line bg-surface p-0.5">
          <button
            type="button"
            onClick={() => jump(-1)}
            aria-label={viewMode === 'year' ? 'Previous year' : 'Previous month'}
            className="rounded-md p-1.5 text-ink-2 hover:bg-surface-2 hover:text-ink"
          >
            <Icon name="chevronLeft" size={15} />
          </button>
          <span className="w-36 text-center text-[13px] font-medium text-ink">
            {viewMode === 'year'
              ? year
              : cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
          </span>
          <button
            type="button"
            onClick={() => jump(1)}
            aria-label={viewMode === 'year' ? 'Next year' : 'Next month'}
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
          {(['month', 'year'] as const).map((mode) => (
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

        <div className="flex flex-wrap items-center gap-1.5">
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
                  active
                    ? 'border-brand-ring bg-brand-soft text-brand-strong'
                    : 'border-line text-ink-3 hover:bg-surface-2',
                )}
              >
                <Icon name={meta.icon} size={12} />
                {meta.label}
              </button>
            )
          })}
        </div>
      </div>

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
                const overflow = dayEvents.length - MAX_VISIBLE_PER_DAY

                return (
                  <button
                    key={iso}
                    type="button"
                    onClick={() => setSelectedDay(iso)}
                    className={cx(
                      'flex min-h-20 flex-col items-stretch gap-1 border-b border-r border-line p-1.5 text-left transition-colors sm:min-h-24 xl:min-h-28',
                      inMonth ? 'bg-surface' : 'bg-surface-2/60',
                      isSelected && 'ring-2 ring-inset ring-brand',
                    )}
                  >
                    <span
                      className={cx(
                        'grid size-5 place-items-center rounded-full text-[11.5px] font-medium',
                        isToday
                          ? 'bg-brand text-white'
                          : inMonth
                            ? 'text-ink'
                            : 'text-ink-3',
                      )}
                    >
                      {date.getDate()}
                    </span>
                    <span className="flex flex-col gap-0.5">
                      {dayEvents.slice(0, MAX_VISIBLE_PER_DAY).map((event) => {
                        const meta = CALENDAR_DOMAIN_META[event.domain]
                        return (
                          <span
                            key={event.id}
                            className={cx(
                              'truncate rounded px-1 py-0.5 text-[10.5px] leading-tight',
                              event.done
                                ? 'bg-surface-2 text-ink-3 line-through'
                                : 'bg-brand-soft text-brand-strong',
                            )}
                            title={`${meta.label}: ${event.title}`}
                          >
                            {event.title}
                          </span>
                        )
                      })}
                      {overflow > 0 ? (
                        <span className="text-[10px] font-medium text-ink-3">
                          +{overflow} more
                        </span>
                      ) : null}
                    </span>
                  </button>
                )
              })}
            </div>
          </Card>

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
                onClick={() => setEventForm({ open: true, existing: null })}
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
                  const isCustom = event.domain === 'custom'
                  const content = (
                    <>
                      <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand-strong">
                        <Icon name={meta.icon} size={14} />
                      </span>
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
                          {event.start_time ? `${formatTime(event.start_time)} · ` : ''}
                          {meta.label}
                        </span>
                      </span>
                      {isCustom && loadingEvent === event.id ? (
                        <Icon name="clock" size={13} className="mt-1 shrink-0 animate-pulse text-ink-3" />
                      ) : null}
                    </>
                  )
                  return (
                    <li key={event.id}>
                      {isCustom ? (
                        <button
                          type="button"
                          onClick={() => void editEvent(event)}
                          disabled={loadingEvent === event.id}
                          aria-label={`Edit ${event.title}`}
                          className="-mx-2 flex w-[calc(100%+1rem)] items-start gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-surface-2"
                        >
                          {content}
                        </button>
                      ) : (
                        <Link
                          to={event.target_url}
                          state={{ from: location.pathname + location.search }}
                          className="-mx-2 flex items-start gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-surface-2"
                        >
                          {content}
                        </Link>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>
        </div>
      )}

      <CalendarEventForm
        open={eventForm.open}
        existing={eventForm.existing}
        defaultDate={selectedDay}
        onClose={() => setEventForm({ open: false, existing: null })}
        onSaved={() => calendar.reload()}
        onDeleted={() => calendar.reload()}
      />
    </>
  )
}

const MINI_WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

/** One compact month, for the year-at-a-glance grid — day numbers and a
    single dot for "something's due", not the full event list a month view
    has room for. */
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
