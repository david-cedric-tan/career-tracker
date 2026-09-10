import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { CompanyRef, Person } from '../../api/types'
import { cx, initials, relativeDay } from '../../lib/format'
import { Icon } from '../ui/Icon'
import { RingFrame } from '../ui/RingFrame'
import {
  connector,
  growthFor,
  ringLayout,
  ringRadius,
  type RingDims,
} from '../../lib/ringLayout'

/** Same status colours the rest of the app already uses (PERSON_STATUS_TONE
    badges) — a person's ring here should mean the same thing it does
    everywhere else, not a second colour language just for this view. */
const STATUS_RING: Record<string, string> = {
  lead: 'ring-warning',
  connection: 'ring-good',
  archived: 'ring-line-strong',
  ghosted: 'ring-serious',
}

/** People with no company still need somewhere to live on the canvas. */
const UNASSIGNED: CompanyRef = { id: -1, name: 'No company', logo: null }

/**
 * What sits in the middle of a ring. A company brings a logo; an event brings
 * a date and whatever it was about. Generalised so the company view and the
 * "where we met" event view share one set of ring maths rather than growing a
 * near-identical second copy.
 */
type Hub = {
  id: number
  name: string
  logo?: string | null
  /** Small line under the title — a date, a stage, whatever identifies it. */
  subtitle?: string | null
  /** Falls back to an icon when there's no logo. */
  icon?: string
  /** Makes the ring's title clickable. */
  href?: string
}

type Cluster = { hub: Hub; people: Person[] }

const DIMS: RingDims = { hub: 68, node: 52, label: 16, labelW: 90, pad: 8 }
const GROWTH = growthFor(DIMS)
const HUB = DIMS.hub
const NODE = DIMS.node
const LABEL = DIMS.label
const LABEL_W = DIMS.labelW
/** Past this a ring takes two columns. Without it the extra radius just gets
    scaled straight back out by the fit guard, so a busy ring has to earn a
    bigger box to actually show the extra room. */
const WIDE_CLUSTER = 3

/**
 * The people who decide whether you move forward — worth spotting at a glance
 * in a ring full of contacts. Matched on the relationship's name rather than
 * an id: relationships are a user-addable catalog now, so "Assessor" or
 * "Panel interviewer" should mark up the same as the built-in presets.
 */
const ROLE_MARKS = [
  { test: /recruit/i, label: 'Recruiter', icon: 'briefcase', tone: 'bg-brand text-white' },
  { test: /interview/i, label: 'Interviewer', icon: 'users', tone: 'bg-serious text-white' },
] as const

type RoleMark = (typeof ROLE_MARKS)[number]

function roleMark(person: Person): RoleMark | null {
  const name = person.relationship_display ?? ''
  return ROLE_MARKS.find((mark) => mark.test.test(name)) ?? null
}

/** Spokes past this get folded into a "+N" node rather than crowding the ring. */
const MAX_SPOKES = 9

function buildClusters(people: Person[]): Cluster[] {
  const byCompany = new Map<number, Cluster>()

  for (const person of people) {
    // A person can sit at several companies (M2M), and they genuinely belong
    // in each ring rather than being arbitrarily assigned to one.
    const companies = person.company_details.length
      ? person.company_details
      : [UNASSIGNED]

    for (const company of companies) {
      const existing = byCompany.get(company.id)
      if (existing) existing.people.push(person)
      else {
        byCompany.set(company.id, {
          hub: {
            id: company.id,
            name: company.name,
            logo: company.logo,
            href:
              company.id === UNASSIGNED.id
                ? undefined
                : `/job-directory/companies/${company.id}`,
          },
          people: [person],
        })
      }
    }
  }

  return [...byCompany.values()].sort((a, b) => {
    // Biggest rings first; "No company" always last.
    if (a.hub.id === UNASSIGNED.id) return 1
    if (b.hub.id === UNASSIGNED.id) return -1
    return b.people.length - a.people.length || a.hub.name.localeCompare(b.hub.name)
  })
}

