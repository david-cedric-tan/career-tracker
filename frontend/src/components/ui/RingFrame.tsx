import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * Holds a ring diagram at its natural size, shrinking it only if the card is
 * too narrow to fit.
 *
 * Two nested boxes on purpose. The outer one is the space the ring actually
 * occupies *after* scaling, so it's never wider than the card and `mx-auto`
 * can centre it. The inner keeps its natural size and scales from its
 * top-left corner into that space.
 *
 * Scaling a full-width box from its centre instead — the obvious approach —
 * left rings sitting off to the right, because a child wider than its parent
 * can't be centred by auto margins: they collapse to zero and it left-aligns,
 * so the transform then pinned it off-centre.
 *
 * It never scales *up*: the ring's radius is the intended size, not a floor
 * to inflate from.
 */
export function RingFrame({
  width,
  height,
  children,
}: {
  width: number
  height: number
  children: ReactNode
}) {
  const frameRef = useRef<HTMLDivElement>(null)
  const [frameWidth, setFrameWidth] = useState(0)

  useEffect(() => {
    const el = frameRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setFrameWidth(entry.contentRect.width))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const scale = frameWidth > 0 && width > frameWidth ? frameWidth / width : 1

  return (
    <div ref={frameRef} className="w-full">
      <div className="mx-auto" style={{ width: width * scale, height: height * scale }}>
        <div
          className="relative origin-top-left"
          style={{ width, height, transform: scale < 1 ? `scale(${scale})` : undefined }}
        >
          {children}
        </div>
      </div>
    </div>
  )
}
