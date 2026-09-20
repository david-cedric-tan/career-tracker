import { useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import type { Company, Industry, JobListing } from '../../api/types'
import { cx, initials } from '../../lib/format'
import { Icon } from '../ui/Icon'
import { RingFrame } from '../ui/RingFrame'
import { connector, growthFor, ringLayout, type RingDims } from '../../lib/ringLayout'

const UNASSIGNED: Industry = { id: -1, name: 'No Industry Set' }

type Cluster = { industry: Industry; companies: Company[]; roleNames: string[] }

// Same geometry as Network's rings so the two bubble views read as one family.
const DIMS: RingDims = { hub: 68, node: 52, label: 16, labelW: 90, pad: 8 }
const GROWTH = growthFor(DIMS)
const HUB = DIMS.hub
const NODE = DIMS.node
const LABEL = DIMS.label
const LABEL_W = DIMS.labelW
/** Past this an industry takes two columns — a ring with eight companies in
    it needs the room, and shrinking it back into a narrow card was what made
    the busy industries unreadable. */
const WIDE_CLUSTER = 3

function buildClusters(
  companies: Company[],
  listings: JobListing[],
  industryCatalog: Industry[],
): Cluster[] {
  const byIndustry = new Map<number, Cluster>()
  // Looked up from the real catalog rather than zipping `company.industries`
  // (ids) against `company.industry_names` (labels) by index — that pairing
  // only holds if both arrays came from the identically-ordered query, which
  // is true today but is exactly the kind of assumption a future change to
  // either field could quietly break.
  const industryById = new Map(industryCatalog.map((entry) => [entry.id, entry]))

  // A company with no industry set still needs a home ring; a company in
  // several appears once in *every* ring it belongs to (same call as
  // `regions` and network `companies` — the M2M's real membership, not one
  // arbitrarily-picked "primary" value).
  function industriesFor(company: Company): Industry[] {
    if (company.industries.length === 0) return [UNASSIGNED]
    return company.industries.map((id) => industryById.get(id) ?? UNASSIGNED)
  }

  for (const company of companies) {
    for (const industry of industriesFor(company)) {
      const existing = byIndustry.get(industry.id)
      if (existing) existing.companies.push(company)
      else byIndustry.set(industry.id, { industry, companies: [company], roleNames: [] })
    }
  }

  // Roles under an industry are derived, not stored — every distinct role
  // seen in a listing at one of that industry's companies. A company in
  // several industries contributes its roles to each.
  const companyIndustryIds = new Map(companies.map((c) => [c.id, industriesFor(c).map((i) => i.id)]))
  const rolesByIndustry = new Map<number, Set<string>>()
  for (const listing of listings) {
    const industryIds = companyIndustryIds.get(listing.company) ?? [UNASSIGNED.id]
    for (const industryId of industryIds) {
      const set = rolesByIndustry.get(industryId) ?? new Set<string>()
      set.add(listing.role_name)
      rolesByIndustry.set(industryId, set)
    }
  }
  for (const [industryId, cluster] of byIndustry) {
    cluster.roleNames = [...(rolesByIndustry.get(industryId) ?? [])].sort((a, b) =>
      a.localeCompare(b),
    )
  }

  return [...byIndustry.values()].sort((a, b) => {
    if (a.industry.id === UNASSIGNED.id) return 1
    if (b.industry.id === UNASSIGNED.id) return -1
    return b.companies.length - a.companies.length || a.industry.name.localeCompare(b.industry.name)
  })
}

/**
 * Hub-and-spoke bubble view for the Job Directory — one ring per industry,
 * companies tethered to it like Network's own company rings (see
 * NetworkGraph), plus the distinct roles seen across that industry's
 * listings as a badge row underneath (derived, not a stored relationship —
 * Role has no industry field, so this reads it off each listing's company).
 */
export function IndustryBubbleView({
  companies,
  listings,
  industries,
}: {
  companies: Company[]
  listings: JobListing[]
  industries: Industry[]
}) {
  const clusters = useMemo(
    () => buildClusters(companies, listings, industries),
    [companies, listings, industries],
  )

  if (clusters.length === 0) {
    return (
      <p className="py-8 text-center text-[13px] text-ink-3">
        Companies appear here once you add one, grouped by industry.
      </p>
    )
  }

  return (
    // Same columns as Network, and dense flow so the one-company rings
    // backfill beside a two-column ring instead of leaving holes.
    <div className="grid grid-flow-row-dense gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      {clusters.map((cluster) => (
        <IndustryCard key={cluster.industry.id} cluster={cluster} />
      ))}
    </div>
  )
}

