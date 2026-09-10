import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import type { Company, Industry, JobListing } from '../../api/types'
import { cx, initials } from '../../lib/format'
import { Icon } from '../ui/Icon'
import { RingFrame } from '../ui/RingFrame'
import { connector, growthFor, ringLayout, type RingDims } from '../../lib/ringLayout'

const UNASSIGNED: Industry = { id: -1, name: 'No industry set' }

type Cluster = { industry: Industry; companies: Company[]; roleNames: string[] }

const DIMS: RingDims = { hub: 56, node: 44, label: 14, labelW: 76, pad: 8 }
const GROWTH = growthFor(DIMS)
const HUB = DIMS.hub
const NODE = DIMS.node
const LABEL = DIMS.label
const LABEL_W = DIMS.labelW
/** Past this an industry takes two columns — a ring with eight companies in
    it needs the room, and shrinking it back into a narrow card was what made
    the busy industries unreadable. */
const WIDE_CLUSTER = 4


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
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {clusters.map((cluster) => (
        <IndustryCard key={cluster.industry.id} cluster={cluster} />
      ))}
    </div>
  )
}

function IndustryCard({ cluster }: { cluster: Cluster }) {
  const { industry, companies, roleNames } = cluster
  const layout = useMemo(() => ringLayout(companies.length, DIMS, GROWTH), [companies.length])

  const shownRoles = roleNames.slice(0, 6)
  const roleOverflow = roleNames.length - shownRoles.length

  return (
    <section
      className={cx(
        'rounded-card border border-line bg-surface p-3 intern:backdrop-blur-xl',
        companies.length > WIDE_CLUSTER && 'sm:col-span-2',
      )}
    >
      <header className="mb-1 flex items-center gap-2 px-1">
        <span className="grid size-6 shrink-0 place-items-center rounded-md bg-brand-soft text-brand-strong">
          <Icon name="building" size={13} />
        </span>
        <h3 className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-ink">
          {industry.name}
        </h3>
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
          {companies.map((company, index) => (
            <line
              key={company.id}
              {...connector(layout.hub, layout.points[index], DIMS)}
              stroke="var(--color-line-strong)"
              strokeWidth={1.25}
            />
          ))}
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
          <Icon name="building" size={22} className="text-ink-3" />
        </div>

        {companies.map((company, index) => {
          const { x, y, labelAbove } = layout.points[index]
          return (
            <Link
              key={company.id}
              to={`/job-directory/companies/${company.id}`}
              title={`${company.name} — ${company.industry_names.length ? company.industry_names.join(', ') : 'No industry'}`}
              className={cx(
                'absolute flex items-center transition-transform hover:scale-105',
                labelAbove ? 'flex-col-reverse' : 'flex-col',
              )}
              style={{
                left: x - LABEL_W / 2,
                top: y - NODE / 2 - (labelAbove ? LABEL : 0),
                width: LABEL_W,
              }}
            >
              <span
                className="grid place-items-center overflow-hidden rounded-xl bg-brand-soft text-[11px] font-semibold text-brand-strong ring-2 ring-surface"
                style={{ width: NODE, height: NODE }}
              >
                {company.logo ? (
                  <img src={company.logo} alt="" loading="lazy" decoding="async" className="size-full object-contain p-1" />
                ) : (
                  <span aria-hidden="true">{initials(company.short_name || company.name)}</span>
                )}
              </span>
              <span className="w-full truncate text-center text-[10px] leading-tight text-ink-2">
                {company.short_name || company.name}
              </span>
            </Link>
          )
        })}

      </RingFrame>

      {shownRoles.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1 border-t border-line pt-2">
          {shownRoles.map((role) => (
            <span
              key={role}
              className="rounded-full bg-surface-2 px-2 py-0.5 text-[10.5px] text-ink-2"
            >
              {role}
            </span>
          ))}
          {roleOverflow > 0 ? (
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10.5px] text-ink-3">
              +{roleOverflow} more
            </span>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
