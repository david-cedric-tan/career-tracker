import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type DragEvent } from 'react'
import { createPortal } from 'react-dom'
import type { CalendarEvent } from '../../api/types'
import {
  calendarEffectCssVar,
  useCalendarEffects,
} from '../../lib/calendarEffects'
import { cx, formatCompactTime } from '../../lib/format'
import { TONE_CHIP, TONE_DOT, calendarEventTone } from '../../lib/tones'
import { Avatar } from '../ui/Avatar'
import { CompanyMark } from '../ui/CompanyMark'
import { Icon } from '../ui/Icon'

/** All-day / untimed → solid banner; timed → Google-style bullet + clock. */
export function isMonthBannerEvent(event: CalendarEvent): boolean {
  return !(event.all_day === false && event.start_time)
}

/** Month-cell / peek order: banners first, then timed by start. */
export function sortMonthCellEvents(events: CalendarEvent[]): CalendarEvent[] {
  const banners: CalendarEvent[] = []
  const timed: CalendarEvent[] = []
  for (const event of events) {
    if (isMonthBannerEvent(event)) banners.push(event)
    else timed.push(event)
  }
  timed.sort((a, b) => {
    const am = a.start_time ?? ''
    const bm = b.start_time ?? ''
    if (am !== bm) return am.localeCompare(bm)
    return a.id.localeCompare(b.id)
  })
  return [...banners, ...timed]
}

/** Google-ish clock in month lists: "12pm", "5:30pm". */
function formatMonthClock(value: string): string {
  const [hours, minutes = 0] = value.split(':').map(Number)
  if (Number.isNaN(hours)) return value
  const suffix = hours < 12 ? 'am' : 'pm'
  const h12 = hours % 12 === 0 ? 12 : hours % 12
  const mins = Number.isNaN(minutes) ? 0 : minutes
  return mins === 0 ? `${h12}${suffix}` : `${h12}:${String(mins).padStart(2, '0')}${suffix}`
}

function MonthEventFace({
  event,
  denser,
}: {
  event: CalendarEvent
  denser: boolean
}) {
  if (event.person) {
    return (
      <Avatar
        name={event.person.full_name}
        src={event.person.photo}
        size="xxs"
        className={cx('shrink-0', denser ? '!size-6' : '!size-5 !text-[8px]')}
      />
    )
  }
  if (event.company) {
    return (
      <CompanyMark
        name={event.company.name}
        logo={event.company.logo}
        size={denser ? 22 : 18}
        className="shrink-0 rounded-[4px] shadow-none"
      />
    )
  }
  return null
}

