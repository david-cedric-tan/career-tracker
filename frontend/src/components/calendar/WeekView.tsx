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
 * Seven equal-height day columns for the week view.
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
  onDayDragOver: (event: DragEvent, iso: string) => void
  onDayDragLeave: (iso: string) => void
  onDayDrop: (event: DragEvent, iso: string) => void
  onChipDragStart: (event: DragEvent, item: CalendarEvent) => void
  onChipDragEnd: () => void
  onChipDragOver: (event: DragEvent, item: CalendarEvent) => void
  onOpen: (event: CalendarEvent) => void
}) {
  return (
    <div className="grid h-[min(70dvh,44rem)] grid-cols-7 overflow-hidden rounded-xl border border-line bg-surface">
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
              'flex min-h-0 flex-col border-r border-line last:border-r-0',
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
              className="flex shrink-0 flex-col items-center gap-0.5 border-b border-line px-1 py-2 text-center hover:bg-surface-2"
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
            </button>
            <div
              className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-1.5"
              onClick={() => onSelectDay(iso)}
            >
              {dayEvents.map((event) => (
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
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
