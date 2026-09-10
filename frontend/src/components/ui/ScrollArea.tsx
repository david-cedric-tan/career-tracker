import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { cx } from '../../lib/format'

const MIN_THUMB = 28

/**
 * A horizontally scrolling area with its own scrollbar, in the shadcn/Radix
 * ScrollArea mould: the native bar is hidden and a thin rounded thumb is
 * drawn instead, so it looks the same in every browser and can be themed.
 *
 * Built directly rather than pulling in Radix — this needs a thumb, a track
 * and drag-to-scroll, and the dependency would earn its keep only if we
 * wanted the rest of the primitive.
 *
 * The bar is a real control, not decoration: the thumb drags, the track
 * jumps, and both are hidden entirely when there's nothing to scroll.
 */
export function ScrollArea({
  children,
  className,
  viewportClassName,
  viewportRef,
  onViewportScroll,
}: {
  children: ReactNode
  className?: string
  viewportClassName?: string
  /** Handed back so the caller can drive the same element (arrow buttons). */
  viewportRef?: (element: HTMLDivElement | null) => void
  onViewportScroll?: () => void
}) {
  const localRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const dragOffset = useRef<number | null>(null)
  const [metrics, setMetrics] = useState({ ratio: 1, offset: 0 })
  const [dragging, setDragging] = useState(false)

  const measure = useCallback(() => {
    const el = localRef.current
    if (!el) return
    const { scrollWidth, clientWidth, scrollLeft } = el
    setMetrics({
      ratio: scrollWidth > 0 ? clientWidth / scrollWidth : 1,
      offset: scrollWidth > clientWidth ? scrollLeft / (scrollWidth - clientWidth) : 0,
    })
  }, [])

  useEffect(() => {
    const el = localRef.current
    if (!el) return
    measure()
    // Content can change width without the window resizing (a filtered list,
    // a logo finishing loading), so observe the element itself.
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    for (const child of Array.from(el.children)) observer.observe(child)
    return () => observer.disconnect()
  }, [measure, children])

  const scrollable = metrics.ratio < 0.999

  /** Maps a pointer x within the track to a scrollLeft, and applies it. */
  const scrollToPointer = useCallback((clientX: number, grabOffset: number) => {
    const el = localRef.current
    const track = trackRef.current
    if (!el || !track) return
    const rect = track.getBoundingClientRect()
    const thumbWidth = Math.max(MIN_THUMB, rect.width * (el.clientWidth / el.scrollWidth))
    const travel = rect.width - thumbWidth
    if (travel <= 0) return
    const left = clientX - rect.left - grabOffset
    const progress = Math.min(1, Math.max(0, left / travel))
    el.scrollLeft = progress * (el.scrollWidth - el.clientWidth)
  }, [])

  useEffect(() => {
    if (!dragging) return
    function onMove(event: PointerEvent) {
      event.preventDefault()
      scrollToPointer(event.clientX, dragOffset.current ?? 0)
    }
    function onUp() {
      dragOffset.current = null
      setDragging(false)
    }
    document.addEventListener('pointermove', onMove, { passive: false })
    document.addEventListener('pointerup', onUp)
    return () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
    }
  }, [dragging, scrollToPointer])

  const thumbPercent = Math.max(0, Math.min(1, metrics.ratio)) * 100
  // The thumb has a minimum width, so its travel is the leftover track — not
  // the full width. Positioning by percentage of that leftover keeps the far
  // edge of the thumb flush with the end of the track at full scroll.
  const travelPercent = 100 - thumbPercent

  return (
    <div className={cx('group/scroll relative', className)}>
      <div
        ref={(node) => {
          localRef.current = node
          viewportRef?.(node)
        }}
        onScroll={() => {
          measure()
          onViewportScroll?.()
        }}
        className={cx('scrollbar-none overflow-x-auto scroll-smooth', viewportClassName)}
      >
        {children}
      </div>

      {scrollable ? (
        <div
          ref={trackRef}
          onPointerDown={(event) => {
            // A click on the bare track pages toward the pointer; grabbing the
            // thumb itself is handled below and keeps its grab point.
            if (event.target === trackRef.current) {
              scrollToPointer(event.clientX, 0)
            }
          }}
          className="mt-1.5 h-1.5 w-full cursor-pointer rounded-full bg-line/60 transition-colors hover:bg-line"
        >
          <div
            role="scrollbar"
            aria-orientation="horizontal"
            aria-label="Scroll horizontally"
            aria-valuenow={Math.round(metrics.offset * 100)}
            tabIndex={-1}
            onPointerDown={(event) => {
              event.preventDefault()
              const thumb = event.currentTarget.getBoundingClientRect()
              dragOffset.current = event.clientX - thumb.left
              setDragging(true)
            }}
            style={{
              width: `max(${MIN_THUMB}px, ${thumbPercent}%)`,
              marginLeft: `${metrics.offset * travelPercent}%`,
            }}
            className={cx(
              'h-full rounded-full transition-colors',
              dragging ? 'bg-ink-3' : 'bg-line-strong group-hover/scroll:bg-ink-3/70',
            )}
          />
        </div>
      ) : null}
    </div>
  )
}
