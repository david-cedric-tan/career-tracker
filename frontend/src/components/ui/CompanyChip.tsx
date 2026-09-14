import { Link, useLocation } from 'react-router-dom'
import { cx } from '../../lib/format'
import { CompanyMark } from './CompanyMark'

/**
 * A company as a pill: logo up front, short name beside it, full name on
 * hover. Pass `to` (or `companyId`) to make it a link that remembers where
 * it came from, so the company page's back button returns here.
 */
export function CompanyChip({
  label,
  fullName,
  logo,
  companyId,
  to,
  tone = 'neutral',
  size = 'md',
  className,
}: {
  label: string
  fullName?: string | null
  logo?: string | null
  companyId?: number
  to?: string
  tone?: 'neutral' | 'brand'
  size?: 'sm' | 'md'
  className?: string
}) {
  const location = useLocation()
  const href = to ?? (companyId ? `/job-directory/companies/${companyId}` : null)
  const markSize = size === 'sm' ? 22 : 28

  const classes = cx(
    'inline-flex max-w-full items-center rounded-full border transition-colors',
    size === 'sm' ? 'gap-2 py-0.5 pl-0.5 pr-2.5' : 'gap-2.5 py-1 pl-1 pr-3.5',
    tone === 'brand'
      ? 'border-brand/25 bg-brand-soft text-brand-strong'
      : 'border-line bg-surface-2 text-ink-2',
    href &&
      (tone === 'brand'
        ? 'hover:border-brand hover:bg-brand-soft/80'
        : 'hover:border-line-strong hover:bg-surface hover:text-ink'),
    className,
  )

  const body = (
    <>
      <CompanyMark
        name={fullName || label}
        logo={logo}
        size={markSize}
        className="rounded-md shadow-none"
      />
      <span className={cx('truncate font-medium', size === 'sm' ? 'text-[12px]' : 'text-[12.5px]')}>
        {label}
      </span>
    </>
  )

  if (href) {
    return (
      <Link
        to={href}
        state={{ from: `${location.pathname}${location.search}` }}
        title={fullName || label}
        className={classes}
      >
        {body}
      </Link>
    )
  }
  return (
    <span title={fullName || label} className={classes}>
      {body}
    </span>
  )
}
