import { useMemo, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent } from 'react'
import type { CalendarEvent } from '../../api/types'
import { minutesToTime, packOverlaps, parseTimeToMinutes } from '../../lib/calendarView'
import { cx, formatTimeRangeShort } from '../../lib/format'
import { CALENDAR_DOMAIN_META } from '../../lib/tones'
import { DayEventChip, CALENDAR_TIME_CLASS } from './DayEventChip'
import { Avatar } from '../ui/Avatar'

const HOUR_HEIGHT = 56
const HOURS = Array.from({ length: 24 }, (_, hour) => hour)
/** The hour-label gutter and the right margin the blocks sit between. */
const TRACK_LEFT = 64
const TRACK_RIGHT = 8
/** Breathing room between two blocks sharing the same stretch. */
const COLUMN_GAP = 3
/** Stands in for the block being dragged, while it's still in the air. */
const GHOST_ID = '__drop-preview__'
const SNAP_MINUTES = 15
const MIN_DURATION = 15

function eventStartMinutes(event: CalendarEvent): number {
  return parseTimeToMinutes(event.start_time) ?? 9 * 60
}

function eventEndMinutes(event: CalendarEvent): number {
  const end = parseTimeToMinutes(event.end_time)
  if (end != null && end > eventStartMinutes(event)) return end
  return eventStartMinutes(event) + 60
}

function snapMinutes(value: number): number {
  return Math.round(value / SNAP_MINUTES) * SNAP_MINUTES
}

function isTimed(event: CalendarEvent): boolean {
  // Custom events and todos with a due clock time both sit on the hour grid.
  return (
    (event.domain === 'custom' || event.domain === 'todo') && event.all_day === false
  )
}