export function MonthEventLine({
  event,
  denser = false,
  dragging,
  moving,
  dropBefore,
  onDragStart,
  onDragEnd,
  onDragOverChip,
  onOpen,
}: {
  event: CalendarEvent
  denser?: boolean
  dragging?: boolean
  moving?: boolean
  dropBefore?: boolean
  onDragStart?: (drag: DragEvent, item: CalendarEvent) => void
  onDragEnd?: () => void
  onDragOverChip?: (drag: DragEvent, item: CalendarEvent) => void
  onOpen: () => void
}) {
  const [effects] = useCalendarEffects()
  const movable = event.domain === 'custom' || event.domain === 'todo'
  const isDeadline = event.domain === 'application_deadline' && !event.done
  const tone = calendarEventTone(event)
  const banner = isMonthBannerEvent(event)
  const face = <MonthEventFace event={event} denser={denser} />

  const deadlineStyle = isDeadline
    ? ({
        ['--deadline-glow' as string]: calendarEffectCssVar(effects.color),
      } as CSSProperties)
    : undefined

  if (banner) {
    return (
      <button
        type="button"
        draggable={movable}
        data-event-id={event.id}
        data-deadline-fx={isDeadline ? (effects.enabled ? 'on' : 'off') : undefined}
        style={deadlineStyle}
        onDragStart={(drag) => {
          if (!onDragStart) return
          drag.stopPropagation()
          onDragStart(drag, event)
        }}
        onDragEnd={onDragEnd}
        onDragOver={(drag) => {
          if (!onDragOverChip) return
          drag.preventDefault()
          drag.stopPropagation()
          onDragOverChip(drag, event)
        }}
        onClick={(click) => {
          click.stopPropagation()
          onOpen()
        }}
        onDoubleClick={(click) => click.stopPropagation()}
        className={cx(
          'flex w-full items-center gap-1 rounded px-1.5 text-left font-medium leading-tight',
          denser ? 'py-1.5 text-[12.5px]' : 'py-0.5 text-[10.5px]',
          event.done
            ? 'border border-line bg-surface-2 text-ink-3 line-through'
            : TONE_CHIP[tone],
          isDeadline && 'calendar-deadline-chip',
          movable && onDragStart && 'cursor-grab active:cursor-grabbing',
          dragging && 'opacity-40',
          moving && 'animate-pulse opacity-60',
          dropBefore && 'ring-2 ring-brand',
          'hover:brightness-95',
        )}
        title={event.title}
      >
        {face}
        <span className="min-w-0 flex-1 truncate">{event.title}</span>
      </button>
    )
  }

  return (
    <button
      type="button"
      draggable={movable}
      data-event-id={event.id}
      onDragStart={(drag) => {
        if (!onDragStart) return
        drag.stopPropagation()
        onDragStart(drag, event)
      }}
      onDragEnd={onDragEnd}
      onDragOver={(drag) => {
        if (!onDragOverChip) return
        drag.preventDefault()
        drag.stopPropagation()
        onDragOverChip(drag, event)
      }}
      onClick={(click) => {
        click.stopPropagation()
        onOpen()
      }}
      onDoubleClick={(click) => click.stopPropagation()}
      className={cx(
        'flex w-full items-center gap-1 text-left leading-tight',
        denser ? 'py-1 text-[12.5px]' : 'py-0.5 text-[10.5px]',
        event.done ? 'text-ink-3 line-through' : 'text-ink-2',
        movable && onDragStart && 'cursor-grab active:cursor-grabbing',
        dragging && 'opacity-40',
        moving && 'animate-pulse opacity-60',
        dropBefore && 'ring-2 ring-brand',
        'hover:text-ink',
      )}
      title={`${formatCompactTime(event.start_time!)} ${event.title}`}
    >
      <span className={cx('size-1.5 shrink-0 rounded-full', TONE_DOT[tone])} />
      <span className="min-w-0 flex-1 truncate">
        <span className="tabular-nums text-ink-3">{formatMonthClock(event.start_time!)}</span>
        {' '}
        <span className={event.done ? undefined : 'text-ink'}>{event.title}</span>
      </span>
    </button>
  )
}

const MORE_LINE_CLASS =
  'shrink-0 truncate px-0.5 text-left text-[10.5px] font-medium text-ink-3 hover:text-ink hover:underline'

/**
 * Pack as many month events as the cell height allows. Only when something
 * truly cannot fit do we reserve a line for "N more" and recount.
 */
