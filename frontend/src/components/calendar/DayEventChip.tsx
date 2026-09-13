import type { DragEvent } from 'react'
import type { CalendarEvent } from '../../api/types'
import { cx, formatTime } from '../../lib/format'
import { CALENDAR_DOMAIN_META, TONE_CHIP, calendarEventTone } from '../../lib/tones'
import { CompanyMark } from '../ui/CompanyMark'
import { Avatar } from '../ui/Avatar'

export function DayEventChip({
  event,
  dragging,
  moving,
  dropBefore,
  onDragStart,
  onDragEnd,
  onDragOverChip,
  onOpen,
  denser = false,
}: {
  event: CalendarEvent
  dragging: boolean
  moving: boolean
  dropBefore?: boolean
  onDragStart: (drag: DragEvent, item: CalendarEvent) => void
  onDragEnd: () => void
  onDragOverChip?: (drag: DragEvent, item: CalendarEvent) => void
  onOpen: () => void
  denser?: boolean
}) {
  const meta = CALENDAR_DOMAIN_META[event.domain]
  const movable = event.domain === 'custom' || event.domain === 'todo'
  // Timed events carry their slot on the chip — "when" is half the point.
  const timeRange =
    event.all_day === false && event.start_time
      ? `${formatTime(event.start_time)}${event.end_time ? `–${formatTime(event.end_time)}` : ''}`
      : null

  return (
    <button
      type="button"
      draggable={movable}
      data-event-id={event.id}
      onDragStart={(drag) => {
        drag.stopPropagation()
        onDragStart(drag, event)
      }}
      onDragEnd={onDragEnd}
      onDragOver={(drag) => {
        drag.preventDefault()
        drag.stopPropagation()
        onDragOverChip?.(drag, event)
      }}
      onClick={(click) => {
        click.stopPropagation()
        onOpen()
      }}
      className={cx(
        'flex w-full items-center gap-1 rounded border px-1 text-left leading-tight',
        denser ? 'py-1 text-[11.5px]' : 'py-0.5 text-[10.5px]',
        event.done ? 'border-line bg-surface-2 text-ink-3 line-through' : TONE_CHIP[calendarEventTone(event)],
        movable && 'cursor-grab active:cursor-grabbing',
        dragging && 'opacity-40',
        moving && 'animate-pulse opacity-60',
        dropBefore && 'ring-2 ring-brand',
        'hover:brightness-95',
      )}
      title={`${meta.label}: ${event.title} · click to view`}
    >
      {/* A face on anything tied to a person: a week of catch-ups is scanned
          by who, not by title. */}
      {event.person ? (
        <Avatar
          name={event.person.full_name}
          src={event.person.photo}
          size="xxs"
          className={cx('shrink-0', denser ? '!size-[18px]' : '!size-[15px] !text-[7px]')}
        />
      ) : event.company ? (
        <CompanyMark
          name={event.company.name}
          logo={event.company.logo}
          size={denser ? 18 : 15}
          className="shrink-0 rounded-[4px] shadow-none"
        />
      ) : null}
      <span className="min-w-0 flex-1 truncate">{event.title}</span>
      {timeRange ? (
        <span className="shrink-0 text-[9.5px] font-medium opacity-80">{timeRange}</span>
      ) : null}
    </button>
  )
}
