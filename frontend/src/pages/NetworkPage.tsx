import { useMemo, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { calendarEvents, people } from '../api/resources'
import type { CalendarEventRecord, Person } from '../api/types'
import { PersonForm } from '../components/PersonForm'
import { NetworkGraph, type NetworkCluster } from '../components/network/NetworkGraph'
import { PageHeader } from '../components/layout/PageHeader'
import { Avatar } from '../components/ui/Avatar'
import { Badge } from '../components/ui/Badge'
import { CHANNEL_ICON, PERSON_STATUS_TONE } from '../lib/tones'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Select } from '../components/ui/Field'
import { Icon } from '../components/ui/Icon'
import { EmptyState, ErrorState, Loading, Refreshing } from '../components/ui/States'
import { useAutoOpenFromQuery } from '../hooks/useAutoOpenFromQuery'
import { useDebounced, useResource } from '../hooks/useResource'
import { rememberList } from '../lib/listState'
import { cx, daysFromToday, formatDate, relativeDay } from '../lib/format'

const VIEWS = [
  { value: 'cards', label: 'Cards', icon: 'users' },
  { value: 'bubbles', label: 'Bubbles', icon: 'sparkles' },
  { value: 'events', label: 'Events', icon: 'calendar' },
] as const

type View = (typeof VIEWS)[number]['value']

const DUE_FILTERS = [
  { value: '', label: 'Everyone' },
  { value: 'overdue', label: 'Chat overdue' },
  { value: 'upcoming', label: 'Chat upcoming' },
]

export function NetworkPage() {
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  // A link from the dashboard carries a `from` so there's a way back to it —
  // direct nav here (sidebar, bookmark) shows no such link.
  const from = (location.state as { from?: string } | null)?.from ?? null
  const [formOpen, setFormOpen] = useState(false)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounced(search)

  // The quick-access toolbar's "New lead" shortcut and the onboarding tour
  // both open this same form via `?new=1`.
  useAutoOpenFromQuery('new', () => setFormOpen(true))

  const status = params.get('status') ?? ''
  const relationship = params.get('relationship') ?? ''
  const due = params.get('due') ?? ''
  // The view lives in the URL so a card-view link stays a card view — the
  // absence of the param defaults to bubbles, matching Job Directory's
  // Companies tab, so an unmodified visit shows who-you-know at a glance.
  const requestedView = params.get('view')
  const view: View =
    requestedView === 'cards' || requestedView === 'events' ? requestedView : 'bubbles'

  // So a contact opened from here can send you back to exactly this view.
  rememberList('network', params.toString() ? `?${params}` : '')

  const choices = useResource(() => people.choices(), [])
  const list = useResource(
    () =>
      people.list({
        status,
        relationship,
        due,
        search: debouncedSearch,
        ordering: 'next_chat_at',
      }),
    [status, relationship, due, debouncedSearch],
  )

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  const rows = list.data ?? []

  return (
    <>
      {from ? (
        <Link
          to={from}
          className="mb-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-3 transition-colors hover:text-ink"
        >
          <Icon name="chevronLeft" size={15} />
          Back
        </Link>
      ) : null}

      <PageHeader
        title="My Network"
        subtitle={rows.length ? `${rows.length} ${rows.length === 1 ? 'person' : 'people'}` : undefined}
        action={
          <>
            <div className="inline-flex rounded-lg border border-line bg-surface p-0.5">
              {VIEWS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setParam('view', option.value === 'bubbles' ? '' : option.value)}
                  aria-pressed={view === option.value}
                  title={`${option.label} view`}
                  className={cx(
                    'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors',
                    view === option.value
                      ? 'bg-brand-soft text-brand-strong'
                      : 'text-ink-2 hover:text-ink',
                  )}
                >
                  <Icon name={option.icon} size={15} />
                  <span className="hidden sm:inline">{option.label}</span>
                </button>
              ))}
            </div>
            <Button variant="primary" onClick={() => setFormOpen(true)} icon={<Icon name="plus" size={16} />}>
              Add contact
            </Button>
          </>
        }
      />

      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative sm:col-span-2">
          <Icon
            name="search"
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3"
          />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name, title, company or notes…"
            aria-label="Search contacts"
            className="h-10 w-full rounded-lg border border-line bg-surface pl-9 pr-3 text-sm text-ink placeholder:text-ink-3 hover:border-line-strong focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-ring"
          />
        </div>
        <Select value={status} onChange={(event) => setParam('status', event.target.value)} aria-label="Filter by status">
          <option value="">All statuses</option>
          {choices.data?.status.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </Select>
        <Select value={due} onChange={(event) => setParam('due', event.target.value)} aria-label="Filter by catch-up">
          {DUE_FILTERS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </div>

      {list.initial ? (
        <Loading />
      ) : list.error && !list.data ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : rows.length === 0 ? (
        <Card padded={false}>
          <EmptyState
            icon="users"
            title={status || due || search ? 'No matches' : 'No contacts yet'}
            description={
              status || due || search
                ? 'Try a different filter.'
                : 'Add the people you meet — the app reminds you when a catch-up is due.'
            }
            action={
              !status && !due && !search ? (
                <Button variant="primary" onClick={() => setFormOpen(true)} icon={<Icon name="plus" size={16} />}>
                  Add contact
                </Button>
              ) : null
            }
          />
        </Card>
      ) : (
        <Refreshing active={list.loading && !list.initial}>
          {view === 'events' ? (
            <EventGraph people={rows} />
          ) : view === 'bubbles' ? (
            <NetworkGraph people={rows} />
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {rows.map((person) => (
                <li key={person.id}>
                  <PersonCard person={person} />
                </li>
              ))}
            </ul>
          )}
        </Refreshing>
      )}

      <PersonForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={() => list.reload()}
        choices={choices.data}
      />
    </>
  )
}

