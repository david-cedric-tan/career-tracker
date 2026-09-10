/**
 * Hover animations for the sidebar nav, one per destination.
 *
 * Each is matched to what the section *is* rather than being a generic
 * "something moved" flourish: the job directory stacks books, the dashboard
 * lights its panels round clockwise, applications opens a briefcase. Where the
 * quick-access menu already has the right motion for an icon (a sonar sweep
 * for people, steam off a coffee cup) this reuses those `qa-*` layers instead
 * of inventing a second version of the same idea.
 *
 * Two kinds of effect live here. Some overlay the real icon (`sonar`, `steam`,
 * `write`); the rest are animated stand-ins built from plain boxes, which
 * means the real icon has to step aside while they play — see `hidesIcon`.
 */
import type { NavFx } from '../../lib/navFx'

/**
 * Matches `--nav-fx-delay` in index.css. Every effect waits this long before
 * it starts, so running the pointer down the sidebar on the way somewhere else
 * doesn't set all eight off in turn — only a row you actually stop on plays.
 *
 * Kept in step by hand rather than read from CSS: these are inline
 * `animation-delay` values, which have to be a number to add a stagger to.
 */
const START = 0.26

/** Clockwise from the top-left, which is what makes the sequence read as
    travelling rather than just blinking. */
const GRID_CELLS = [
  { top: 0, left: 0 },
  { top: 0, right: 0 },
  { bottom: 0, right: 0 },
  { bottom: 0, left: 0 },
]

const BOOKS = [
  { left: '6%', height: '72%' },
  { left: '39%', height: '94%' },
  { left: '72%', height: '58%' },
]

const TICKS = [{ top: '18%' }, { top: '45%' }, { top: '72%' }]

export function NavEffect({ fx }: { fx: NavFx }) {
  if (fx === 'grid') {
    return (
      <>
        {GRID_CELLS.map((position, index) => (
          <span
            key={index}
            className="nav-fx nav-grid-cell"
            style={{ ...position, animationDelay: `${START + index * 0.16}s` }}
          />
        ))}
      </>
    )
  }

  if (fx === 'books') {
    return (
      <>
        {BOOKS.map((book, index) => (
          <span
            key={index}
            className="nav-fx nav-book"
            style={{ ...book, animationDelay: `${START + index * 0.2}s` }}
          />
        ))}
      </>
    )
  }

  if (fx === 'case') {
    return (
      <>
        <span className="nav-fx nav-case-body" />
        <span className="nav-fx nav-case-lid" style={{ animationDelay: `${START}s` }} />
      </>
    )
  }

  if (fx === 'ticks') {
    return (
      <>
        {TICKS.map((tick, index) => (
          <span
            key={index}
            className="nav-fx nav-tick"
            style={{ ...tick, animationDelay: `${START + index * 0.22}s` }}
          />
        ))}
      </>
    )
  }

  // The rest borrow the quick-access layers wholesale.
  if (fx === 'sonar') {
    return (
      <>
        <span className="qa-fx qa-sonar" style={{ animationDelay: `${START}s` }} />
        <span className="qa-fx qa-sonar" style={{ animationDelay: `${START + 0.7}s` }} />
      </>
    )
  }

  if (fx === 'steam') {
    return (
      <>
        <span className="qa-fx qa-steam" style={{ left: '30%', animationDelay: `${START}s` }} />
        <span
          className="qa-fx qa-steam"
          style={{ left: '52%', animationDelay: `${START + 0.6}s` }}
        />
      </>
    )
  }

  if (fx === 'write') {
    return <span className="qa-fx qa-write" style={{ animationDelay: `${START}s` }} />
  }

  // `swing` animates the icon itself, so it needs no layer.
  return null
}
