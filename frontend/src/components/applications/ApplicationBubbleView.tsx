import { useMemo } from 'react'
import { Link, useLocation } from 'react-router-dom'
import type { ApplicationSummary, Company } from '../../api/types'
import { cx, initials } from '../../lib/format'
import { STAGE_TONE } from '../../lib/tones'
import { Icon } from '../ui/Icon'
import { RingFrame } from '../ui/RingFrame'
import { connector, growthFor, ringLayout, type RingDims } from '../../lib/ringLayout'

const NO_REGION = 'No Region Tagged'

/** Outcome buckets that sit after Offer in Current mode — not pipeline stages,
    but the natural "where it ended" homes for closed applications. */
const TERMINAL_OUTCOME_CARDS = [
  { key: 'outcome:accepted', outcome: 'accepted', label: 'Accepted' },
  { key: 'outcome:rejected', outcome: 'rejected', label: 'Rejected' },
] as const

type Cluster = {
  key: string
  label: string
  rows: ApplicationSummary[]
  kind?: 'stage' | 'outcome' | 'region'
}

const DIMS: RingDims = { hub: 56, node: 44, label: 14, labelW: 84, pad: 8 }
const GROWTH = growthFor(DIMS)
const HUB = DIMS.hub
const NODE = DIMS.node
const LABEL = DIMS.label
const LABEL_W = DIMS.labelW
/** Past this a ring takes two columns, so a busy group gets the room its
    extra radius needs instead of being shrunk back into a narrow card. */
const WIDE_CLUSTER = 4

