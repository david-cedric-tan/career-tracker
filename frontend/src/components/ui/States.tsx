import type { ReactNode } from 'react'
import { cx } from '../../lib/format'
import { Icon } from './Icon'
import { Spinner } from './Button'

export function EmptyState({
  icon = 'inbox',
  title,
  description,
  action,
  className,
}: {
  icon?: string
  title: string
  description?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cx('flex flex-col items-center px-6 py-14 text-center', className)}>
      <div className="mb-3 rounded-full border border-line bg-surface-2 p-3 text-ink-3">
        <Icon name={icon} size={22} />
      </div>
      <p className="text-sm font-semibold text-ink">{title}</p>
      {description ? (
        <p className="mt-1 max-w-sm text-[13px] text-ink-3">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <div className="mb-3 rounded-full border border-critical/25 bg-critical/10 p-3 text-critical">
        <Icon name="alert" size={22} />
      </div>
      <p className="text-sm font-semibold text-ink">Couldn’t load this</p>
      <p className="mt-1 max-w-sm text-[13px] text-ink-3">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 rounded-lg border border-line px-3 py-1.5 text-[13px] font-medium text-ink transition-colors hover:bg-surface-2"
        >
          Try again
        </button>
      ) : null}
    </div>
  )
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 px-6 py-14 text-sm text-ink-3">
      <Spinner />
      {label}
    </div>
  )
}

/** Wraps content that refetches: holds the old render at reduced opacity. */
export function Refreshing({
  active,
  children,
}: {
  active: boolean
  children: ReactNode
}) {
  return (
    <div
      className={cx('transition-opacity duration-200', active && 'opacity-55')}
      aria-busy={active || undefined}
    >
      {children}
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-md bg-surface-2', className)} />
}