export function PersonCard({ person }: { person: Person }) {
  const overdue = person.next_chat_at ? daysFromToday(person.next_chat_at) < 0 : false

  return (
    <Link
      to={`/network/${person.id}`}
      className="flex h-full flex-col rounded-card border border-line bg-surface p-4 transition-colors hover:bg-surface-2"
    >
      <div className="flex items-start gap-3">
        <Avatar name={person.full_name} src={person.photo} size="md" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-ink">{person.full_name}</p>
          <p className="truncate text-[12.5px] text-ink-3">
            {person.title || person.relationship_display}
          </p>
        </div>
        <Badge tone={PERSON_STATUS_TONE[person.status] ?? 'neutral'}>
          {person.status_display}
        </Badge>
      </div>

      {person.company_names.length ? (
        <p className="mt-3 flex items-center gap-1.5 text-[12.5px] text-ink-2">
          <Icon name="building" size={14} className="text-ink-3" />
          <span className="truncate">{person.company_names.join(', ')}</span>
        </p>
      ) : null}

      {person.preferred_contact_display ? (
        <p className="mt-1.5 flex items-center gap-1.5 text-[12.5px] text-ink-2">
          <Icon
            name={CHANNEL_ICON[person.preferred_contact_display.channel] ?? 'link'}
            size={14}
            className="text-ink-3"
          />
          <span className="truncate">{person.preferred_contact_display.value}</span>
        </p>
      ) : null}

      <div className="mt-auto flex items-center justify-between gap-2 pt-3 text-[12px]">
        <span className="text-ink-3">{person.relationship_display}</span>
        {person.next_chat_at ? (
          <span
            className={cx(
              'inline-flex items-center gap-1 font-medium',
              overdue ? 'text-critical' : 'text-ink-2',
            )}
          >
            <Icon name={overdue ? 'alert' : 'calendar'} size={13} />
            {relativeDay(person.next_chat_at)}
          </span>
        ) : (
          <span className="text-ink-3">No chat scheduled</span>
        )}
      </div>
    </Link>
  )
}


/**
 * "Where we met" — one ring per event, spokes being the people it put you in
 * a room with. Events are calendar entries, so a careers fair, an info
 * session and an assessment centre all show up here as soon as you tag who
 * you met at them, and the hub links straight back to the calendar.
 *
 * Reuses NetworkGraph's rings rather than growing a second layout: the only
 * thing that changes is what sits in the middle.
 */
function EventGraph({ people: rows }: { people: Person[] }) {
  const events = useResource(() => calendarEvents.list({ with_people: '1' }), [])

  const clusters = useMemo<NetworkCluster[]>(() => {
    // The list view's filters and search apply to the rings too — an event
    // whose attendees are all filtered out shouldn't linger as an empty hub.
    const visible = new Map(rows.map((person) => [person.id, person]))

    return (events.data ?? [])
      .map((event: CalendarEventRecord) => ({
        hub: {
          id: event.id,
          name: event.title,
          icon: 'calendar',
          // The application label already leads with its company, so showing
          // both reads as "Deloitte · Deloitte · Applied".
          subtitle: [
            formatDate(event.date),
            event.application_label ?? event.company_name,
          ]
            .filter(Boolean)
            .join(' · '),
          href: `/calendar?event=${event.id}`,
        },
        people: event.people_details
          .map((ref) => visible.get(ref.id))
          .filter((person): person is Person => Boolean(person)),
      }))
      .filter((cluster) => cluster.people.length > 0)
      .sort((a, b) => b.people.length - a.people.length)
  }, [events.data, rows])

  if (events.initial) return <Loading />

  if (!clusters.length) {
    return (
      <Card>
        <EmptyState
          icon="calendar"
          title="No events with people yet"
          description="Add a calendar event — a careers fair, an info session, an assessment centre — and tag who you met there. It'll show up here as a ring."
          action={
            <Link to="/calendar?new=1">
              <Button variant="primary" icon={<Icon name="plus" size={15} />}>
                Add an event
              </Button>
            </Link>
          }
        />
      </Card>
    )
  }

  return <NetworkGraph people={rows} clusters={clusters} />
}
