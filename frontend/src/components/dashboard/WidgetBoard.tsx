import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { updateProfile } from '../../api/auth'
import type { Attention, DashboardSummary, RegionStat } from '../../api/types'
import { useAuth } from '../../auth/context'
import { cx } from '../../lib/format'
import {
  DEFAULT_WIDGETS,
  SPAN_CLASS,
  SPANS,
  WIDGET_META,
  type WidgetId,
  type WidgetSpan,
} from '../../lib/widgets'
import { Icon } from '../ui/Icon'
import { CalendarWidget, FocusWidget } from './widgets'
import { PhotoWidget } from './PhotoWidget'
import { QuoteWidget } from './QuoteWidget'
import { RegionMapWidget } from './RegionMapWidget'

const ALL_WIDGETS = Object.keys(WIDGET_META) as WidgetId[]

/** How long a press has to last before it means "rearrange" and not "click". */
const HOLD_MS = 450

/** How close to the window edge a drag has to get before the page scrolls. */
const EDGE_PX = 90
/** Pixels per frame at the very edge; it eases in from zero at the boundary. */
const MAX_SCROLL_STEP = 18

type Layout = {
  order: WidgetId[]
  hidden: WidgetId[]
  spans: Partial<Record<WidgetId, WidgetSpan>>
}

/** Per-user, so two accounts on one machine don't share a board. */
function storageKey(userId: number | null) {
  return `dashboardWidgets:${userId ?? 'anon'}`
}

function defaultLayout(): Layout {
  return {
    order: ALL_WIDGETS,
    hidden: ALL_WIDGETS.filter((id) => !DEFAULT_WIDGETS.includes(id)),
    spans: {},
  }
}

/** Accepts both this shape and the older `{order, hidden}` one. */
function normalise(parsed: Partial<Layout> | null): Layout {
  if (!parsed) return defaultLayout()
  const known = (ids: unknown): WidgetId[] =>
    Array.isArray(ids) ? ids.filter((id): id is WidgetId => id in WIDGET_META) : []
  const order = known(parsed.order)
  const hidden = known(parsed.hidden)
  if (!order.length && !hidden.length) return defaultLayout()

  const spans: Partial<Record<WidgetId, WidgetSpan>> = {}
  for (const [id, span] of Object.entries(parsed.spans ?? {})) {
    if (id in WIDGET_META && SPANS.includes(span as WidgetSpan)) {
      spans[id as WidgetId] = span as WidgetSpan
    }
  }

  // Widgets added in a later release aren't in the stored order yet — the
  // defaults join the visible board, anything else starts in the Hidden tray
  // so it stays discoverable without crowding an existing arrangement.
  const missing = ALL_WIDGETS.filter((id) => !order.includes(id) && !hidden.includes(id))
  const newlyHidden = missing.filter((id) => !DEFAULT_WIDGETS.includes(id))
  return { order: [...order, ...missing], hidden: [...hidden, ...newlyHidden], spans }
}

function readLocal(userId: number | null): Layout | null {
  try {
    const raw = localStorage.getItem(storageKey(userId))
    return raw ? normalise(JSON.parse(raw) as Partial<Layout>) : null
  } catch {
    return null
  }
}

/**
 * The dashboard board (FR-WIDGET-*): every panel is a widget that can be
 * moved, resized, hidden and brought back.
 *
 * Drag to move, or use the arrow buttons — drag is never the only way to
 * reorder, since it's unusable by keyboard and awkward on touch. Resizing is
 * by column span (1–4 of the board's four) rather than free pixels, so a
 * widget can't be dragged into a size the responsive grid won't honour.
 *
 * The arrangement is saved to the account, so it follows the user to another
 * device instead of living only in this browser.
 */
