import type { DragEvent, CSSProperties } from 'react'
import type { CalendarEvent } from '../../api/types'
import { cx, formatTimeRangeShort } from '../../lib/format'
import {
  calendarEffectCssVar,
  useCalendarEffects,
} from '../../lib/calendarEffects'
import { CALENDAR_DOMAIN_META, TONE_CHIP, calendarEventTone } from '../../lib/tones'
import { CompanyMark } from '../ui/CompanyMark'
import { Avatar } from '../ui/Avatar'

/** Shared accent for calendar time stamps — bold, distinct from the title. */
export const CALENDAR_TIME_CLASS =
  'font-bold tabular-nums tracking-tight text-brand-strong'

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
  const [effects] = useCalendarEffects()
  const meta = CALENDAR_DOMAIN_META[event.domain]
  const movable = event.domain === 'custom' || event.domain === 'todo'
  const isDeadline = event.domain === 'application_deadline' && !event.done
  // Timed events carry their slot on the chip — keep it short ("7–8am").
  const timeRange =
    event.all_day === false && event.start_time
      ? formatTimeRangeShort(event.start_time, event.end_time)
      : null

  const deadlineStyle = isDeadline
    ? ({
        ['--deadline-glow' as string]: calendarEffectCssVar(effects.color),
      } as CSSProperties)
    : undefined

  return (
    <button
      type="button"
      draggable={movable}
      data-event-id={event.id}
      data-deadline-fx={isDeadline ? (effects.enabled ? 'on' : 'off') : undefined}
      style={deadlineStyle}
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
      onDoubleClick={(click) => {
        // Don't bubble to the day panel's "compose" double-click.
        click.stopPropagation()
      }}
      className={cx(
        'flex w-full items-start gap-1 rounded border px-1.5 text-left leading-tight',
        denser ? 'py-1.5 text-[11.5px]' : 'py-1 text-[10.5px]',
        event.done
          ? 'border-line bg-surface-2 text-ink-3 line-through'
          : TONE_CHIP[calendarEventTone(event)],
        isDeadline && 'calendar-deadline-chip',
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
          className={cx('mt-0.5 shrink-0', denser ? '!size-[18px]' : '!size-[15px] !text-[7px]')}
        />
      ) : event.company ? (
        <CompanyMark
          name={event.company.name}
          logo={event.company.logo}
          size={denser ? 18 : 15}
          className="mt-0.5 shrink-0 rounded-[4px] shadow-none"
        />
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{event.title}</span>
        {timeRange ? (
          <span className={cx('mt-0.5 block text-right text-[10px]', CALENDAR_TIME_CLASS)}>
            {timeRange}
          </span>
        ) : null}
      </span>
    </button>
  )
}
