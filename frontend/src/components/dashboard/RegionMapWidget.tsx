import { geoMercator, geoPath } from 'd3-geo'
import type { Feature, Geometry } from 'geojson'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { feature } from 'topojson-client'
import type { GeometryCollection, Topology } from 'topojson-specification'
import type { RegionStat } from '../../api/types'
import { cx } from '../../lib/format'
import { Icon } from '../ui/Icon'

// Fetched as plain JSON (not an npm import) — react-simple-maps, the obvious
// choice, pulls in a CommonJS `prop-types` that this project's Vite/Rolldown
// dev server can't bundle (a hard "require is not a function" crash, not a
// style nit). d3-geo + topojson-client are pure computation, no React
// wrapper, no CJS baggage — this renders the <path> elements itself.
const WORLD_ATLAS_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json'
const DEFAULT_WIDTH = 800
const DEFAULT_HEIGHT = 380

// The world-atlas topojson's `properties.name` is the English short name,
// which doesn't always match what someone typed into the Job Directory's
// Places tab (a country entry is free text) — this bridges the common
// mismatches rather than requiring an exact match.
const NAME_ALIASES: Record<string, string> = {
  'united states': 'United States of America',
  usa: 'United States of America',
  us: 'United States of America',
  uk: 'United Kingdom',
  britain: 'United Kingdom',
  'south korea': 'South Korea',
  'korea, south': 'South Korea',
  russia: 'Russia',
  vietnam: 'Vietnam',
  laos: 'Laos',
}

function geographyName(countryName: string): string {
  const alias = NAME_ALIASES[countryName.trim().toLowerCase()]
  return alias ?? countryName
}

type CountryFeature = Feature<Geometry, { name: string }>

/** Loads once per mount, cached in module scope — every widget instance
    (and a re-added widget after hiding it) reuses the same fetch. */
let cachedFeatures: CountryFeature[] | null = null
let inflight: Promise<CountryFeature[]> | null = null

function loadWorldFeatures(): Promise<CountryFeature[]> {
  if (cachedFeatures) return Promise.resolve(cachedFeatures)
  if (inflight) return inflight
  inflight = fetch(WORLD_ATLAS_URL)
    .then((response) => response.json())
    .then((topology: Topology) => {
      const collection = feature(
        topology,
        topology.objects.countries as GeometryCollection,
      )
      cachedFeatures = collection.features as CountryFeature[]
      return cachedFeatures
    })
    .catch(() => [])
  return inflight
}