export function WidgetBoard({
  summary,
  attention,
  regions,
  panels,
}: {
  summary: DashboardSummary | null
  attention: Attention | null
  regions: RegionStat[]
  /** Nodes for the `bare` widgets — built by the page, which owns their data. */
  panels: Partial<Record<WidgetId, ReactNode>>
}) {
  const { user, setUser } = useAuth()
  const [layout, setLayout] = useState<Layout>(() =>
    normalise(user?.dashboard_layout as Partial<Layout> | null),
  )
  const [dragging, setDragging] = useState<WidgetId | null>(null)
  const [editing, setEditing] = useState(false)
  // Long-press to start rearranging, so a tile can be picked up where it sits
  // rather than by first finding the Arrange button. Cancelled by any movement
  // or release before the hold completes, so an ordinary click still clicks.
  const holdTimer = useRef<number | null>(null)

  const cancelHold = useCallback(() => {
    if (holdTimer.current !== null) {
      window.clearTimeout(holdTimer.current)
      holdTimer.current = null
    }
  }, [])

  const startHold = useCallback(() => {
    if (editing) return
    cancelHold()
    holdTimer.current = window.setTimeout(() => {
      setEditing(true)
      // A short buzz where the platform offers one, so the mode change is
      // felt as well as seen.
      navigator.vibrate?.(15)
    }, HOLD_MS)
  }, [editing, cancelHold])

  useEffect(() => cancelHold, [cancelHold])

  // Enter and Escape both leave arrange mode. There's nothing to cancel back
  // to — every move is saved as it happens — so Escape means "I'm done here"
  // rather than "undo", and both keys do the same thing as the Done button.
  useEffect(() => {
    if (!editing) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Enter' && event.key !== 'Escape') return
      // A dialog or an input has first claim on both keys.
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) {
        return
      }
      event.preventDefault()
      setEditing(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [editing])

  // The board is taller than the window, so a tile often has to travel past
  // the fold. HTML5 drag suppresses wheel and trackpad scrolling while a drag
  // is in flight, which otherwise makes those positions unreachable — so the
  // page scrolls itself when the pointer nears an edge, easing in with
  // distance rather than snapping to a fixed speed.
  useEffect(() => {
    if (dragging === null) return

    let frame = 0
    let step = 0

    function run() {
      if (step !== 0) window.scrollBy(0, step)
      frame = requestAnimationFrame(run)
    }

    function onDragOver(event: DragEvent) {
      const fromTop = event.clientY
      const fromBottom = window.innerHeight - event.clientY
      if (fromTop < EDGE_PX) {
        step = -Math.round(((EDGE_PX - fromTop) / EDGE_PX) * MAX_SCROLL_STEP)
      } else if (fromBottom < EDGE_PX) {
        step = Math.round(((EDGE_PX - fromBottom) / EDGE_PX) * MAX_SCROLL_STEP)
      } else {
        step = 0
      }
    }

    document.addEventListener('dragover', onDragOver)
    frame = requestAnimationFrame(run)
    return () => {
      document.removeEventListener('dragover', onDragOver)
      cancelAnimationFrame(frame)
    }
  }, [dragging])

  // Adopt this account's saved board once per login — saved value or the
  // default, never whatever the last user of this browser left behind.
  const [syncedForUserId, setSyncedForUserId] = useState<number | null>(null)
  if (user && user.id !== syncedForUserId) {
    setSyncedForUserId(user.id)
    setLayout(
      normalise((user.dashboard_layout as Partial<Layout> | null) ?? readLocal(user.id)),
    )
  }

  // localStorage immediately (no flash of the default on the next load), the
  // account best-effort behind it.
  useEffect(() => {
    if (!syncedForUserId) return
    try {
      localStorage.setItem(storageKey(syncedForUserId), JSON.stringify(layout))
    } catch {
      // The layout still applies for this session.
    }
  }, [layout, syncedForUserId])

  const persist = useCallback(
    (next: Layout) => {
      setLayout(next)
      if (!user) return
      void updateProfile({ dashboard_layout: next })
        .then(setUser)
        .catch(() => {
          // Non-critical — localStorage already has it for this device.
        })
    },
    [user, setUser],
  )

  const move = useCallback(
    (id: WidgetId, delta: number) => {
      const visible = layout.order.filter((entry) => !layout.hidden.includes(entry))
      const from = visible.indexOf(id)
      const to = from + delta
      if (from < 0 || to < 0 || to >= visible.length) return

      const reordered = [...visible]
      reordered.splice(to, 0, ...reordered.splice(from, 1))
      // Keep hidden widgets in the stored order so unhiding restores a place.
      persist({
        ...layout,
        order: [...reordered, ...layout.order.filter((e) => layout.hidden.includes(e))],
      })
    },
    [layout, persist],
  )

  const drop = useCallback(
    (target: WidgetId) => {
      setDragging(null)
      if (!dragging || dragging === target) return
      const order = [...layout.order]
      const from = order.indexOf(dragging)
      const to = order.indexOf(target)
      if (from < 0 || to < 0) return
      order.splice(to, 0, ...order.splice(from, 1))
      persist({ ...layout, order })
    },
    [dragging, layout, persist],
  )

  const toggle = useCallback(
    (id: WidgetId) => {
      persist({
        ...layout,
        hidden: layout.hidden.includes(id)
          ? layout.hidden.filter((entry) => entry !== id)
          : [...layout.hidden, id],
      })
    },
    [layout, persist],
  )

  const resize = useCallback(
    (id: WidgetId, delta: number) => {
      const target = (layout.spans[id] ?? WIDGET_META[id].span) + delta
      if (target < 1 || target > 4) return
      persist({ ...layout, spans: { ...layout.spans, [id]: target as WidgetSpan } })
    },
    [layout, persist],
  )

  const reset = useCallback(() => persist(defaultLayout()), [persist])

  const visible = layout.order.filter((id) => !layout.hidden.includes(id))

  function render(id: WidgetId): ReactNode {
    switch (id) {
      case 'quote':
        return <QuoteWidget />
      case 'calendar':
        return <CalendarWidget attention={attention} />
      case 'photo':
        return <PhotoWidget />
      case 'focus':
        return <FocusWidget summary={summary} />
      case 'map':
        return <RegionMapWidget regions={regions} />
      default:
        return panels[id] ?? null
    }
  }

  return (
    <section className="mt-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">Your board</h2>
        <div className="flex items-center gap-1.5">
          {editing ? (
            <button
              type="button"
              onClick={reset}
              className="rounded-lg border border-line px-2.5 py-1 text-[12.5px] font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
            >
              Reset
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setEditing((current) => !current)}
            aria-pressed={editing}
            className={cx(
              'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[12.5px] font-medium transition-colors',
              editing
                ? 'border-brand bg-brand-soft text-brand-strong'
                : 'border-line text-ink-2 hover:bg-surface-2 hover:text-ink',
            )}
          >
            <Icon name={editing ? 'check' : 'settings'} size={14} />
            {editing ? 'Done' : 'Arrange'}
          </button>
        </div>
      </div>

      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {visible.map((id, index) => {
          const meta = WIDGET_META[id]
          const span = layout.spans[id] ?? meta.span
          const controls = editing ? (
            <span className="flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                onClick={() => move(id, -1)}
                disabled={index === 0}
                aria-label={`Move ${meta.label} earlier`}
                className="rounded p-0.5 text-ink-3 hover:bg-surface-2 hover:text-ink disabled:opacity-30"
              >
                <Icon name="chevronLeft" size={13} />
              </button>
              <button
                type="button"
                onClick={() => move(id, 1)}
                disabled={index === visible.length - 1}
                aria-label={`Move ${meta.label} later`}
                className="rounded p-0.5 text-ink-3 hover:bg-surface-2 hover:text-ink disabled:opacity-30"
              >
                <Icon name="chevronRight" size={13} />
              </button>
              <span className="mx-0.5 h-3.5 w-px bg-line" />
              <button
                type="button"
                onClick={() => resize(id, -1)}
                disabled={span <= 1}
                aria-label={`Make ${meta.label} narrower`}
                title="Narrower"
                className="rounded p-0.5 text-ink-3 hover:bg-surface-2 hover:text-ink disabled:opacity-30"
              >
                <Icon name="minus" size={13} />
              </button>
              <span className="w-3 text-center text-[10.5px] tabular-nums text-ink-3">
                {span}
              </span>
              <button
                type="button"
                onClick={() => resize(id, 1)}
                disabled={span >= 4}
                aria-label={`Make ${meta.label} wider`}
                title="Wider"
                className="rounded p-0.5 text-ink-3 hover:bg-surface-2 hover:text-ink disabled:opacity-30"
              >
                <Icon name="plus" size={13} />
              </button>
              <button
                type="button"
                onClick={() => toggle(id)}
                aria-label={`Hide ${meta.label}`}
                className="rounded p-0.5 text-ink-3 hover:bg-surface-2 hover:text-critical"
              >
                <Icon name="close" size={13} />
              </button>
            </span>
          ) : null

          return (
            <li
              key={id}
              draggable={editing}
              onPointerDown={startHold}
              onPointerUp={cancelHold}
              onPointerLeave={cancelHold}
              // Any real movement means a scroll or a drag, not a hold.
              onPointerMove={cancelHold}
              onDragStart={() => setDragging(id)}
              onDragOver={(event) => {
                if (editing) event.preventDefault()
              }}
              onDrop={() => drop(id)}
              onDragEnd={() => setDragging(null)}
              className={cx(
                'relative flex flex-col',
                SPAN_CLASS[span],
                // Transform and shadow as well as opacity, so a tile lifts off
                // the board while it's held rather than just fading.
                'transition-[opacity,transform,box-shadow] duration-200 ease-out',
                dragging === id
                  ? 'scale-[0.97] opacity-60 shadow-lg'
                  : 'scale-100 opacity-100',
                // Everything else slides aside rather than jumping, which is
                // what makes a drop read as rearranging instead of redrawing.
                dragging !== null && dragging !== id && 'transition-transform',
                editing && 'cursor-grab active:cursor-grabbing',
                // Suppresses the OS text-selection and callout that a long
                // press would otherwise trigger mid-hold.
                editing && 'select-none',
                // A `bare` widget brings its own Card; everything else gets
                // the board's own tile chrome.
                !meta.bare &&
                  'rounded-card border bg-surface p-3.5 shadow-[0_1px_2px_rgba(16,24,40,0.04)] intern:backdrop-blur-xl',
                !meta.bare && (editing ? 'border-dashed border-brand-ring' : 'border-line'),
                meta.bare && editing && 'rounded-card ring-1 ring-dashed ring-brand-ring',
              )}
            >
              {meta.bare ? (
                <>
                  {/* Floats on the card's top edge rather than inside it — a
                      panel's own header action (the chart/table toggle)
                      already lives in that corner. */}
                  {editing ? (
                    <div className="absolute -top-3 right-3 z-10 flex items-center gap-1 rounded-lg border border-line bg-surface px-1.5 py-1 shadow-md">
                      {controls}
                    </div>
                  ) : null}
                  <div className="flex-1">{render(id)}</div>
                </>
              ) : (
                <>
                  <div className="mb-2 flex items-center gap-1.5">
                    <Icon name={meta.icon} size={13} className="text-ink-3" />
                    <h3 className="flex-1 truncate text-[12px] font-semibold uppercase tracking-wide text-ink-3">
                      {meta.label}
                    </h3>
                    {controls}
                  </div>
                  <div className="flex-1">{render(id)}</div>
                </>
              )}
            </li>
          )
        })}
      </ul>

      {/* Only while arranging, and deliberately tiny: it's a reminder of the
          two keys, not a toolbar. Pinned to the top so it stays put while the
          board scrolls under it during a drag. */}
      {editing ? (
        <div className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex justify-center px-4">
          <div className="arrange-hint fab-glow flex items-center gap-2 rounded-full border border-line bg-surface-solid px-3 py-1.5 text-[12px] text-ink-2 shadow-lg">
            <Icon name="gripVertical" size={13} className="shrink-0 text-ink-3" />
            <span>Drag tiles to rearrange</span>
            <span className="text-ink-3">·</span>
            <Key>Enter</Key>
            <span className="text-ink-3">or</span>
            <Key>Esc</Key>
            <span>when done</span>
          </div>
        </div>
      ) : null}

      {editing && layout.hidden.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[12px] text-ink-3">Hidden:</span>
          {layout.hidden.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => toggle(id)}
              className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2 py-0.5 text-[11.5px] text-ink-2 transition-colors hover:border-brand-ring hover:text-brand-strong"
            >
              <Icon name="plus" size={11} />
              {WIDGET_META[id].label}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  )
}


/** A keycap, so the shortcut reads as a key rather than as a word. */
function Key({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-line-strong bg-surface-2 px-1.5 py-0.5 font-sans text-[11px] font-semibold leading-none text-ink shadow-[0_1px_0_var(--color-line-strong)]">
      {children}
    </kbd>
  )
}