function buildStageClusters(
  rows: ApplicationSummary[],
  mode: 'portfolio' | 'furthest',
): Cluster[] {
  const byStage = new Map<string, Cluster>()
  const byOutcome = new Map<string, Cluster>()

  for (const row of rows) {
    // Current view: Accepted / Rejected leave the pipeline and sit in their
    // own cards after Offer. Last-stage view stays pure pipeline history —
    // how far you got, not how it ended.
    if (mode === 'portfolio') {
      const terminal = TERMINAL_OUTCOME_CARDS.find((card) => card.outcome === row.outcome)
      if (terminal) {
        const existing = byOutcome.get(terminal.key)
        if (existing) existing.rows.push(row)
        else
          byOutcome.set(terminal.key, {
            key: terminal.key,
            label: terminal.label,
            rows: [row],
            kind: 'outcome',
          })
        continue
      }
    }

    const key = mode === 'furthest' ? row.furthest_stage || row.stage : row.stage
    const label =
      mode === 'furthest'
        ? row.furthest_stage_display || row.stage_display
        : row.stage_display
    const existing = byStage.get(key)
    if (existing) existing.rows.push(row)
    else byStage.set(key, { key, label, rows: [row], kind: 'stage' })
  }

  // Stage has a natural pipeline order — same one the dashboard's Pipeline
  // chart uses (STAGE_TONE's key order) — rather than sorting by count.
  const order = Object.keys(STAGE_TONE)
  const stages = [...byStage.values()].sort(
    (a, b) => order.indexOf(a.key) - order.indexOf(b.key),
  )

  // Accepted then Rejected, always after Offer (only when they have rows).
  const terminals = TERMINAL_OUTCOME_CARDS.flatMap((card) => {
    const cluster = byOutcome.get(card.key)
    return cluster ? [cluster] : []
  })

  return [...stages, ...terminals]
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
 * Hub-and-spoke bubble view for Applications — one ring per stage, outcome
 * bucket, or region.
 *
 * Current mode groups by where each application sits now, but peels Accepted /
 * Rejected into their own cards after Offer. Last Stage Reached stays on
 * furthest pipeline step (history), ignoring those outcome buckets.
 */
export function ApplicationBubbleView({
  rows,
  companies,
  groupBy,
}: {
  rows: ApplicationSummary[]
  companies: Company[]
  groupBy: 'portfolio' | 'furthest' | 'region'
}) {
  const clusters = useMemo(() => {
    if (groupBy === 'region') return buildRegionClusters(rows, companies)
    return buildStageClusters(rows, groupBy)
  }, [rows, companies, groupBy])

  if (clusters.length === 0) {
    return <p className="py-8 text-center text-[13px] text-ink-3">Nothing to show yet.</p>
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {clusters.map((cluster) => (
        <ClusterCard key={cluster.key} cluster={cluster} groupBy={groupBy} />
      ))}
    </div>
  )
}

function ClusterCard({
  cluster,
  groupBy,
}: {
  cluster: Cluster
  groupBy: 'portfolio' | 'furthest' | 'region'
}) {
  const location = useLocation()
  const { label, rows, kind } = cluster
  const layout = useMemo(() => ringLayout(rows.length, DIMS, GROWTH), [rows.length])
  const hubIcon =
    kind === 'outcome' && cluster.key === 'outcome:accepted'
      ? 'check'
      : kind === 'outcome' && cluster.key === 'outcome:rejected'
        ? 'close'
        : 'briefcase'
  const headerTone =
    kind === 'outcome' && cluster.key === 'outcome:accepted'
      ? 'bg-good/15 text-good'
      : kind === 'outcome' && cluster.key === 'outcome:rejected'
        ? 'bg-critical/15 text-critical'
        : 'bg-brand-soft text-brand-strong'

  return (
    <section
      className={cx(
        'glass-panel rounded-card border border-line bg-surface p-3',
        rows.length > WIDE_CLUSTER && 'sm:col-span-2',
      )}
    >
      <header className="mb-1 flex items-center gap-2 px-1">
        <span className={cx('grid size-6 shrink-0 place-items-center rounded-md', headerTone)}>
          <Icon name={hubIcon} size={13} />
        </span>
        <h3 className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-ink">{label}</h3>
      </header>

      <RingFrame width={layout.width} height={layout.height}>
        <svg
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          className="absolute inset-0 size-full"
          aria-hidden="true"
        >
          {rows.map((row, index) => (
            <line
              key={row.id}
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
          title={label}
        >
          <Icon
            name={hubIcon}
            size={22}
            className={
              kind === 'outcome' && cluster.key === 'outcome:accepted'
                ? 'text-good'
                : kind === 'outcome' && cluster.key === 'outcome:rejected'
                  ? 'text-critical'
                  : 'text-ink-3'
            }
          />
        </div>

        {rows.map((row, index) => {
          const { x, y, labelAbove } = layout.points[index]
          const stageHint =
            kind === 'outcome'
              ? `${row.outcome_display} · ${row.stage_display}`
              : groupBy === 'furthest' && row.furthest_stage !== row.stage
                ? `${row.furthest_stage_display} (now ${row.stage_display})`
                : row.stage_display
          return (
            <Link
              key={row.id}
              to={`/applications/${row.id}`}
              state={{ from: location.pathname + location.search }}
              title={`${row.company_name} — ${stageHint}`}
              className={cx('absolute flex items-center', labelAbove ? 'flex-col-reverse' : 'flex-col')}
              style={{
                left: x - LABEL_W / 2,
                top: y - NODE / 2 - (labelAbove ? LABEL : 0),
                width: LABEL_W,
              }}
            >
              <span
                className="grid place-items-center overflow-hidden rounded-xl bg-brand-soft text-[11px] font-semibold text-brand-strong ring-2 ring-surface transition-all hover:ring-brand"
                style={{ width: NODE, height: NODE }}
              >
                {row.company_logo ? (
                  <img
                    src={row.company_logo}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="size-full object-contain p-1"
                  />
                ) : (
                  <span aria-hidden="true">{initials(row.company_name)}</span>
                )}
              </span>
              <span className="w-full truncate text-center text-[10px] leading-tight text-ink-2">
                {row.company_name}
              </span>
            </Link>
          )
        })}

      </RingFrame>
    </section>
  )
}
