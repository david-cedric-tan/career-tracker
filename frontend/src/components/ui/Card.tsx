import type { ReactNode } from 'react'
import { cx } from '../../lib/format'

export function Card({
  children,
  className,
  padded = true,
}: {
  children: ReactNode
  className?: string
  padded?: boolean
}) {
  return (
    <section
      className={cx(
        'glass-panel rounded-card border border-line bg-surface shadow-[0_1px_2px_rgba(16,24,40,0.04)]',
        padded && 'p-4 sm:p-5',
        className,
      )}
    >
      {children}
    </section>
  )
}

export function CardHeader({
  title,
  subtitle,
  action,
  className,
}: {
  title: ReactNode
  subtitle?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    // Centred, not top-aligned: an action beside the title is a 40px button,
    // and top-aligning left the title's cap-height sitting a few pixels above
    // the button's label on every card that has one.
    <header className={cx('flex flex-wrap items-center justify-between gap-3', className)}>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-[13px] text-ink-3">{subtitle}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  )
}
