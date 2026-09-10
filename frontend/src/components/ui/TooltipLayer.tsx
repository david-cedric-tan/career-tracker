import { useEffect, useRef, useState } from 'react'
import { cx } from '../../lib/format'

type Tip = { text: string; x: number; y: number; below: boolean }

/** Half the bubble's max width, used to keep it inside the viewport. */
const MARGIN = 8

/**
 * How long the pointer must rest before a tooltip appears.
 *
 * These fire on anything with a `title`, which is most of the small controls
 * in the app — showing them the instant the pointer crosses one turned an
 * ordinary sweep across a toolbar into a flicker of popups. Long enough to
 * mean you stopped, still well short of the browser's own ~1s.
 *
 * Deliberately not applied to the inline `Tooltip` component, which every
 * status badge and the deadline chip use: there the label is the point of the
 * element, so waiting to reveal it would just feel unresponsive.
 */
const DWELL_MS = 600

/**
 * Styles every plain `title` tooltip in the app, in one place.
 *
 * The native tooltip is why these felt slow and looked foreign: browsers wait
 * about a second, paint it as an OS chrome element that ignores the theme, and
 * show nothing at all to keyboard users. Rewriting 200-odd call sites to wrap
 * each one in a component would have been a lot of churn for the same result,
 * so this intercepts them instead: on hover it lifts the `title` off the
 * element (parking it in `data-tip`, which is what suppresses the native
 * bubble) and renders our own, then puts it back on the way out — so the
 * attribute is still there for screen readers and for anything that reads the
 * DOM.
 *
 * Anything inside `[data-native-title]` is left alone, for the places that
 * have a designed tooltip of their own — the region map pins one to the
 * country you're pointing at, and two tooltips at once would be worse than
 * either.
 */
export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null)
  const timer = useRef<number | null>(null)
  // The element the pointer is currently resting on. Tracked because
  // `pointerover` and `pointerout` fire for *every* descendant: sliding from a
  // company logo onto the name beside it used to read as leaving and
  // re-entering, which cancelled the dwell, tore the bubble down and started
  // it over — the flicker that made these feel laggy and misplaced.
  const active = useRef<HTMLElement | null>(null)

  useEffect(() => {
    function cancel() {
      if (timer.current !== null) {
        window.clearTimeout(timer.current)
        timer.current = null
      }
    }

    /** Put a parked title back where it came from. */
    function restore(element: HTMLElement | null) {
      if (element?.hasAttribute('data-tip')) {
        element.setAttribute('title', element.getAttribute('data-tip') ?? '')
        element.removeAttribute('data-tip')
      }
    }

    function close() {
      cancel()
      restore(active.current)
      active.current = null
      setTip(null)
    }

    function open(target: EventTarget | null) {
      const element =
        target instanceof Element
          ? ((target.closest('[title]') ?? target.closest('[data-tip]')) as HTMLElement | null)
          : null

      if (!element || element.closest('[data-native-title]')) {
        if (active.current) close()
        return
      }
      // Already resting on this one — moving between its children changes
      // nothing, so leave the pending timer and any open bubble alone.
      if (element === active.current) return

      close()
      const text = element.getAttribute('title')?.trim()
      if (!text) return

      // Parked immediately so the native bubble never gets its own chance to
      // appear; only *our* bubble waits for the dwell.
      element.setAttribute('data-tip', text)
      element.removeAttribute('title')
      active.current = element

      timer.current = window.setTimeout(() => {
        const box = element.getBoundingClientRect()
        // Measured when it opens, not when the pointer arrived, so a row that
        // shifted in between is still tracked correctly. Flips below when
        // there isn't room above.
        const below = box.top < 44
        setTip({
          text,
          x: Math.min(Math.max(box.left + box.width / 2, MARGIN), window.innerWidth - MARGIN),
          y: below ? box.bottom + 6 : box.top - 6,
          below,
        })
      }, DWELL_MS)
    }

    function onOut(event: PointerEvent) {
      // Only a move that leaves the tracked element entirely counts; anything
      // landing on one of its own descendants is still inside it.
      const next = event.relatedTarget
      if (
        active.current &&
        next instanceof Node &&
        active.current.contains(next)
      ) {
        return
      }
      close()
    }

    const onOver = (event: PointerEvent) => open(event.target)
    const onFocus = (event: FocusEvent) => open(event.target)

    document.addEventListener('pointerover', onOver)
    document.addEventListener('pointerout', onOut)
    document.addEventListener('focusin', onFocus)
    document.addEventListener('focusout', close)
    document.addEventListener('pointerdown', close)
    window.addEventListener('scroll', close, true)

    return () => {
      document.removeEventListener('pointerover', onOver)
      document.removeEventListener('pointerout', onOut)
      document.removeEventListener('focusin', onFocus)
      document.removeEventListener('focusout', close)
      document.removeEventListener('pointerdown', close)
      window.removeEventListener('scroll', close, true)
      close()
    }
  }, [])

  if (!tip) return null

  return (
    <span
      role="tooltip"
      className={cx(
        'pointer-events-none fixed z-[80] max-w-[16rem] rounded-lg border border-line',
        'bg-surface-solid px-2 py-1 text-[11.5px] font-medium text-ink shadow-lg',
        tip.below ? 'tooltip-in-below' : 'tooltip-in',
      )}
      style={{ left: tip.x, top: tip.y }}
    >
      {tip.text}
    </span>
  )
}
