import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { CompanyStat } from '../../api/types'
import { cx, initials } from '../../lib/format'
import { Icon } from '../ui/Icon'
import { ScrollArea } from '../ui/ScrollArea'

/**
 * FR-DASH-09..11 — every company you've applied to, as small square tiles.
 *
 * A horizontal strip rather than a wrapping grid: apply to enough places and
 * a wrapping grid either eats a lot of vertical space or the tiles shrink to
 * fit, whichever's worse. This stays one row, fixed tile size, and scrolls —
 * with arrow buttons for anyone who'd rather click than drag.
 *
 * Ordering is the API's (see dashboard.views.companies): offers first, then
 * live applications by how far through the pipeline they are, then closed,
 * then companies that only rejected you. Each tile links to the application
 * list filtered to that company.
 */
export function CompanyPanel({ companies }: { companies: CompanyStat[] }) {
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  function updateScrollState() {
    const el = scrollerRef.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 4)
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4)
  }

  useEffect(() => {
    updateScrollState()
    window.addEventListener('resize', updateScrollState)
    return () => window.removeEventListener('resize', updateScrollState)
  }, [companies])

  function scrollByPage(direction: 1 | -1) {
    scrollerRef.current?.scrollBy({ left: direction * 220, behavior: 'smooth' })
  }

  if (companies.length === 0) {
    return (
      <p className="py-6 text-center text-[13px] text-ink-3">
        Companies appear here once you log an application.
      </p>
    )
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => scrollByPage(-1)}
        aria-label="Scroll companies left"
        className={cx(
          'absolute -left-2 top-[38px] z-10 grid size-7 -translate-y-1/2 place-items-center rounded-full',
          'border border-line bg-surface text-ink-2 shadow-md transition-all duration-200 hover:text-ink',
          canScrollLeft ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      >
        <Icon name="chevronLeft" size={14} />
      </button>

      <ScrollArea
        viewportRef={(node) => {
          scrollerRef.current = node
        }}
        onViewportScroll={updateScrollState}
      >
        <ul className="flex w-max snap-x snap-mandatory gap-2 px-0.5 pb-1">
        {companies.map((company) => {
          const label = company.short_name || company.name
          return (
          <li key={company.id} className="shrink-0 snap-start">
            <Link
              to={`/applications?company=${company.id}`}
              state={{ from: '/' }}
              title={`${company.name}${company.short_name ? ` (${company.short_name})` : ''} — ${company.count} application${company.count === 1 ? '' : 's'}${company.offers ? `, ${company.offers} offer${company.offers === 1 ? '' : 's'}` : ''}${company.waiting ? `, ${company.waiting} waiting for a reply` : ''}${company.rejected ? `, ${company.rejected} rejected` : ''}`}
              className={cx(
                'group relative flex w-20 flex-col items-center justify-center gap-1',
                'rounded-lg border border-line bg-surface-2 py-1.5 transition-all duration-200',
                'hover:-translate-y-0.5 hover:border-brand-ring hover:bg-brand-soft hover:shadow-md',
              )}
            >
              {company.logo ? (
                <img
                  src={company.logo}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="size-12 object-contain"
                />
              ) : (
                <span className="grid size-12 place-items-center rounded-md bg-brand-soft text-[15px] font-semibold text-brand-strong">
                  {initials(label)}
                </span>
              )}

              <span className="w-full truncate px-1 text-center text-[10px] leading-tight text-ink-2">
                {label}
              </span>

              {/* Count is a text badge, so the tile never relies on colour alone.
                  Tucked inside the tile's own bounds (not overhung past the
                  border) so it can never get clipped by the row's horizontal
                  scroll container. */}
              <span className="absolute right-1 top-1 grid h-[17px] min-w-[17px] place-items-center rounded-full bg-surface px-1 text-[10px] font-semibold leading-none tabular-nums text-ink-2 ring-1 ring-line">
                {company.count}
              </span>

              {/* Offer wins the corner when a company has both — the good news
                  is the more useful thing to see at tile size. */}
              {company.offers > 0 ? (
                <span
                  className="absolute left-1 top-1 grid size-4 place-items-center rounded-full bg-good text-white shadow-sm"
                  title={`${company.offers} offer${company.offers === 1 ? '' : 's'}`}
                >
                  <Icon name="check" size={10} />
                </span>
              ) : company.waiting > 0 ? (
                <span
                  className="absolute left-1 top-1 grid size-4 place-items-center rounded-full bg-warning text-white shadow-sm"
                  title={`Waiting on ${company.waiting === 1 ? 'a reply' : `${company.waiting} replies`}`}
                >
                  <Icon name="clock" size={10} />
                </span>
              ) : company.rejected > 0 && company.active === 0 ? (
                <span
                  className="absolute left-1 top-1 grid size-4 place-items-center rounded-full bg-critical text-white shadow-sm"
                  title={`${company.rejected} rejection${company.rejected === 1 ? '' : 's'}`}
                >
                  <Icon name="close" size={10} />
                </span>
              ) : null}
            </Link>
          </li>
          )
        })}
        </ul>
      </ScrollArea>

      <button
        type="button"
        onClick={() => scrollByPage(1)}
        aria-label="Scroll companies right"
        className={cx(
          'absolute -right-2 top-[38px] z-10 grid size-7 -translate-y-1/2 place-items-center rounded-full',
          'border border-line bg-surface text-ink-2 shadow-md transition-all duration-200 hover:text-ink',
          canScrollRight ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      >
        <Icon name="chevronRight" size={14} />
      </button>
    </div>
  )
}
