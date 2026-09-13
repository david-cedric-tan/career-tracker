import { useEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cx } from '../../lib/format'
import { Icon } from './Icon'

const FOOTER_CHIP =
  'rounded-lg px-2.5 py-1 text-[12px] font-medium transition-colors'

/**
 * A dialog that traps focus, closes on Escape and on backdrop click, and
 * becomes a bottom sheet on small screens.
 *
 * Rendered through a portal to <body>. `position: fixed` resolves against the
 * nearest ancestor with a transform, filter or **backdrop-filter** rather than
 * the viewport — and cards carry a backdrop blur in intern mode — so a dialog
 * opened from inside a card would otherwise be trapped in that card's box.
 *
 * Pass `dirty` when the dialog holds an unsaved draft — Escape / backdrop / X
 * then ask before discarding, matching the ticket editor.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  bodyClassName,
  footerClassName,
  dirty = false,
  guardedCloseRef,
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  size?: 'md' | 'lg'
  /** Extra classes on the scrollable body — e.g. a split layout that manages
      its own overflow instead of scrolling the whole dialog. */
  bodyClassName?: string
  footerClassName?: string
  /** When true, closing asks Keep editing / Discard first. */
  dirty?: boolean
  /** Optional ref parents can call for Cancel / Close footer buttons so they
      hit the same discard prompt as Escape and the backdrop. */
  guardedCloseRef?: MutableRefObject<(() => void) | null>
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const restoreFocus = useRef<HTMLElement | null>(null)
  // Parents often pass an inline `() => …` for onClose. Keeping it out of the
  // effect deps means a poll/re-render can't re-run the focus setup and yank
  // focus onto the header X — which then closes the dialog the next time
  // someone presses Space while they think they're still typing.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty

  const [discardOpen, setDiscardOpen] = useState(false)

  useEffect(() => {
    if (!open) setDiscardOpen(false)
  }, [open])

  function requestClose() {
    if (discardOpen) {
      setDiscardOpen(false)
      return
    }
    if (dirtyRef.current) {
      setDiscardOpen(true)
      return
    }
    onCloseRef.current()
  }

  const requestCloseRef = useRef(requestClose)
  requestCloseRef.current = requestClose
  if (guardedCloseRef) guardedCloseRef.current = requestClose

  useEffect(() => {
    if (!open) return

    restoreFocus.current = document.activeElement as HTMLElement
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'

    const focusable = () =>
      Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [contenteditable="true"], [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => el.offsetParent !== null)

    // Prefer a field people will type into over the close button (first in DOM).
    const items = focusable()
    const initial =
      items.find(
        (el) =>
          el.tagName === 'TEXTAREA' ||
          el.tagName === 'INPUT' ||
          el.getAttribute('contenteditable') === 'true',
      ) ??
      items.find((el) => el.getAttribute('aria-label') !== 'Close dialog') ??
      items[0]
    initial?.focus()

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        requestCloseRef.current()
        return
      }
      if (event.key !== 'Tab' || discardOpen) return

      const next = focusable()
      if (next.length === 0) return
      const first = next[0]
      const last = next[next.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = overflow
      restoreFocus.current?.focus()
    }
  }, [open, discardOpen])

  if (!open) return null

  return createPortal(
    <>
      <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
        <div
          className="absolute inset-0 bg-slate-950/45 backdrop-blur-[2px]"
          onClick={requestClose}
          aria-hidden="true"
        />
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className={cx(
            'glass-panel relative flex max-h-[92dvh] w-full flex-col overflow-hidden border border-line bg-surface shadow-2xl intern:backdrop-blur-2xl',
            'rounded-t-2xl sm:rounded-2xl',
            size === 'lg' ? 'sm:max-w-3xl' : 'sm:max-w-lg',
          )}
        >
          <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-ink">{title}</h2>
              {description ? (
                <p className="mt-0.5 text-[13px] text-ink-3">{description}</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={requestClose}
              aria-label="Close dialog"
              className="-mr-1 rounded-lg p-1.5 text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <Icon name="close" />
            </button>
          </header>

          <div
            className={cx(
              'min-h-0 flex-1 px-5 py-4',
              bodyClassName ?? 'scrollbar-thin overflow-y-auto',
            )}
          >
            {children}
          </div>

          {footer ? (
            <footer
              className={cx(
                'flex justify-end gap-2 border-t border-line px-5 py-2.5',
                footerClassName ?? 'bg-surface-2',
              )}
            >
              {footer}
            </footer>
          ) : null}
        </div>
      </div>

      {discardOpen ? (
        <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center">
          <div
            className="absolute inset-0 bg-slate-950/50 backdrop-blur-[2px]"
            onClick={() => setDiscardOpen(false)}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Discard unsaved changes?"
            className="glass-panel relative w-full max-w-md overflow-hidden rounded-t-2xl border border-line bg-surface shadow-2xl sm:rounded-2xl"
          >
            <header className="border-b border-line px-5 py-4">
              <h2 className="text-base font-semibold text-ink">Discard unsaved changes?</h2>
            </header>
            <div className="px-5 py-4">
              <p className="text-[13.5px] text-ink-2">
                Changes haven&rsquo;t been saved. Leave without saving, or keep editing
                and save when you&rsquo;re ready.
              </p>
            </div>
            <footer className="flex justify-end gap-2 border-t border-line bg-surface-2 px-5 py-2.5">
              <button
                type="button"
                onClick={() => setDiscardOpen(false)}
                className={cx(
                  FOOTER_CHIP,
                  'border border-line/70 bg-surface/70 text-ink-2 hover:bg-surface hover:text-ink',
                )}
              >
                Keep editing
              </button>
              <button
                type="button"
                onClick={() => {
                  setDiscardOpen(false)
                  onClose()
                }}
                className={cx(FOOTER_CHIP, 'bg-critical text-white hover:opacity-90')}
              >
                Discard
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </>,
    document.body,
  )
}
