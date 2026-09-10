import { useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { catchups, people } from '../api/resources'
import type { Catchup } from '../api/types'
import { CatchupForm } from '../components/CatchupForm'
import { PageHeader } from '../components/layout/PageHeader'
import { Avatar } from '../components/ui/Avatar'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Select } from '../components/ui/Field'
import { Icon } from '../components/ui/Icon'
import { EmptyState, ErrorState, Loading, Refreshing } from '../components/ui/States'
import { useAutoOpenFromQuery } from '../hooks/useAutoOpenFromQuery'
import { useDebounced, useResource } from '../hooks/useResource'
import { cx, formatDate, relativeDay } from '../lib/format'
import { rememberList } from '../lib/listState'
import { CATCHUP_FORMAT_ICON } from '../lib/tones'
import { RichText } from '../lib/richText'

export function CatchupsPage() {
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  // A link from the dashboard or calendar carries a `from` so there's a way
  // back to it — direct nav here (sidebar, bookmark) shows no such link.
  const from = (location.state as { from?: string } | null)?.from ?? null
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Catchup | null>(null)
  const [search, setSearch] = useState(params.get('search') ?? '')
  const debouncedSearch = useDebounced(search)

  // The onboarding tour's "try it" action for this page — `?new=1` opens the
  // same form the "Log catch-up" button does.
  useAutoOpenFromQuery('new', () => {
    setEditing(null)
    setFormOpen(true)
  })

  const person = params.get('person') ?? ''
  const format = params.get('format') ?? ''

  rememberList('catchups', params.toString() ? `?${params}` : '')

  const choices = useResource(() => catchups.choices(), [])
  const peopleList = useResource(() => people.list(), [])
  const list = useResource(
    () =>
      catchups.list({ person, format, search: debouncedSearch, ordering: '-met_on' }),
    [person, format, debouncedSearch],
  )

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  const rows = list.data ?? []
  const filtered = Boolean(person || format || search)

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
        title="My Catch-ups"
        subtitle={
          rows.length
            ? `${rows.length} ${rows.length === 1 ? 'meeting' : 'meetings'} minuted`
            : 'Minutes from every coffee, call and catch-up.'
        }
        action={
          <Button
            variant="primary"
            onClick={() => {
              setEditing(null)
              setFormOpen(true)
            }}
            icon={<Icon name="plus" size={16} />}
          >
            Log catch-up
          </Button>
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
            placeholder="Search minutes, takeaways, people…"
            aria-label="Search catch-ups"
            className="h-10 w-full rounded-lg border border-line bg-surface pl-9 pr-3 text-sm text-ink placeholder:text-ink-3 hover:border-line-strong focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-ring"
          />
        </div>
        <Select
          value={person}
          onChange={(event) => setParam('person', event.target.value)}
          aria-label="Filter by person"
        >
          <option value="">Everyone</option>
          {peopleList.data?.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.full_name}
            </option>
          ))}
        </Select>
        <Select
          value={format}
          onChange={(event) => setParam('format', event.target.value)}
          aria-label="Filter by format"
        >
          <option value="">All formats</option>
          {choices.data?.format.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
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
            icon="coffee"
            title={filtered ? 'No matches' : 'No catch-ups yet'}
            description={
              filtered
                ? 'Try a different filter.'
                : 'Write up a coffee chat while it’s fresh — the next one goes much better with notes.'
            }
            action={
              filtered ? null : (
                <Button
                  variant="primary"
                  onClick={() => {
                    setEditing(null)
                    setFormOpen(true)
                  }}
                  icon={<Icon name="plus" size={16} />}
                >
                  Log catch-up
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <Refreshing active={list.loading && !list.initial}>
          <ul className="flex flex-col gap-3">
            {rows.map((catchup) => (
              <li key={catchup.id}>
                <CatchupCard
                  catchup={catchup}
                  onEdit={() => {
                    setEditing(catchup)
                    setFormOpen(true)
                  }}
                />
              </li>
            ))}
          </ul>
        </Refreshing>
      )}

      <CatchupForm
        open={formOpen}
        existing={editing}
        choices={choices.data}
        onClose={() => setFormOpen(false)}
        onSaved={() => list.reload()}
        onDeleted={() => list.reload()}
      />
    </>
  )
}

export function CatchupCard({
  catchup,
  onEdit,
  showPerson = true,
}: {
  catchup: Catchup
  onEdit?: () => void
  showPerson?: boolean
}) {
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        {showPerson ? (
          <Link to={`/network/${catchup.person}`} className="shrink-0">
            <Avatar name={catchup.person_name} src={catchup.person_photo} size="md" />
          </Link>
        ) : (
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-soft text-brand-strong">
            <Icon name={CATCHUP_FORMAT_ICON[catchup.format] ?? 'sparkles'} size={17} />
          </span>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            {showPerson ? (
              <Link
                to={`/network/${catchup.person}`}
                className="font-medium text-ink hover:text-brand"
              >
                {catchup.person_name}
              </Link>
            ) : null}
            <span className="text-[13px] text-ink-2">{catchup.display_title}</span>
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-ink-3">
            <span>{formatDate(catchup.met_on)}</span>
            <span aria-hidden="true">·</span>
            <span>{catchup.format_display}</span>
            {catchup.location ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="truncate">{catchup.location}</span>
              </>
            ) : null}
            {showPerson && catchup.person_companies.length ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="truncate">{catchup.person_companies.join(', ')}</span>
              </>
            ) : null}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {catchup.follow_up_on ? (
            <Badge tone="brand">
              <Icon name="calendar" size={11} />
              {relativeDay(catchup.follow_up_on)}
            </Badge>
          ) : null}
          {onEdit ? (
            <button
              type="button"
              onClick={onEdit}
              aria-label={`Edit minutes for ${catchup.person_name}`}
              className="rounded-lg p-1.5 text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <Icon name="edit" size={15} />
            </button>
          ) : null}
        </div>
      </div>

      {catchup.minutes ? (
        <RichText
          text={catchup.minutes}
          className="rounded-lg border border-line bg-surface-2 p-3 text-[13px] leading-relaxed text-ink-2"
        />
      ) : null}

      {catchup.takeaways ? (
        <div className={cx('rounded-lg border border-brand-ring bg-brand-soft p-3')}>
          <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-brand-strong">
            <Icon name="sparkles" size={12} />
            Takeaways
          </p>
          <RichText
            text={catchup.takeaways}
            className="text-[13px] leading-relaxed text-ink-2"
          />
        </div>
      ) : null}
    </Card>
  )
}
