import { useCallback, useEffect, useState, type ReactNode } from 'react'
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
import { CalendarWidget, FocusWidget, PhotoWidget, QuoteWidget } from './widgets'
import { RegionMapWidget } from './RegionMapWidget'

const ALL_WIDGETS = Object.keys(WIDGET_META) as WidgetId[]

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
              onDragStart={() => setDragging(id)}
              onDragOver={(event) => {
                if (editing) event.preventDefault()
              }}
              onDrop={() => drop(id)}
              onDragEnd={() => setDragging(null)}
              className={cx(
                'relative flex flex-col transition-opacity',
                SPAN_CLASS[span],
                dragging === id ? 'opacity-50' : 'opacity-100',
                editing && 'cursor-grab',
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