/**
 * Google-style day timeline: all-day strip + 24 hourly slots.
 * Timed blocks can be drag-moved and bottom-edge resized in 15-minute steps.
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
  onAllDayDrop,
  onHourDragOver,
  onHourDrop,
  onHourDragLeave,
  onChipDragStart,
  onChipDragEnd,
  onChipDragOver,
  onOpen,
  onComposeAtHour,
  onComposeAllDay,
  onResizeEnd,
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
  /** Drop onto the all-day strip itself — a timed item dropped here loses
      its clock time, which a plain day drop must not do. */
  onAllDayDrop?: (event: DragEvent, iso: string) => void
  onHourDragOver: (event: DragEvent, hour: number) => void
  onHourDrop: (event: DragEvent, hour: number) => void
  /** Drag left the hour grid entirely — drop the landing preview. */
  onHourDragLeave?: () => void
  onChipDragStart: (event: DragEvent, item: CalendarEvent) => void
  onChipDragEnd: () => void
  onChipDragOver: (event: DragEvent, item: CalendarEvent) => void
  onOpen: (event: CalendarEvent) => void
  onComposeAtHour: (hour: number) => void
  onComposeAllDay: () => void
  onResizeEnd?: (event: CalendarEvent, endMinutes: number) => void
}) {
  const gridRef = useRef<HTMLDivElement>(null)
  const suppressClickRef = useRef(false)
  const resizingRef = useRef(false)
  const [resizePreview, setResizePreview] = useState<{
    id: string
    endMinutes: number
  } | null>(null)
  const allDay = events.filter((event) => !isTimed(event))
  const timed = events.filter(isTimed)

  /** Where a block sits right now, resize-in-progress included. */
  function span(event: CalendarEvent) {
    const start = eventStartMinutes(event)
    const end = resizePreview?.id === event.id ? resizePreview.endMinutes : eventEndMinutes(event)
    // A 15-minute floor, so two back-to-back blips don't read as overlapping
    // just because both render at the 28px minimum.
    return { start, end: Math.max(end, start + 15) }
  }

  // While something is being dragged over the grid, a ghost block stands in
  // for it at the hovered time. It goes through the same packing as everything
  // else, so the blocks already there visibly shuffle aside to make room —
  // and shuffle straight back if the drag leaves or is abandoned. Nothing
  // here touches the record; only a drop does.
  const dragged = draggingId ? events.find((event) => event.id === draggingId) : null
  const ghost = useMemo(() => {
    if (dropHour == null || !draggingId) return null
    const duration =
      dragged && isTimed(dragged)
        ? Math.max(15, eventEndMinutes(dragged) - eventStartMinutes(dragged))
        : 60
    const start = Math.round(dropHour * 60)
    return { start, end: Math.min(start + duration, 24 * 60) }
  }, [dropHour, draggingId, dragged])

  const slots = useMemo(() => {
    const blocks = timed
      // The dragged block is represented by the ghost, not twice.
      .filter((event) => !(ghost && event.id === draggingId))
      .map((event) => ({ id: event.id, ...span(event) }))
    if (ghost) blocks.push({ id: GHOST_ID, ...ghost })
    return packOverlaps(
      blocks,
      (block) => block.id,
      (block) => block,
    )
    // `span` closes over resizePreview, which is in the dep list already.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timed, resizePreview, ghost, draggingId])

  /** The inline box for one column slot, shared by real blocks and the ghost. */
  function columnBox(id: string) {
    const { column, columns } = slots.get(id) ?? { column: 0, columns: 1 }
    const track = `(100% - ${TRACK_LEFT + TRACK_RIGHT}px)`
    const gap = columns > 1 ? COLUMN_GAP : 0
    return {
      left: `calc(${TRACK_LEFT}px + ${track} * ${column} / ${columns})`,
      width: `calc(${track} / ${columns} - ${gap}px)`,
    }
  }

  /** Minutes-from-midnight under the pointer, snapped, as a fractional hour. */
  function hourAtPointer(clientY: number): number | null {
    const grid = gridRef.current
    if (!grid) return null
    const rect = grid.getBoundingClientRect()
    const minutes = ((clientY - rect.top) / HOUR_HEIGHT) * 60
    const snapped = Math.min(Math.max(snapMinutes(minutes), 0), 24 * 60 - SNAP_MINUTES)
    return snapped / 60
  }

  function beginResize(pointer: ReactPointerEvent, event: CalendarEvent) {
    if (!onResizeEnd) return
    pointer.preventDefault()
    pointer.stopPropagation()

    const startMin = eventStartMinutes(event)
    const grid = gridRef.current
    if (!grid) return

    const readEnd = (clientY: number) => {
      const y = clientY - grid.getBoundingClientRect().top
      const raw = (y / HOUR_HEIGHT) * 60
      return Math.max(startMin + MIN_DURATION, Math.min(24 * 60, snapMinutes(raw)))
    }

    setResizePreview({ id: event.id, endMinutes: readEnd(pointer.clientY) })
    resizingRef.current = true

    const onMove = (ev: PointerEvent) => {
      setResizePreview({ id: event.id, endMinutes: readEnd(ev.clientY) })
    }
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      const endMinutes = readEnd(ev.clientY)
      resizingRef.current = false
      setResizePreview(null)
      suppressClickRef.current = true
      if (endMinutes !== eventEndMinutes(event)) {
        onResizeEnd(event, endMinutes)
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <div className="flex flex-col overflow-visible rounded-xl border border-line bg-surface">
      <div
        className={cx(
          'shrink-0 border-b border-line px-3 py-2',
          dropTarget === iso && draggingId && 'bg-brand-soft/40',
        )}
        onDragOver={(event) => onDayDragOver(event, iso)}
        onDragLeave={() => onDayDragLeave(iso)}
        onDrop={(event) => (onAllDayDrop ?? onDayDrop)(event, iso)}
        onDoubleClick={(event) => {
          event.preventDefault()
          onComposeAllDay()
        }}
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

      {/* Drag handling lives on the grid, not on the hour rows: a row that
          already has a block on it is covered by that block, and a block with
          no dragover handler of its own reads to the browser as "you can't
          drop here". Listening at the grid catches both. */}
      <div
        ref={gridRef}
        className="relative"
        style={{ height: 24 * HOUR_HEIGHT }}
        onDragOver={(drag) => {
          const hour = hourAtPointer(drag.clientY)
          if (hour == null) return
          onHourDragOver(drag, hour)
        }}
        onDrop={(drag) => {
          const hour = hourAtPointer(drag.clientY)
          if (hour == null) return
          onHourDrop(drag, hour)
        }}
        onDragLeave={(drag) => {
          // Fires for every child crossed on the way across the grid, so
          // only a pointer that has actually left counts as leaving.
          const next = drag.relatedTarget as Node | null
          if (next && gridRef.current?.contains(next)) return
          onHourDragLeave?.()
        }}
      >
          {HOURS.map((hour) => (
            <button
              key={hour}
              type="button"
              onDoubleClick={() => onComposeAtHour(hour)}
              className={cx(
                'absolute left-0 right-0 flex border-b border-line/70 text-left transition-colors hover:bg-surface-2/80',
                dropHour != null && Math.floor(dropHour) === hour && draggingId && 'bg-brand-soft/50',
              )}
              style={{ top: hour * HOUR_HEIGHT, height: HOUR_HEIGHT }}
              aria-label={`Add at ${minutesToTime(hour * 60)}`}
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
            const end =
              resizePreview?.id === event.id
                ? resizePreview.endMinutes
                : eventEndMinutes(event)
            const top = (start / 60) * HOUR_HEIGHT
            const height = Math.max(((end - start) / 60) * HOUR_HEIGHT, 28)
            const meta = CALENDAR_DOMAIN_META[event.domain]
            const endLabel = minutesToTime(Math.min(end, 23 * 60 + 59))
            // Share the width with anything running at the same time.
            const box = columnBox(event.id)
            // A half-hour block has no room for a title *and* a line of time
            // under it — those sit on one row instead, and the time drops
            // out entirely once even that won't fit.
            const compact = height < 46

            return (
              <div
                key={event.id}
                draggable={!resizingRef.current && resizePreview == null}
                onDragStart={(drag) => {
                  if (resizingRef.current || resizePreview) {
                    drag.preventDefault()
                    return
                  }
                  onChipDragStart(drag, event)
                }}
                onDragEnd={onChipDragEnd}
                onClick={() => {
                  if (suppressClickRef.current) {
                    suppressClickRef.current = false
                    return
                  }
                  onOpen(event)
                }}
                onDoubleClick={(click) => click.stopPropagation()}
                className={cx(
                  'absolute z-[1] flex flex-col overflow-hidden rounded-md border border-brand-ring bg-brand-soft px-2 py-1 text-left shadow-sm',
                  // Only the horizontal half animates: width is what changes
                  // when a neighbour arrives, while top/height follow a resize
                  // drag and must track the pointer exactly.
                  'transition-[left,width,opacity,transform] duration-200 ease-out',
                  draggingId === event.id && 'scale-[0.98] opacity-40 shadow-none',
                  movingId === event.id && 'animate-pulse',
                  resizePreview?.id === event.id && 'ring-2 ring-brand',
                )}
                style={{ top, height, ...box }}
                title={`${meta.label}: ${event.title}`}
              >
                <span className="flex min-w-0 items-center gap-1.5 text-[12px] font-semibold text-brand-strong">
                  {event.person ? (
                    <Avatar name={event.person.full_name} src={event.person.photo} size="xxs" />
                  ) : null}
                  <span className="min-w-0 truncate">{event.title}</span>
                  {compact ? (
                    <span
                      className={cx(
                        'ml-auto shrink-0 whitespace-nowrap text-[10.5px] font-normal leading-snug',
                        CALENDAR_TIME_CLASS,
                      )}
                    >
                      {formatTimeRangeShort(event.start_time, endLabel)}
                    </span>
                  ) : null}
                </span>
                {compact ? null : (
                  <span
                    className={cx(
                      'mt-auto block pb-2 text-right text-[10.5px] leading-snug',
                      CALENDAR_TIME_CLASS,
                    )}
                  >
                    {formatTimeRangeShort(event.start_time, endLabel)}
                  </span>
                )}
                {onResizeEnd ? (
                  <span
                    role="separator"
                    aria-label="Resize duration"
                    onPointerDown={(ev) => beginResize(ev, event)}
                    className="absolute inset-x-0 bottom-0 z-[2] flex h-3 cursor-ns-resize items-end justify-center pb-0.5"
                  >
                    <span className="h-1 w-8 rounded-full bg-brand-strong/35" />
                  </span>
                ) : null}
              </div>
            )
          })}

          {/* Where the dragged block would land. Pointer-transparent so it
              can't swallow the dragover it exists to illustrate. */}
          {ghost ? (
            <div
              aria-hidden
              className={cx(
                'pointer-events-none absolute z-[2] flex flex-col overflow-hidden rounded-md',
                'border-2 border-dashed border-brand bg-brand-soft/80 px-2 py-1 shadow-lg',
                'transition-[left,width] duration-200 ease-out',
              )}
              style={{
                top: (ghost.start / 60) * HOUR_HEIGHT,
                height: Math.max(((ghost.end - ghost.start) / 60) * HOUR_HEIGHT, 28),
                ...columnBox(GHOST_ID),
              }}
            >
              <span className="truncate text-[12px] font-semibold text-brand-strong">
                {dragged?.title ?? 'New entry'}
              </span>
              <span
                className={cx(
                  'mt-auto block text-right text-[10.5px] leading-snug',
                  CALENDAR_TIME_CLASS,
                )}
              >
                {formatTimeRangeShort(
                  minutesToTime(ghost.start),
                  minutesToTime(Math.min(ghost.end, 23 * 60 + 59)),
                )}
              </span>
            </div>
          ) : null}
      </div>
    </div>
  )
}