/**
 * Hub-and-spoke ("number bond") view of the network: one ring per company,
 * each contact tethered to its hub by a line.
 *
 * Deliberately a grid of small independent rings rather than one force-directed
 * graph — company grouping is the question this view answers, and separate
 * rings answer it at a glance with no layout settling and no overlap.
 */
export function NetworkGraph({
  people,
  clusters: provided,
}: {
  people: Person[]
  /** Prebuilt rings — the events view groups by where you met instead of by
      company, but the drawing is identical. */
  clusters?: Cluster[]
}) {
  const byCompany = useMemo(() => buildClusters(people), [people])
  const clusters = provided ?? byCompany
  const [hovered, setHovered] = useState<number | null>(null)

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {clusters.map((cluster) => (
          <ClusterCard
            key={cluster.hub.id}
            cluster={cluster}
            hovered={hovered}
            onHover={setHovered}
          />
        ))}
      </div>
      <RoleLegend people={people} />
    </>
  )
}

export type { Cluster as NetworkCluster, Hub as NetworkHub }

function ClusterCard({
  cluster,
  hovered,
  onHover,
}: {
  cluster: Cluster
  hovered: number | null
  onHover: (id: number | null) => void
}) {
  const { hub, people } = cluster
  const shown = people.slice(0, MAX_SPOKES)
  const overflow = people.length - shown.length
  const spokes = shown.length + (overflow > 0 ? 1 : 0)

  const radius = ringRadius(spokes, GROWTH)
  const layout = useMemo(() => ringLayout(spokes, radius, DIMS), [spokes, radius])

  const overflowPoint = overflow > 0 ? layout.points[shown.length] : null

  return (
    <section
      className={cx(
        'rounded-card border border-line bg-surface p-3 intern:backdrop-blur-xl',
        people.length > WIDE_CLUSTER && 'sm:col-span-2',
      )}
    >
      <header className="mb-1 flex items-center gap-2 px-1">
        <HubMark hub={hub} size={26} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[13.5px] font-semibold text-ink">
            {hub.href ? (
              <Link to={hub.href} className="hover:underline">
                {hub.name}
              </Link>
            ) : (
              hub.name
            )}
          </h3>
          {hub.subtitle ? (
            <p className="truncate text-[11px] text-ink-3">{hub.subtitle}</p>
          ) : null}
        </div>
        <span className="shrink-0 text-[11.5px] text-ink-3">
          {people.length} {people.length === 1 ? 'person' : 'people'}
        </span>
      </header>

      <RingFrame width={layout.width} height={layout.height}>
        <svg
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          className="absolute inset-0 size-full"
          aria-hidden="true"
        >
          {shown.map((person, index) => {
            const active = hovered === person.id
            const edge = connector(layout.hub, layout.points[index], DIMS)
            return (
              <line
                key={person.id}
                {...edge}
                stroke={active ? 'var(--color-brand)' : 'var(--color-line-strong)'}
                strokeWidth={active ? 2 : 1.25}
              />
            )
          })}
          {overflowPoint ? (
            <line
              {...connector(layout.hub, overflowPoint, DIMS)}
              stroke="var(--color-line-strong)"
              strokeWidth={1.25}
              strokeDasharray="3 3"
            />
          ) : null}
        </svg>

        {/* Hub */}
        <div
          className="absolute grid place-items-center rounded-full border border-line bg-surface-2 shadow-sm"
          style={{
            width: HUB,
            height: HUB,
            left: layout.hub.x - HUB / 2,
            top: layout.hub.y - HUB / 2,
          }}
          title={hub.name}
        >
          <HubMark hub={hub} size={40} />
        </div>

        {/* Spokes */}
        {shown.map((person, index) => {
          const { x, y, labelAbove } = layout.points[index]
          return (
            <PersonNode
              key={person.id}
              person={person}
              x={x}
              y={y}
              labelAbove={labelAbove}
              active={hovered === person.id}
              onHover={onHover}
            />
          )
        })}

        {overflowPoint ? (
          <div
            className="absolute grid place-items-center rounded-full border border-dashed border-line-strong bg-surface-2 text-[12px] font-semibold text-ink-3"
            style={{
              width: NODE,
              height: NODE,
              left: overflowPoint.x - NODE / 2,
              top: overflowPoint.y - NODE / 2,
            }}
            title={`${overflow} more at ${hub.name}`}
          >
            +{overflow}
          </div>
        ) : null}
      </RingFrame>
    </section>
  )
}

