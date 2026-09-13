import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Drag, resize and edge-snapping for a floating panel.
 *
 * Split out from the panel itself because none of this is about the panel's
 * contents — it's window management, and it's the part with the fiddly
 * pointer-capture and viewport-clamping rules.
 *
 * Snapping is deliberately limited to the two lower corners and the right
 * ledge. Those are the spots that stay out of the way of the app's own
 * chrome (the sidebar is on the left, the page header along the top), and a
 * panel that can snap anywhere mostly ends up covering something.
 */

export type Dock = 'bottom-right' | 'bottom-left' | 'right' | 'free'

export type Geometry = {
  dock: Dock
  x: number
  y: number
  width: number
  height: number
}

const GAP = 16
/** How close an edge has to get before it grabs. Generous, because you're
    throwing the panel at a corner, not placing it. */
const SNAP = 72
const MIN_WIDTH = 288
const MIN_HEIGHT = 240

export const DEFAULT_GEOMETRY: Geometry = {
  dock: 'bottom-right',
  x: 0,
  y: 0,
  width: 336,
  height: 416,
}

/** Where a docked panel actually sits, given the viewport it's sitting in. */
function resolve(geometry: Geometry, vw: number, vh: number): Geometry {
  const width = clamp(geometry.width, MIN_WIDTH, Math.max(MIN_WIDTH, vw - GAP * 2))
  let height = clamp(geometry.height, MIN_HEIGHT, Math.max(MIN_HEIGHT, vh - GAP * 2))

  switch (geometry.dock) {
    case 'bottom-right':
      return { ...geometry, width, height, x: vw - width - GAP, y: vh - height - GAP }
    case 'bottom-left':
      return { ...geometry, width, height, x: GAP, y: vh - height - GAP }
    case 'right':
      // The ledge is full-height by definition — that's what distinguishes it
      // from a panel that merely happens to be near the right edge.
      height = Math.max(MIN_HEIGHT, vh - GAP * 2)
      return { ...geometry, width, height, x: vw - width - GAP, y: GAP }
    default:
      return {
        ...geometry,
        width,
        height,
        x: clamp(geometry.x, GAP, Math.max(GAP, vw - width - GAP)),
        y: clamp(geometry.y, GAP, Math.max(GAP, vh - height - GAP)),
      }
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function snapFor(box: Geometry, vw: number, vh: number): Dock {
  const nearBottom = vh - (box.y + box.height) <= SNAP
  const nearRight = vw - (box.x + box.width) <= SNAP
  const nearLeft = box.x <= SNAP

  if (nearBottom && nearRight) return 'bottom-right'
  if (nearBottom && nearLeft) return 'bottom-left'
  if (nearRight) return 'right'
  return 'free'
}

function read(key: string): Geometry {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return DEFAULT_GEOMETRY
    const saved = JSON.parse(raw) as Partial<Geometry>
    return { ...DEFAULT_GEOMETRY, ...saved }
  } catch {
    // A hand-edited or half-written value shouldn't cost you the panel.
    return DEFAULT_GEOMETRY
  }
}

export function usePanelGeometry(storageKey: string) {
  const [geometry, setGeometry] = useState<Geometry>(() => {
    const saved = read(storageKey)
    return resolve(saved, window.innerWidth, window.innerHeight)
  })
  // Which edge is currently being courted, so the panel can preview the snap
  // before you let go — otherwise docking feels like the panel jumped.
  const [snapPreview, setSnapPreview] = useState<Dock | null>(null)
  const dragging = useRef(false)

  const persist = useCallback(
    (next: Geometry) => {
      setGeometry(next)
      try {
        localStorage.setItem(storageKey, JSON.stringify(next))
      } catch {
        // Private browsing or a full quota: the panel still works, it just
        // won't remember where it was.
      }
    },
    [storageKey],
  )

  // A docked panel has to follow the edge it's docked to when the window
  // changes size, and a free one has to stay on screen.
  useEffect(() => {
    function onResize() {
      setGeometry((current) => resolve(current, window.innerWidth, window.innerHeight))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const startDrag = useCallback(
    (event: React.PointerEvent) => {
      // Let buttons in the header still be buttons.
      if (event.button !== 0 || dragging.current) return
      const target = event.target as HTMLElement
      if (target.closest('button, a, input, textarea, select')) return

      event.preventDefault()
      dragging.current = true
      const startX = event.clientX
      const startY = event.clientY
      const origin = geometry

      function move(moveEvent: PointerEvent) {
        const vw = window.innerWidth
        const vh = window.innerHeight
        const next: Geometry = {
          ...origin,
          dock: 'free',
          x: clamp(origin.x + moveEvent.clientX - startX, 0, vw - origin.width),
          y: clamp(origin.y + moveEvent.clientY - startY, 0, vh - origin.height),
        }
        setGeometry(next)
        const dock = snapFor(next, vw, vh)
        setSnapPreview(dock === 'free' ? null : dock)
      }

      function up(upEvent: PointerEvent) {
        dragging.current = false
        setSnapPreview(null)
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)

        const vw = window.innerWidth
        const vh = window.innerHeight
        const dropped: Geometry = {
          ...origin,
          dock: 'free',
          x: clamp(origin.x + upEvent.clientX - startX, 0, vw - origin.width),
          y: clamp(origin.y + upEvent.clientY - startY, 0, vh - origin.height),
        }
        persist(resolve({ ...dropped, dock: snapFor(dropped, vw, vh) }, vw, vh))
      }

      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    },
    [geometry, persist],
  )

  /**
   * Resize from the top or left edges. The panel lives against the bottom-right
   * of the screen, so those are the edges that face open space — dragging the
   * bottom edge of a bottom-docked panel would just push it off screen.
   */
  const startResize = useCallback(
    (edge: 'top' | 'left' | 'corner') => (event: React.PointerEvent) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()

      const startX = event.clientX
      const startY = event.clientY
      const origin = geometry

      function move(moveEvent: PointerEvent) {
        const vw = window.innerWidth
        const vh = window.innerHeight
        const next = { ...origin }

        if (edge === 'left' || edge === 'corner') {
          const dx = moveEvent.clientX - startX
          next.width = clamp(origin.width - dx, MIN_WIDTH, vw - GAP * 2)
          // Free panels grow leftwards from a pinned right edge; docked ones
          // get their position recomputed by resolve() anyway.
          next.x = origin.x + (origin.width - next.width)
        }
        if (edge === 'top' || edge === 'corner') {
          const dy = moveEvent.clientY - startY
          next.height = clamp(origin.height - dy, MIN_HEIGHT, vh - GAP * 2)
          next.y = origin.y + (origin.height - next.height)
        }
        setGeometry(resolve(next, vw, vh))
      }

      function up() {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        setGeometry((current) => {
          persist(current)
          return current
        })
      }

      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    },
    [geometry, persist],
  )

  const dockTo = useCallback(
    (dock: Dock) => {
      persist(resolve({ ...geometry, dock }, window.innerWidth, window.innerHeight))
    },
    [geometry, persist],
  )

  return { geometry, snapPreview, startDrag, startResize, dockTo }
}