function IndustryCard({ cluster }: { cluster: Cluster }) {
  const { industry, companies, roleNames } = cluster
  const location = useLocation()
  const [hovered, setHovered] = useState<number | null>(null)
  const layout = useMemo(() => ringLayout(companies.length, DIMS, GROWTH), [companies.length])

  return (
    <section
      className={cx(
        'glass-panel rounded-card border border-line bg-surface p-3',
        companies.length > WIDE_CLUSTER && 'sm:col-span-2',
      )}
    >
      <header className="mb-1 flex items-center gap-2 px-1">
        <span className="grid size-[26px] shrink-0 place-items-center rounded-md bg-brand-soft text-brand-strong">
          <Icon name="building" size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[13.5px] font-semibold text-ink">{industry.name}</h3>
          {/* Roles seen across this industry's listings, as a count — the
              full list is a hover away rather than a pile of chips under
              the ring that made every card a different height. */}
          {roleNames.length ? <RolesPopover roles={roleNames} /> : null}
        </div>
        <span className="shrink-0 text-[11.5px] text-ink-3">
          {companies.length} {companies.length === 1 ? 'company' : 'companies'}
        </span>
      </header>

      <RingFrame width={layout.width} height={layout.height}>
        <svg
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          className="absolute inset-0 size-full"
          aria-hidden="true"
        >
          {companies.map((company, index) => {
            const active = hovered === company.id
            return (
              <line
                key={company.id}
                {...connector(layout.hub, layout.points[index], DIMS)}
                stroke={active ? 'var(--color-brand)' : 'var(--color-line-strong)'}
                strokeWidth={active ? 2 : 1.25}
              />
            )
          })}
        </svg>

        <div
          className="absolute grid place-items-center rounded-2xl border border-line bg-surface-2 shadow-sm"
          style={{
            width: HUB,
            height: HUB,
            left: layout.hub.x - HUB / 2,
            top: layout.hub.y - HUB / 2,
          }}
          title={industry.name}
        >
          <Icon name="building" size={26} className="text-ink-3" />
        </div>

        {companies.map((company, index) => {
          const { x, y, labelAbove } = layout.points[index]
          const active = hovered === company.id
          const label = company.short_name || company.name
          return (
            <Link
              key={company.id}
              to={`/job-directory/companies/${company.id}`}
              state={{ from: `${location.pathname}${location.search}` }}
              onMouseEnter={() => setHovered(company.id)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(company.id)}
              onBlur={() => setHovered(null)}
              title={`${company.name} — ${company.industry_names.length ? company.industry_names.join(', ') : 'No Industry'}`}
              className={cx(
                'absolute flex items-center',
                labelAbove ? 'flex-col-reverse' : 'flex-col',
              )}
              style={{
                left: x - LABEL_W / 2,
                top: y - NODE / 2 - (labelAbove ? LABEL : 0),
                width: LABEL_W,
              }}
            >
              <span
                className={cx(
                  'grid place-items-center overflow-hidden rounded-xl bg-brand-soft text-[12px] font-semibold text-brand-strong',
                  'ring-2 ring-line-strong transition-all',
                  active && 'ring-offset-2 ring-offset-surface shadow-[0_0_0_2px_var(--color-brand)]',
                )}
                style={{ width: NODE, height: NODE }}
              >
                {company.logo ? (
                  <img src={company.logo} alt="" loading="lazy" decoding="async" className="size-full object-contain p-1" />
                ) : (
                  <span aria-hidden="true">{initials(label)}</span>
                )}
              </span>
              <span
                className={cx(
                  'w-full truncate text-center text-[11px] leading-tight transition-colors',
                  active ? 'font-medium text-ink' : 'text-ink-2',
                )}
              >
                {label}
              </span>
            </Link>
          )
        })}
      </RingFrame>
    </section>
  )
}

/** "3 roles listed" — hover or focus for the actual list, one row per role. */
function RolesPopover({ roles }: { roles: string[] }) {
  const [open, setOpen] = useState(false)
  const label = `${roles.length} ${roles.length === 1 ? 'role' : 'roles'} listed`
  return (
    <span
      className="relative inline-flex"
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={() => setOpen(false)}
      onFocusCapture={() => setOpen(true)}
      onBlurCapture={() => setOpen(false)}
    >
      <button
        type="button"
        className="inline-flex items-center gap-1 text-[11px] text-ink-3 transition-colors hover:text-brand"
        aria-label={label}
      >
        <Icon name="briefcase" size={11} />
        {label}
        <Icon name="chevronDown" size={10} />
      </button>
      <span
        role="tooltip"
        aria-hidden={!open}
        className={cx(
          'absolute left-0 top-full z-40 mt-1.5 w-72 max-w-[80vw] rounded-lg border border-line bg-surface-solid p-2 text-left shadow-lg',
          'transition-opacity duration-150',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      >
        <span className="mb-1.5 block text-[10.5px] font-medium uppercase tracking-wide text-ink-3">
          {label}
        </span>
        <ul className="flex flex-col gap-1">
          {roles.map((role) => (
            <li key={role} className="flex items-start gap-2 text-[12px] leading-snug text-ink">
              <span className="mt-0.5 grid size-[20px] shrink-0 place-items-center rounded-md bg-brand-soft text-brand-strong">
                <Icon name="briefcase" size={11} />
              </span>
              <span>{role}</span>
            </li>
          ))}
        </ul>
      </span>
    </span>
  )
}