function useWorldFeatures(): CountryFeature[] | null {
  const [features, setFeatures] = useState<CountryFeature[] | null>(cachedFeatures)

  useEffect(() => {
    if (cachedFeatures) return
    let cancelled = false
    void loadWorldFeatures().then((loaded) => {
      if (!cancelled) setFeatures(loaded)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return features
}

/** Tracks the live rendered size of a resizable container via ResizeObserver
    — the map refits its own projection to whatever shape it's dragged to,
    rather than stretching/distorting a fixed-aspect image over it. */
function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [size, setSize] = useState({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const { width, height } = entry.contentRect
      if (width > 0 && height > 0) setSize({ width, height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return { ref, size }
}

const MIN_ZOOM = 1
const MAX_ZOOM = 8
const ZOOM_STEP = 1.4

type View = { k: number; x: number; y: number }

const RESET_VIEW: View = { k: 1, x: 0, y: 0 }

const VIEW_KEY = 'career-tracker:region-map-view'

/**
 * The pan/zoom survives leaving the dashboard.
 *
 * Zooming into a region is a deliberate act — you did it to look at something
 * — so snapping back to the whole world every time you visit another page and
 * return means doing it again each time. Per-browser rather than per-account:
 * it's a viewport, not data, and the reset button is right there.
 */
function readView(): View {
  try {
    const raw = localStorage.getItem(VIEW_KEY)
    if (!raw) return RESET_VIEW
    const parsed = JSON.parse(raw) as Partial<View>
    // Guard every field: a stored value from an older shape, or a hand-edited
    // one, shouldn't leave the map at NaN with no way back but the reset.
    const k = Number(parsed.k)
    const x = Number(parsed.x)
    const y = Number(parsed.y)
    if (!Number.isFinite(k) || !Number.isFinite(x) || !Number.isFinite(y)) return RESET_VIEW
    return { k: Math.min(Math.max(k, MIN_ZOOM), MAX_ZOOM), x, y }
  } catch {
    return RESET_VIEW
  }
}

function clampZoom(k: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k))
}

export function RegionMapWidget({ regions }: { regions: RegionStat[] }) {
  const navigate = useNavigate()
  // Anchored to the country's own centroid, not to the pointer: it needs to
  // sit *near the country* (a fixed corner can be an ocean away), but a
  // tooltip that chases the cursor around jitters the whole time you're
  // reading it. Stored in untransformed projection space and mapped through
  // the current pan/zoom at render, so it stays put while hovering and still
  // tracks the country when the map moves.
  const [hovered, setHovered] = useState<{ stat: RegionStat; cx: number; cy: number } | null>(
    null,
  )
  const features = useWorldFeatures()
  const { ref: containerRef, size } = useElementSize<HTMLDivElement>()
  const [view, setView] = useState<View>(readView)
  // Distinguishes a pan from a click: a drag that moved more than a couple of
  // pixels must not also navigate to the country underneath it.
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const suppressClick = useRef(false)
  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify(view))
    } catch {
      // Not persisting is survivable — the view still holds for this session.
    }
  }, [view])

  // Moving from the country onto its own tooltip fires the country's
  // mouseleave first, which would tear the tooltip away before it could be
  // clicked. Clearing is deferred by a beat, and cancelled if the pointer
  // lands on the tooltip.
  const hideTimer = useRef<number | null>(null)

  const cancelHide = useCallback(() => {
    if (hideTimer.current !== null) {
      window.clearTimeout(hideTimer.current)
      hideTimer.current = null
    }
  }, [])

  const scheduleHide = useCallback(() => {
    cancelHide()
    hideTimer.current = window.setTimeout(() => setHovered(null), 140)
  }, [cancelHide])

  useEffect(() => cancelHide, [cancelHide])

  /** Zoom about a fixed point, so the spot under the cursor stays put. */
  const zoomAbout = useCallback((factor: number, px: number, py: number) => {
    setView((current) => {
      const k = clampZoom(current.k * factor)
      if (k === current.k) return current
      const ratio = k / current.k
      return { k, x: px - (px - current.x) * ratio, y: py - (py - current.y) * ratio }
    })
  }, [])

  // Wheel/trackpad zoom. Registered manually because it must be non-passive:
  // a passive listener can't preventDefault, so the page would scroll away
  // underneath the gesture.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    function onWheel(event: WheelEvent) {
      event.preventDefault()
      const rect = el!.getBoundingClientRect()
      zoomAbout(
        Math.exp(-event.deltaY * 0.002),
        event.clientX - rect.left,
        event.clientY - rect.top,
      )
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [containerRef, zoomAbout])

  function zoomFromButton(factor: number) {
    zoomAbout(factor, size.width / 2, size.height / 2)
  }

  // Pinch-to-zoom: every active touch by pointer id, so two fingers can be
  // told apart from one. The wheel handler above only covers trackpads.
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ distance: number; midX: number; midY: number } | null>(null)

  function pinchState(rect: DOMRect) {
    const [a, b] = [...pointers.current.values()]
    return {
      distance: Math.hypot(a.x - b.x, a.y - b.y),
      midX: (a.x + b.x) / 2 - rect.left,
      midY: (a.y + b.y) / 2 - rect.top,
    }
  }

  const byGeoName = useMemo(() => {
    const map = new Map<string, RegionStat>()
    for (const region of regions) map.set(geographyName(region.country_name), region)
    return map
  }, [regions])

  const max = Math.max(1, ...regions.map((r) => r.count))

  // Mercator — flat, straight left/right edges (a rectangle), rather than
  // the curved oval outline an equal-area/equal-earth projection draws.
  const pathGenerator = useMemo(() => {
    const projection = geoMercator().fitSize([size.width, size.height], { type: 'Sphere' })
    return geoPath(projection)
  }, [size.width, size.height])

  if (regions.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1.5 py-6 text-center">
        <p className="text-[13px] text-ink-3">
          Tag a company with a region (Job Directory → a company → Regions) to see it here.
        </p>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      // Opts out of the global tooltip layer: this widget pins its own
      // tooltip to the country you're pointing at, and two at once would be
      // worse than either.
      data-native-title=""
      // `min-w-70` (280px) plus card and page padding overflowed a 320px
      // screen, which set the whole page scrolling sideways. The floor only
      // applies once there's room for it, and drag-to-resize is a pointer
      // affordance anyway — hence `sm:`.
      className="relative min-h-55 w-full resize-none overflow-hidden rounded-lg sm:min-w-70 sm:resize"
      style={{ height: DEFAULT_HEIGHT, maxWidth: '100%', background: 'var(--map-ocean)' }}
    >
      {!features ? (
        <div className="flex h-full items-center justify-center text-[13px] text-ink-3">
          Loading map…
        </div>
      ) : (
        <svg
          viewBox={`0 0 ${size.width} ${size.height}`}
          width={size.width}
          height={size.height}
          role="img"
          aria-label="Applications by region"
          className={cx('touch-none select-none', view.k > 1 ? 'cursor-grab' : 'cursor-default')}
          onPointerDown={(event) => {
            pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
            event.currentTarget.setPointerCapture(event.pointerId)
            if (pointers.current.size === 2) {
              // Second finger down: the one-finger drag becomes a pinch.
              drag.current = null
              suppressClick.current = true
              pinch.current = pinchState(event.currentTarget.getBoundingClientRect())
              return
            }
            drag.current = { x: event.clientX, y: event.clientY, moved: false }
          }}
          onPointerMove={(event) => {
            if (pointers.current.has(event.pointerId)) {
              pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
            }
            if (pointers.current.size === 2 && pinch.current) {
              const next = pinchState(event.currentTarget.getBoundingClientRect())
              const previous = pinch.current
              if (previous.distance > 0) {
                zoomAbout(next.distance / previous.distance, next.midX, next.midY)
              }
              setView((current) => ({
                ...current,
                x: current.x + (next.midX - previous.midX),
                y: current.y + (next.midY - previous.midY),
              }))
              pinch.current = next
              return
            }
            const state = drag.current
            if (!state) return
            const dx = event.clientX - state.x
            const dy = event.clientY - state.y
            if (!state.moved && Math.hypot(dx, dy) < 3) return
            state.moved = true
            state.x = event.clientX
            state.y = event.clientY
            setView((current) => ({ ...current, x: current.x + dx, y: current.y + dy }))
          }}
          onPointerUp={(event) => {
            pointers.current.delete(event.pointerId)
            if (pointers.current.size < 2) pinch.current = null
            event.currentTarget.releasePointerCapture(event.pointerId)
            // Cleared on the next tick so the click that follows this release
            // can still see that it was a drag and skip navigating.
            const wasDrag = drag.current?.moved ?? false
            drag.current = null
            if (wasDrag) suppressClick.current = true
          }}
          onPointerCancel={(event) => {
            pointers.current.delete(event.pointerId)
            pinch.current = null
            drag.current = null
          }}
          onPointerLeave={() => {
            drag.current = null
            scheduleHide()
          }}
        >
          <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
            {features.map((geo, index) => {
              const name = geo.properties.name
              const stat = byGeoName.get(name)
              const intensity = stat ? 0.35 + 0.65 * (stat.count / max) : 0
              const d = pathGenerator(geo) ?? ''

              return (
                <path
                  key={`${name}-${index}`}
                  d={d}
                  onMouseEnter={() => {
                    if (!stat) return
                    const [cx, cy] = pathGenerator.centroid(geo)
                    if (Number.isNaN(cx) || Number.isNaN(cy)) return
                    cancelHide()
                    setHovered({ stat, cx, cy })
                  }}
                  onMouseLeave={scheduleHide}
                  onClick={() => {
                    if (suppressClick.current) {
                      suppressClick.current = false
                      return
                    }
                    if (stat) {
                      navigate(`/applications?region=${stat.country_id}`, { state: { from: '/' } })
                    }
                  }}
                  className={cx('transition-[fill] duration-150', stat && 'cursor-pointer')}
                  style={{
                    fill: stat
                      ? `color-mix(in srgb, var(--color-brand) ${Math.round(intensity * 100)}%, var(--map-land))`
                      : 'var(--map-land)',
                    stroke: 'var(--map-stroke)',
                    // Keep hairlines hairline-thin as the map scales up.
                    strokeWidth: 0.5 / view.k,
                  }}
                />
              )
            })}
          </g>
        </svg>
      )}

      {hovered ? (
        <button
          type="button"
          onMouseEnter={cancelHide}
          onMouseLeave={scheduleHide}
          onClick={() =>
            navigate(`/applications?region=${hovered.stat.country_id}`, {
              state: { from: '/' },
            })
          }
          title={`See ${hovered.stat.country_name} applications`}
          className="map-tip z-10 rounded-lg border border-line bg-surface-solid px-2.5 py-1.5 text-left shadow-md transition-colors hover:border-ink-3"
          style={{
            // The country's centroid, put through the current pan/zoom, then
            // offset up-and-right and clamped inside the widget so a country
            // near an edge doesn't push the tooltip out of view.
            left: Math.max(
              4,
              Math.min(hovered.cx * view.k + view.x + 10, Math.max(4, size.width - 154)),
            ),
            top: Math.max(4, hovered.cy * view.k + view.y - 46),
          }}
        >
          <p className="text-[12.5px] font-semibold text-ink">{hovered.stat.country_name}</p>
          <p className="text-[11px] text-ink-3">
            {hovered.stat.count} application{hovered.stat.count === 1 ? '' : 's'} →
          </p>
        </button>
      ) : null}

      {/* Sits just above the native resize corner so both stay usable. */}
      <div className="absolute bottom-5 right-2 flex flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-md">
        <button
          type="button"
          onClick={() => zoomFromButton(ZOOM_STEP)}
          disabled={view.k >= MAX_ZOOM}
          aria-label="Zoom in"
          title="Zoom in"
          className="grid size-9 place-items-center text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-40 sm:size-7"
        >
          <Icon name="plus" size={14} />
        </button>
        <button
          type="button"
          onClick={() => zoomFromButton(1 / ZOOM_STEP)}
          disabled={view.k <= MIN_ZOOM}
          aria-label="Zoom out"
          title="Zoom out"
          className="grid size-9 place-items-center border-t border-line text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-40 sm:size-7"
        >
          <Icon name="minus" size={14} />
        </button>
        <button
          type="button"
          onClick={() => setView(RESET_VIEW)}
          disabled={view.k === 1 && view.x === 0 && view.y === 0}
          aria-label="Reset the map view"
          title="Reset view"
          className="grid size-9 place-items-center border-t border-line text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-40 sm:size-7"
        >
          <Icon name="refresh" size={13} />
        </button>
      </div>

      <div
        className="pointer-events-none absolute bottom-0.5 right-1 text-[10px] text-ink-3/70"
        aria-hidden="true"
      >
        ⠿
      </div>
    </div>
  )
}
