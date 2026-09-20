import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { PageHeader } from '../components/layout/PageHeader'
import { AddressesPanel } from '../components/profile/AddressesPanel'
import { CertificationPanel } from '../components/profile/CertificationPanel'
import { EducationPanel } from '../components/profile/EducationPanel'
import { ExtraCurricularPanel } from '../components/profile/ExtraCurricularPanel'
import { IdentityCard } from '../components/profile/IdentityCard'
import { LinksPanel } from '../components/profile/LinksPanel'
import { ExperiencePanel } from '../components/ExperiencePanel'

/**
 * The right column's tail, lowest priority first. These are the only panels
 * allowed to change column: each one lands in whichever column is shorter
 * at that moment, so a long Experience list doesn't leave Links dangling a
 * screen below the left column. Everything above them keeps the fixed
 * story order in `.cursor/rules/profile-column-balance.mdc`.
 */
const TAIL: { key: string; node: ReactNode }[] = [
  { key: 'extracurriculars', node: <ExtraCurricularPanel key="extracurriculars" /> },
  { key: 'links', node: <LinksPanel key="links" /> },
]

/** Wide enough for two columns — matches Tailwind's `lg`. */
const TWO_COLUMNS = '(min-width: 1024px)'
/** The column's `gap-4`, counted once per panel placed. */
const GAP = 16
/** How uneven the columns may be before a panel moves. About one small
    panel's worth: a form opening in Addresses shouldn't send Links across
    the page and back. */
const TOLERANCE = 320

/**
 * Who you are, split from Settings (which is app preferences).
 *
 * Left reads personal/academic top-to-bottom; right is the career stack.
 * The anchors never move; only the tail (see TAIL) balances.
 */
export function ProfilePage() {
  const leftRef = useRef<HTMLDivElement>(null)
  const rightRef = useRef<HTMLDivElement>(null)
  // Which tail panels currently sit on the left, in TAIL order.
  const [onLeft, setOnLeft] = useState<Set<string>>(() => new Set())
  // The effect reads the latest placement without re-subscribing on every
  // change — re-subscribing is what made it re-measure mid-move.
  const onLeftRef = useRef(onLeft)
  onLeftRef.current = onLeft

  useLayoutEffect(() => {
    const left = leftRef.current
    const right = rightRef.current
    if (!left || !right) return

    let frame = 0
    function rebalance() {
      if (!window.matchMedia(TWO_COLUMNS).matches) {
        setOnLeft((current) => (current.size ? new Set() : current))
        return
      }
      // Measure with every tail panel treated as if it were back on the
      // right, so the decision is made from the anchors' real heights plus
      // the tail's, not from wherever the previous pass left things.
      const tailHeights = new Map<string, number>()
      const anchorsLeft = Array.from(left!.children).reduce((sum, child) => {
        const key = (child as HTMLElement).dataset.tail
        if (key) {
          tailHeights.set(key, child.getBoundingClientRect().height)
          return sum
        }
        return sum + child.getBoundingClientRect().height
      }, 0)
      const anchorsRight = Array.from(right!.children).reduce((sum, child) => {
        const key = (child as HTMLElement).dataset.tail
        if (key) {
          tailHeights.set(key, child.getBoundingClientRect().height)
          return sum
        }
        return sum + child.getBoundingClientRect().height
      }, 0)

      // Try every way of splitting the tail and keep the one that leaves the
      // columns closest in height. The tail is two or three panels, so
      // that's a handful of combinations — cheaper and better than a greedy
      // pass, which picked whichever column looked shorter *before* it knew
      // how tall the panel it was placing would be.
      const keys = TAIL.map((entry) => entry.key)
      let best: Set<string> = new Set()
      let bestGap = Infinity
      for (let mask = 0; mask < 1 << keys.length; mask++) {
        let l = anchorsLeft
        let r = anchorsRight
        const chosen = new Set<string>()
        keys.forEach((key, index) => {
          const h = (tailHeights.get(key) ?? 0) + GAP
          if (mask & (1 << index)) {
            chosen.add(key)
            l += h
          } else {
            r += h
          }
        })
        const gap = Math.abs(l - r)
        // Ties go to fewer moves, so the default (everything right) wins
        // when it's just as good.
        if (gap < bestGap || (gap === bestGap && chosen.size < best.size)) {
          bestGap = gap
          best = chosen
        }
      }
      // Don't reshuffle while the current split is within tolerance: a panel
      // hopping columns because a form opened and closed is worse than the
      // columns being a little off.
      const next = best
      const currentGap = (() => {
        let l = anchorsLeft
        let r = anchorsRight
        keys.forEach((key) => {
          const h = (tailHeights.get(key) ?? 0) + GAP
          if (onLeftRef.current.has(key)) l += h
          else r += h
        })
        return Math.abs(l - r)
      })()
      if (currentGap <= TOLERANCE) return
      setOnLeft((current) => {
        if (current.size === next.size && [...next].every((key) => current.has(key))) return current
        return next
      })
    }

    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(rebalance)
    }
    // Any panel changing height (rows loading, a form opening) re-measures.
    const observer = new ResizeObserver(schedule)
    for (const child of [...left.children, ...right.children]) observer.observe(child)
    const media = window.matchMedia(TWO_COLUMNS)
    media.addEventListener('change', schedule)
    schedule()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      media.removeEventListener('change', schedule)
    }
    // Re-run when a tail panel moves so the observer follows it to its new
    // column — its DOM node is recreated on the other side.
  }, [onLeft])

  const leftTail = TAIL.filter((entry) => onLeft.has(entry.key))
  const rightTail = TAIL.filter((entry) => !onLeft.has(entry.key))

  return (
    <>
      <PageHeader title="My Profile" subtitle="Your identity and career story." />

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <div ref={leftRef} className="flex flex-col gap-4">
          <IdentityCard />
          <AddressesPanel />
          <EducationPanel />
          {leftTail.map((entry) => (
            <div key={entry.key} data-tail={entry.key}>
              {entry.node}
            </div>
          ))}
        </div>
        <div ref={rightRef} className="flex flex-col gap-4">
          <ExperiencePanel />
          <CertificationPanel />
          {rightTail.map((entry) => (
            <div key={entry.key} data-tail={entry.key}>
              {entry.node}
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
