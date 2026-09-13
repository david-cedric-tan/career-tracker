import type { ReactNode } from 'react'
import { cx } from '../../lib/format'

export function PageHeader({
  title,
  subtitle,
  action,
  mark,
  subtitleClassName,
}: {
  title: ReactNode
  subtitle?: ReactNode
  action?: ReactNode
  /** An identifying image beside the title — a company's logo, say. */
  mark?: ReactNode
  subtitleClassName?: string
}) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="page-header-text flex min-w-0 items-center gap-3">
        {mark}
        <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">
          {title}
        </h1>
        {/* `ink-2`, not `ink-3`: this line sits directly on the wallpaper
            rather than on a glass card, and the tertiary tone all but
            disappeared against a light photo in dark mode. A page subtitle is
            secondary text anyway — `ink-3` is for hints inside a surface. */}
        {subtitle ? (
          <p className={cx('mt-1 text-sm text-ink-2', subtitleClassName)}>{subtitle}</p>
        ) : null}
        </div>
      </div>
      {action ? <div className="flex shrink-0 gap-2">{action}</div> : null}
    </header>
  )
}