function PersonNode({
  person,
  x,
  y,
  labelAbove,
  active,
  onHover,
}: {
  person: Person
  x: number
  y: number
  labelAbove: boolean
  active: boolean
  onHover: (id: number | null) => void
}) {
  const due = person.next_chat_at ? relativeDay(person.next_chat_at) : 'No chat scheduled'
  const mark = roleMark(person)

  return (
    <Link
      to={`/network/${person.id}`}
      onMouseEnter={() => onHover(person.id)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(person.id)}
      onBlur={() => onHover(null)}
      title={
        `${person.full_name} — ${person.status_display} · ${due}` +
        (mark ? ` · ${mark.label}` : '')
      }
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
      <span className="relative" style={{ width: NODE, height: NODE }}>
        <span
          className={cx(
            'grid size-full place-items-center overflow-hidden rounded-full bg-brand-soft',
            'text-[12px] font-semibold text-brand-strong ring-2 transition-all',
            STATUS_RING[person.status] ?? 'ring-line-strong',
            // Hover/focus adds a brand glow outside the status ring, rather
            // than replacing it — identity (who's a lead vs. a connection)
            // shouldn't disappear the moment you're pointing at them.
            active && 'ring-offset-2 ring-offset-surface shadow-[0_0_0_2px_var(--color-brand)]',
          )}
        >
          {person.photo ? (
            <img
              src={person.photo}
              alt=""
              loading="lazy"
              decoding="async"
              className="size-full object-cover"
            />
          ) : (
            <span aria-hidden="true">{initials(person.full_name)}</span>
          )}
        </span>
        {/* Role pip rather than a second coloured ring: the ring already
            carries status, and stacking two colour languages on one circle
            makes both harder to read than an icon that says which it is. */}
        {mark ? (
          <span
            className={cx(
              'absolute -bottom-0.5 -right-0.5 grid size-[18px] place-items-center',
              'rounded-full border-2 border-surface shadow-sm',
              mark.tone,
            )}
            title={mark.label}
          >
            <Icon name={mark.icon} size={9} strokeWidth={2.4} />
          </span>
        ) : null}
      </span>
      {/* Names are always rendered, so identity never depends on hover alone. */}
      <span
        className={cx(
          'w-full truncate text-center text-[10.5px] leading-tight transition-colors',
          labelAbove ? 'mb-0.5' : 'mt-0.5',
          active ? 'font-semibold text-ink' : 'text-ink-2',
        )}
      >
        {person.full_name}
      </span>
    </Link>
  )
}

/** Only explains the marks actually on screen — a legend for roles nobody in
    this network has is just noise. */
function RoleLegend({ people }: { people: Person[] }) {
  const present = ROLE_MARKS.filter((mark) =>
    people.some((person) => roleMark(person) === mark),
  )
  if (!present.length) return null

  return (
    <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 px-1">
      {present.map((mark) => (
        <li key={mark.label} className="flex items-center gap-1.5 text-[12px] text-ink-3">
          <span
            className={cx(
              'grid size-[18px] place-items-center rounded-full border-2 border-surface shadow-sm',
              mark.tone,
            )}
          >
            <Icon name={mark.icon} size={9} strokeWidth={2.4} />
          </span>
          {mark.label}
        </li>
      ))}
    </ul>
  )
}

function HubMark({ hub, size }: { hub: Hub; size: number }) {
  if (hub.logo) {
    return (
      <img
        src={hub.logo}
        alt=""
        loading="lazy"
        decoding="async"
        className="object-contain"
        style={{ width: size, height: size }}
      />
    )
  }

  if (hub.icon) {
    return <Icon name={hub.icon} size={size * 0.6} className="text-ink-3" />
  }

  if (hub.id === UNASSIGNED.id) {
    return <Icon name="users" size={size * 0.6} className="text-ink-3" />
  }

  return (
    <span
      className="grid place-items-center rounded-md bg-brand-soft font-semibold text-brand-strong"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials(hub.name)}
    </span>
  )
}