export function MonthDayEventStack({
  events,
  draggingId,
  movingId,
  dropBeforeId,
  dropTargetIso,
  cellIso,
  onDragStart,
  onDragEnd,
  onDragOverChip,
  onOpen,
  onMore,
}: {
  events: CalendarEvent[]
  draggingId: string | null
  movingId: string | null
  dropBeforeId: string | null
  dropTargetIso: string | null
  cellIso: string
  onDragStart: (drag: DragEvent, item: CalendarEvent) => void
  onDragEnd: () => void
  onDragOverChip: (drag: DragEvent, item: CalendarEvent) => void
  onOpen: (event: CalendarEvent) => void
  onMore: () => void
}) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLDivElement>(null)
  const moreMeasureRef = useRef<HTMLSpanElement>(null)
  const [visibleCount, setVisibleCount] = useState(events.length)

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    const measure = measureRef.current
    if (!viewport || !measure) return

    function recompute() {
      if (!viewportRef.current || !measureRef.current) return
      const available = viewportRef.current.clientHeight
      const rows = Array.from(measureRef.current.children) as HTMLElement[]
      if (rows.length === 0 || available <= 0) {
        setVisibleCount(0)
        return
      }

      const styles = getComputedStyle(measureRef.current)
      const gap = Number.parseFloat(styles.rowGap || styles.gap || '0') || 0
      const moreH = moreMeasureRef.current?.offsetHeight ?? 16

      function fit(budget: number): number {
        let used = 0
        let count = 0
        for (const row of rows) {
          const next = used + (count > 0 ? gap : 0) + row.offsetHeight
          if (next > budget + 0.5) break
          used = next
          count++
        }
        return count
      }

      // Prefer showing everything when height allows.
      const allFit = fit(available)
      if (allFit >= rows.length) {
        setVisibleCount(rows.length)
        return
      }

      // Otherwise keep a "N more" line and pack what still fits above it.
      const withMoreBudget = Math.max(0, available - moreH - gap)
      setVisibleCount(fit(withMoreBudget))
    }

    recompute()
    const observer = new ResizeObserver(() => recompute())
    observer.observe(viewport)
    // Row heights can change when logos/fonts settle.
    observer.observe(measure)
    return () => observer.disconnect()
  }, [events])

  const visible = events.slice(0, visibleCount)
  const overflow = Math.max(0, events.length - visibleCount)

  if (events.length === 0) return null

  return (
    <div className="relative hidden min-h-0 flex-1 md:block">
      {/* Mirror stack for measurement only — never shown. */}
      <div
        ref={measureRef}
        className="pointer-events-none invisible absolute inset-x-0 top-0 flex flex-col gap-0.5"
        aria-hidden
      >
        {events.map((event) => (
          <MonthEventLine key={event.id} event={event} onOpen={() => undefined} />
        ))}
      </div>
      <span ref={moreMeasureRef} className={cx('invisible absolute', MORE_LINE_CLASS)} aria-hidden>
        99 more
      </span>

      <div ref={viewportRef} className="flex h-full min-h-0 flex-col gap-0.5 overflow-hidden">
        {visible.map((event) => (
          <MonthEventLine
            key={event.id}
            event={event}
            dragging={draggingId === event.id}
            moving={movingId === event.id}
            dropBefore={dropBeforeId === event.id && dropTargetIso === cellIso}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragOverChip={onDragOverChip}
            onOpen={() => onOpen(event)}
          />
        ))}
        {overflow > 0 ? (
          <button type="button" onClick={(click) => {
            click.stopPropagation()
            onMore()
          }} className={MORE_LINE_CLASS}>
            {overflow} more
          </button>
        ) : null}
      </div>
    </div>
  )
}

/** Floating day sheet — full list when a month cell overflows ("N more"). */
export function MonthDayPeek({
  iso,
  events,
  onClose,
  onOpen,
  onAdd,
}: {
  iso: string
  events: CalendarEvent[]
  onClose: () => void
  onOpen: (event: CalendarEvent) => void
  onAdd: () => void
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const ordered = sortMonthCellEvents(events)
  const date = new Date(`${iso}T12:00:00`)
  const weekday = date.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase()
  const dayNum = date.getDate()

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    panelRef.current?.focus()
  }, [])

  return createPortal(
    <div
      className="fixed inset-0 z-[80] grid place-items-center bg-ink/25 p-4 backdrop-blur-[2px]"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-label={`${weekday} ${dayNum}`}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className="relative w-full max-w-sm rounded-2xl border border-line bg-surface-solid p-4 shadow-2xl outline-none"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 grid size-8 place-items-center rounded-full border border-line text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <Icon name="close" size={14} />
        </button>
        <div className="pr-8 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">{weekday}</p>
          <p className="mt-0.5 text-3xl font-semibold tabular-nums text-ink">{dayNum}</p>
        </div>
        {ordered.length === 0 ? (
          <p className="mt-4 text-center text-[13px] text-ink-3">Nothing due this day.</p>
        ) : (
          <ul className="mt-4 flex max-h-[min(60vh,24rem)] flex-col gap-1 overflow-y-auto">
            {ordered.map((event) => (
              <li key={event.id}>
                <MonthEventLine
                  event={event}
                  denser
                  onOpen={() => {
                    onOpen(event)
                    onClose()
                  }}
                />
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          onClick={() => {
            onAdd()
            onClose()
          }}
          className="mt-3 w-full rounded-lg border border-dashed border-line py-2 text-[12.5px] font-medium text-brand transition-colors hover:border-brand hover:bg-brand-soft"
        >
          + Add
        </button>
      </div>
    </div>,
    document.body,
  )
}
