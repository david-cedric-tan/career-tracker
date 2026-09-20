import type { DragEvent } from 'react'
import type { CalendarEvent } from '../../api/types'
import { cx } from '../../lib/format'
import { DayEventChip } from './DayEventChip'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function toIsoDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function isSameDay(a: Date, b: Date): boolean {
  return toIsoDate(a) === toIsoDate(b)
}

/**
 * Week grid: stacked day rows on phones; seven columns on laptop+.
 * Grows with content — no per-day internal scroll; the page scrolls instead.
 */
export function WeekView({
  days,
  today,
  selectedDay,
  eventsByDay,
  draggingId,
  dropTarget,
  dropBeforeId,
  movingId,
  onSelectDay,
  onOpenDay,
  onComposeDay,
  onDayDragOver,
  onDayDragLeave,
  onDayDrop,
  onChipDragStart,
  onChipDragEnd,
  onChipDragOver,
  onOpen,
}: {
  days: Date[]
  today: Date
  selectedDay: string
  eventsByDay: Map<string, CalendarEvent[]>
  draggingId: string | null
  dropTarget: string | null
  dropBeforeId: string | null
  movingId: string | null
  onSelectDay: (iso: string) => void
  onOpenDay: (iso: string) => void
  onComposeDay: (iso: string) => void
  onDayDragOver: (event: DragEvent, iso: string) => void
  onDayDragLeave: (iso: string) => void
  onDayDrop: (event: DragEvent, iso: string) => void
  onChipDragStart: (event: DragEvent, item: CalendarEvent) => void
  onChipDragEnd: () => void
  onChipDragOver: (event: DragEvent, item: CalendarEvent) => void
  onOpen: (event: CalendarEvent) => void
}) {
  return (
    <div
      className={cx(
        'flex min-h-[22rem] flex-col rounded-xl border border-line bg-surface',
        'md:grid md:grid-cols-7 md:items-start',
      )}
    >
      {days.map((date, index) => {
        const iso = toIsoDate(date)
        const isToday = isSameDay(date, today)
        const isSelected = iso === selectedDay
        const dayEvents = eventsByDay.get(iso) ?? []
        const isDropTarget = dropTarget === iso && draggingId != null

        return (
          <div
            key={iso}
            className={cx(
              'flex flex-col border-b border-line last:border-b-0',
              'md:min-h-[22rem] md:border-b-0 md:border-r md:last:border-r-0',
              isDropTarget && 'bg-brand-soft/50',
              isSelected && 'bg-brand-soft/20',
            )}
            onDragOver={(event) => onDayDragOver(event, iso)}
            onDragLeave={() => onDayDragLeave(iso)}
            onDrop={(event) => onDayDrop(event, iso)}
          >
            <button
              type="button"
              onClick={() => onOpenDay(iso)}
              title="Open day view"
              className={cx(
                'flex shrink-0 items-center gap-2 border-b border-line px-2.5 py-2 text-left hover:bg-surface-2',
                'md:flex-col md:items-center md:gap-0.5 md:px-1 md:text-center',
              )}
            >
              <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-3">
                {WEEKDAYS[index]}
              </span>
              <span
                className={cx(
                  'grid size-7 place-items-center rounded-full text-[13px] font-semibold',
                  isToday ? 'bg-brand text-white' : 'text-ink',
                )}
              >
                {date.getDate()}
              </span>
              {dayEvents.length > 0 ? (
                <span className="ml-auto text-[11px] text-ink-3 md:hidden">
                  {dayEvents.length} item{dayEvents.length === 1 ? '' : 's'}
                </span>
              ) : null}
            </button>
            <div
              className="flex flex-col gap-1.5 p-2 md:p-1.5"
              onClick={() => onSelectDay(iso)}
              onDoubleClick={(event) => {
                event.preventDefault()
                onComposeDay(iso)
              }}
            >
              {dayEvents.length === 0 ? (
                <p className="px-0.5 py-1 text-[11px] text-ink-3 md:hidden">Nothing due</p>
              ) : (
                dayEvents.map((event) => (
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
        )
      })}
    </div>
  )
}
