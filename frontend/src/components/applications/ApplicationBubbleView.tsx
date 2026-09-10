import { useMemo } from 'react'
import { Link, useLocation } from 'react-router-dom'
import type { ApplicationSummary, Company } from '../../api/types'
import { cx, initials } from '../../lib/format'
import { STAGE_TONE } from '../../lib/tones'
import { Icon } from '../ui/Icon'
import { RingFrame } from '../ui/RingFrame'
import {
  connector,
  growthFor,
  ringLayout,
  ringRadius,
  type RingDims,
} from '../../lib/ringLayout'

const NO_REGION = 'No region tagged'

type Cluster = { key: string; label: string; rows: ApplicationSummary[] }

const DIMS: RingDims = { hub: 56, node: 44, label: 14, labelW: 84, pad: 8 }
const GROWTH = growthFor(DIMS)
const HUB = DIMS.hub
const NODE = DIMS.node
const LABEL = DIMS.label
const LABEL_W = DIMS.labelW
/** Spokes past this get folded into a "+N" node rather than crowding the ring. */
const MAX_SPOKES = 8
/** Past this a ring takes two columns, so a busy group gets the room its
    extra radius needs instead of being shrunk back into a narrow card. */
const WIDE_CLUSTER = 4


function buildStageClusters(rows: ApplicationSummary[]): Cluster[] {
  const byStage = new Map<string, Cluster>()
  for (const row of rows) {
    const existing = byStage.get(row.stage)
    if (existing) existing.rows.push(row)
    else byStage.set(row.stage, { key: row.stage, label: row.stage_display, rows: [row] })
  }
  // Stage has a natural pipeline order — same one the dashboard's Pipeline
  // chart uses (STAGE_TONE's key order) — rather than sorting by count.
  const order = Object.keys(STAGE_TONE)
  return [...byStage.values()].sort(
    (a, b) => order.indexOf(a.key) - order.indexOf(b.key),
  )
}

function buildRegionClusters(rows: ApplicationSummary[], companies: Company[]): Cluster[] {
  const companyById = new Map(companies.map((c) => [c.id, c]))
  const byRegion = new Map<string, Cluster>()

  for (const row of rows) {
    const company = companyById.get(row.company)
    const regionNames = company?.region_names ?? []
    // A company tagged with several regions puts its applications in each
    // ring — same "genuinely belongs in every group" call NetworkGraph makes
    // for a person at several companies.
    const keys = regionNames.length ? regionNames : [NO_REGION]
    for (const label of keys) {
      const existing = byRegion.get(label)
      if (existing) existing.rows.push(row)
      else byRegion.set(label, { key: label, label, rows: [row] })
    }
  }

  return [...byRegion.values()].sort((a, b) => {
    if (a.key === NO_REGION) return 1
    if (b.key === NO_REGION) return -1
    return b.rows.length - a.rows.length || a.label.localeCompare(b.label)
  })
}

/**
 * Hub-and-spoke bubble view for Applications — one ring per stage or region,
 * each application tethered to it like Network's own company rings. Grouping
 * by "most recent vs oldest" was considered and dropped: recency is a
 * continuum, not a set of discrete buckets, so it has no natural place to
 * split a ring — the existing "Newest/Oldest first" sort already covers it.
 */
export function ApplicationBubbleView({
  rows,
  companies,
  groupBy,
}: {
  rows: ApplicationSummary[]
  companies: Company[]
  groupBy: 'stage' | 'region'
}) {
  const clusters = useMemo(
    () => (groupBy === 'stage' ? buildStageClusters(rows) : buildRegionClusters(rows, companies)),
    [rows, companies, groupBy],
  )

  if (clusters.length === 0) {
    return <p className="py-8 text-center text-[13px] text-ink-3">Nothing to show yet.</p>
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {clusters.map((cluster) => (
        <ClusterCard key={cluster.key} cluster={cluster} />
      ))}
    </div>
  )
}

function ClusterCard({ cluster }: { cluster: Cluster }) {
  const location = useLocation()
  const { label, rows } = cluster
  const shown = rows.slice(0, MAX_SPOKES)
  const overflow = rows.length - shown.length
  const spokes = shown.length + (overflow > 0 ? 1 : 0)

  const radius = ringRadius(spokes, GROWTH)
  const layout = useMemo(() => ringLayout(spokes, radius, DIMS), [spokes, radius])

  const overflowPoint = overflow > 0 ? layout.points[shown.length] : null

  return (
    <section
      className={cx(
        'rounded-card border border-line bg-surface p-3 intern:backdrop-blur-xl',
        rows.length > WIDE_CLUSTER && 'sm:col-span-2',
      )}
    >
      <header className="mb-1 flex items-center gap-2 px-1">
        <span className="grid size-6 shrink-0 place-items-center rounded-md bg-brand-soft text-brand-strong">
          <Icon name="briefcase" size={13} />
        </span>
        <h3 className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-ink">{label}</h3>
        <span className="shrink-0 text-[11.5px] text-ink-3">
          {rows.length} {rows.length === 1 ? 'application' : 'applications'}
        </span>
      </header>

      <RingFrame width={layout.width} height={layout.height}>
        <svg
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          className="absolute inset-0 size-full"
          aria-hidden="true"
        >
          {shown.map((row, index) => (
            <line
              key={row.id}
              {...connector(layout.hub, layout.points[index], DIMS)}
              stroke="var(--color-line-strong)"
              strokeWidth={1.25}
            />
          ))}
          {overflowPoint ? (
            <line
              {...connector(layout.hub, overflowPoint, DIMS)}
              stroke="var(--color-line-strong)"
              strokeWidth={1.25}
              strokeDasharray="3 3"
            />
          ) : null}
        </svg>

        <div
          className="absolute grid place-items-center rounded-full border border-line bg-surface-2 shadow-sm"
          style={{
            width: HUB,
            height: HUB,
            left: layout.hub.x - HUB / 2,
            top: layout.hub.y - HUB / 2,
          }}
          title={label}
        >
          <Icon name="briefcase" size={22} className="text-ink-3" />
        </div>

        {shown.map((row, index) => {
          const { x, y, labelAbove } = layout.points[index]
          return (
            <Link
              key={row.id}
              to={`/applications/${row.id}`}
              state={{ from: location.pathname + location.search }}
              title={`${row.company_name} — ${row.stage_display}`}
              className={cx('absolute flex items-center', labelAbove ? 'flex-col-reverse' : 'flex-col')}
              style={{
                left: x - LABEL_W / 2,
                top: y - NODE / 2 - (labelAbove ? LABEL : 0),
                width: LABEL_W,
              }}
            >
              <span
                className="grid place-items-center rounded-full bg-brand-soft text-[11px] font-semibold text-brand-strong ring-2 ring-surface transition-all hover:ring-brand"
                style={{ width: NODE, height: NODE }}
              >
                {initials(row.company_name)}
              </span>
              <span className="w-full truncate text-center text-[10px] leading-tight text-ink-2">
                {row.company_name}
              </span>
            </Link>
          )
        })}

        {overflowPoint ? (
          <div
            className="absolute grid place-items-center rounded-full border border-dashed border-line-strong bg-surface-2 text-[11px] font-semibold text-ink-3"
            style={{
              width: NODE,
              height: NODE,
              left: overflowPoint.x - NODE / 2,
              top: overflowPoint.y - NODE / 2,
            }}
            title={`${overflow} more in ${label}`}
          >
            +{overflow}
          </div>
        ) : null}
      </RingFrame>
    </section>
  )
}
