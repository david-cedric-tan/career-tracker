import { useEffect, useRef, type DragEvent } from 'react'
import type { CalendarEvent } from '../../api/types'
import { minutesToTime, parseTimeToMinutes } from '../../lib/calendarView'
import { cx, formatTime } from '../../lib/format'
import { CALENDAR_DOMAIN_META } from '../../lib/tones'
import { DayEventChip } from './DayEventChip'
import { Avatar } from '../ui/Avatar'

const HOUR_HEIGHT = 56
const HOURS = Array.from({ length: 24 }, (_, hour) => hour)

function eventStartMinutes(event: CalendarEvent): number {
  return parseTimeToMinutes(event.start_time) ?? 9 * 60
}

function eventEndMinutes(event: CalendarEvent): number {
  const end = parseTimeToMinutes(event.end_time)
  if (end != null && end > eventStartMinutes(event)) return end
  return eventStartMinutes(event) + 60
}

function isTimed(event: CalendarEvent): boolean {
  return event.domain === 'custom' && event.all_day === false
}

/**
 * Google-style day timeline: all-day strip + 24 hourly slots.
 */
export function DayTimeline({
  iso,
  events,
  draggingId,
  dropTarget,
  dropBeforeId,
  dropHour,
  movingId,
  onDayDragOver,
  onDayDragLeave,
  onDayDrop,
  onHourDragOver,
  onHourDrop,
  onChipDragStart,
  onChipDragEnd,
  onChipDragOver,
  onOpen,
  onCreateAtHour,
}: {
  iso: string
  events: CalendarEvent[]
  draggingId: string | null
  dropTarget: string | null
  dropBeforeId: string | null
  dropHour: number | null
  movingId: string | null
  onDayDragOver: (event: DragEvent, iso: string) => void
  onDayDragLeave: (iso: string) => void
  onDayDrop: (event: DragEvent, iso: string) => void
  onHourDragOver: (event: DragEvent, hour: number) => void
  onHourDrop: (event: DragEvent, hour: number) => void
  onChipDragStart: (event: DragEvent, item: CalendarEvent) => void
  onChipDragEnd: () => void
  onChipDragOver: (event: DragEvent, item: CalendarEvent) => void
  onOpen: (event: CalendarEvent) => void
  onCreateAtHour: (hour: number) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const allDay = events.filter((event) => !isTimed(event))
  const timed = events.filter(isTimed)

  useEffect(() => {
    const node = scrollRef.current
    if (!node) return
    // Scroll near "now" on first mount of this day.
    const now = new Date()
    const top = Math.max(0, now.getHours() * HOUR_HEIGHT - HOUR_HEIGHT * 2)
    node.scrollTop = top
  }, [iso])

  return (
    <div className="flex h-[min(70dvh,44rem)] flex-col overflow-hidden rounded-xl border border-line bg-surface">
      <div
        className={cx(
          'shrink-0 border-b border-line px-3 py-2',
          dropTarget === iso && draggingId && 'bg-brand-soft/40',
        )}
        onDragOver={(event) => onDayDragOver(event, iso)}
        onDragLeave={() => onDayDragLeave(iso)}
        onDrop={(event) => onDayDrop(event, iso)}
      >
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
          All day
        </p>
        <div className="flex min-h-10 flex-col gap-1">
          {allDay.length === 0 ? (
            <p className="text-[12px] text-ink-3">Drop all-day events here, or add one.</p>
          ) : (
            allDay.map((event) => (
              <DayEventChip
                key={event.id}
                event={event}
                denser
                dragging={draggingId === event.id}
                moving={movingId === event.id}
                dropBefore={dropBeforeId === event.id && dropTarget === iso}
                onDragStart={onChipDragStart}
                onDragEnd={onChipDragEnd}
                onDragOverChip={onChipDragOver}
                onOpen={() => onOpen(event)}
              />
            ))
          )}
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="relative" style={{ height: 24 * HOUR_HEIGHT }}>
          {HOURS.map((hour) => (
            <button
              key={hour}
              type="button"
              onClick={() => onCreateAtHour(hour)}
              onDragOver={(event) => onHourDragOver(event, hour)}
              onDrop={(event) => onHourDrop(event, hour)}
              className={cx(
                'absolute left-0 right-0 flex border-b border-line/70 text-left transition-colors hover:bg-surface-2/80',
                dropHour === hour && draggingId && 'bg-brand-soft/50',
              )}
              style={{ top: hour * HOUR_HEIGHT, height: HOUR_HEIGHT }}
              aria-label={`Add event at ${minutesToTime(hour * 60)}`}
            >
              <span className="w-14 shrink-0 -translate-y-2 pl-2 text-[11px] font-medium text-ink-3">
                {hour === 0
                  ? '12 AM'
                  : hour < 12
                    ? `${hour} AM`
                    : hour === 12
                      ? '12 PM'
                      : `${hour - 12} PM`}
              </span>
              <span className="flex-1 border-l border-line/80" />
            </button>
          ))}

          {timed.map((event) => {
            const start = eventStartMinutes(event)
            const end = eventEndMinutes(event)
            const top = (start / 60) * HOUR_HEIGHT
            const height = Math.max(((end - start) / 60) * HOUR_HEIGHT, 28)
            const meta = CALENDAR_DOMAIN_META[event.domain]

            return (
              <button
                key={event.id}
                type="button"
                draggable
                onDragStart={(drag) => onChipDragStart(drag, event)}
                onDragEnd={onChipDragEnd}
                onClick={() => onOpen(event)}
                className={cx(
                  'absolute left-16 right-2 z-[1] overflow-hidden rounded-md border border-brand-ring bg-brand-soft px-2 py-1 text-left shadow-sm',
                  draggingId === event.id && 'opacity-40',
                  movingId === event.id && 'animate-pulse',
                )}
                style={{ top, height }}
                title={`${meta.label}: ${event.title}`}
              >
                <span className="flex items-center gap-1.5 truncate text-[12px] font-semibold text-brand-strong">
                  {event.person ? (
                    <Avatar name={event.person.full_name} src={event.person.photo} size="xxs" />
                  ) : null}
                  <span className="truncate">{event.title}</span>
                </span>
                <span className="block truncate text-[10.5px] text-brand-strong/80">
                  {event.start_time ? formatTime(event.start_time) : ''}
                  {event.end_time ? ` – ${formatTime(event.end_time)}` : ''}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
