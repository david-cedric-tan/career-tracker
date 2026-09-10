import { useState, type ReactNode } from 'react'
import { cx } from '../../lib/format'

/**
 * A hover label that appears immediately.
 *
 * The native `title` attribute is the usual way to do this and it's why these
 * felt sluggish: the browser waits roughly a second before showing one, styles
 * it as an OS tooltip, and gives keyboard users nothing at all. This shows on
 * the first frame, inherits the app's own surface and type, and answers to
 * focus as well as hover.
 */
export function Tooltip({
  label,
  children,
  className,
}: {
  label: ReactNode
  children: ReactNode
  className?: string
}) {
  const [open, setOpen] = useState(false)

  return (
    <span
      className={cx('relative inline-flex', className)}
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={() => setOpen(false)}
      onFocusCapture={() => setOpen(true)}
      onBlurCapture={() => setOpen(false)}
    >
      {children}
      <span
        role="tooltip"
        aria-hidden={!open}
        className={cx(
          'pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 -translate-x-1/2',
          'whitespace-nowrap rounded-lg border border-line bg-surface-solid px-2 py-1',
          'text-[11.5px] font-medium text-ink shadow-lg',
          // Only opacity animates. Animating a second translate alongside the
          // centring one made the bubble drift as it faded, which read as lag.
          'transition-opacity duration-150',
          open ? 'opacity-100' : 'opacity-0',
        )}
      >
        {label}
      </span>
    </span>
  )
}
