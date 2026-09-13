import { useEffect, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { catchups, people } from '../api/resources'
import type { Catchup } from '../api/types'
import { CatchupForm } from '../components/CatchupForm'
import { PageHeader } from '../components/layout/PageHeader'
import { Avatar } from '../components/ui/Avatar'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { FilterDrawer } from '../components/ui/FilterDrawer'
import { Combobox } from '../components/ui/Combobox'
import { CompanyChip } from '../components/ui/CompanyChip'
import { FormatPicker } from '../components/catchups/FormatPicker'
import { Modal } from '../components/ui/Modal'
import { Icon } from '../components/ui/Icon'
import { EmptyState, ErrorState, Loading, Refreshing } from '../components/ui/States'
import { useAutoOpenFromQuery } from '../hooks/useAutoOpenFromQuery'
import { useDebounced, useResource } from '../hooks/useResource'
import { cx, formatDate, relativeDay } from '../lib/format'
import { rememberList } from '../lib/listState'
import { CATCHUP_FORMAT_ICON } from '../lib/tones'
import { RichText } from '../lib/richText'
import { plainText } from '../lib/richTextMarkers'

const CATCHUP_VIEWS = [
  { value: 'cards', label: 'Cards', icon: 'users' },
  { value: 'list', label: 'Minutes', icon: 'list' },
] as const

export function CatchupsPage() {
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  // A link from the dashboard or calendar carries a `from` so there's a way
  // back to it — direct nav here (sidebar, bookmark) shows no such link.
  const from = (location.state as { from?: string } | null)?.from ?? null
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Catchup | null>(null)
  const [viewing, setViewingState] = useState<Catchup | null>(null)
  // `?open=<id>` keeps the minutes popup in the URL, so a face clicked inside
  // it comes back to the same popup via the person page's Back.
  function setViewing(next: Catchup | null) {
    setViewingState(next)
    const updated = new URLSearchParams(params)
    if (next) updated.set('open', String(next.id))
    else updated.delete('open')
    setParams(updated, { replace: true })
  }
  const [search, setSearch] = useState(params.get('search') ?? '')
  const debouncedSearch = useDebounced(search)

  // The onboarding tour's "try it" action for this page — `?new=1` opens the
  // same form the "Log catch-up" button does.
  useAutoOpenFromQuery('new', () => {
    setEditing(null)
    setFormOpen(true)
  })

  // Search is typed, so it lives in state and is mirrored to `?search=` once
  // it settles — that way it survives leaving and coming back like the rest.
  useEffect(() => {
    const next = new URLSearchParams(params)
    if (search) next.set('search', search)
    else next.delete('search')
    if (next.toString() !== params.toString()) setParams(next, { replace: true })
  }, [search]) // eslint-disable-line react-hooks/exhaustive-deps

  const person = params.get('person') ?? ''
  const format = params.get('format') ?? ''
  // Cards by default — a wall of faces scans faster than stacked minutes;
  // the full write-ups are one toggle away. Lives in the URL like Network's.
  const view = params.get('view') === 'list' ? 'list' : 'cards'

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

  const reopenId = params.get('open')
  useEffect(() => {
    if (!reopenId || viewing || !list.data) return
    const match = list.data.find((row) => String(row.id) === reopenId)
    if (match) queueMicrotask(() => setViewingState(match))
  }, [reopenId, list.data]) // eslint-disable-line react-hooks/exhaustive-deps

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
          <>
            <div className="inline-flex rounded-lg border border-line bg-surface p-0.5">
              {CATCHUP_VIEWS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setParam('view', option.value === 'cards' ? '' : option.value)}
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
          </>
        }
      />

      <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
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
        <Combobox
          value={person ? Number(person) : null}
          onChange={(id) => setParam('person', id ? String(id) : '')}
          options={(peopleList.data ?? []).map((entry) => ({
            id: entry.id,
            label: entry.full_name,
            hint: entry.company_names[0],
            avatar: entry.photo,
          }))}
          placeholder="Everyone"
          className="sm:col-span-2"
        />
      </div>

      <FilterDrawer id="catchups" label="Format" className="mb-4" activeCount={format ? 1 : 0}>
        <FormatPicker
          allowAll
          size="sm"
          value={format}
          onChange={(next) => setParam('format', next)}
          choices={choices.data?.format}
        />
      </FilterDrawer>

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
          {view === 'cards' ? (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {rows.map((catchup) => (
                <li key={catchup.id}>
                  <CatchupTile
                    catchup={catchup}
                    onView={() => setViewing(catchup)}
                    onEdit={() => {
                      setEditing(catchup)
                      setFormOpen(true)
                    }}
                  />
                </li>
              ))}
            </ul>
          ) : (
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
          )}
        </Refreshing>
      )}

      <CatchupForm
        open={formOpen}
        existing={editing}
        choices={choices.data}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          setViewing(null)
          list.reload()
        }}
        onDeleted={() => {
          setViewing(null)
          list.reload()
        }}
      />

      {/* The full write-up, in place — the same card the Minutes view uses. */}
      {viewing ? (
        <Modal
          open
          onClose={() => setViewing(null)}
          size="lg"
          title={viewing.display_title}
          footer={
            <>
              <Button onClick={() => setViewing(null)}>Close</Button>
              <Button
                variant="primary"
                icon={<Icon name="edit" size={14} />}
                onClick={() => {
                  setEditing(viewing)
                  setFormOpen(true)
                }}
              >
                Edit minutes
              </Button>
            </>
          }
        >
          <CatchupCard catchup={viewing} />
        </Modal>
      ) : null}
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

/**
 * The compact card: a label strip on top saying what the catch-up was, then
 * the face, name and where they are, and a clipped snippet. The full minutes
 * open in place via "View minutes".
 */
function CatchupTile({
  catchup,
  onView,
  onEdit,
}: {
  catchup: Catchup
  onView: () => void
  onEdit: () => void
}) {
  const location = useLocation()
  const from = `${location.pathname}${location.search}`
  const snippet = plainText(catchup.takeaways || catchup.minutes)

  return (
    <div className="group/tile glass-panel flex h-full flex-col overflow-hidden rounded-card border border-line bg-surface transition-shadow hover:shadow-md">
      <div className="flex items-center gap-2 border-b border-line bg-brand-soft px-3 py-2 text-brand-strong">
        <span className="grid size-6 shrink-0 place-items-center rounded-md bg-brand text-white">
          <Icon name={CATCHUP_FORMAT_ICON[catchup.format] ?? 'sparkles'} size={13} />
        </span>
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold" title={catchup.display_title}>
          {catchup.display_title}
        </span>
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit minutes for ${catchup.person_name}`}
          className="rounded-md p-1 text-brand-strong/70 opacity-0 transition-opacity hover:bg-surface/60 hover:text-brand-strong focus:opacity-100 group-hover/tile:opacity-100"
        >
          <Icon name="edit" size={13} />
        </button>
      </div>

      <div className="flex flex-1 flex-col p-4">
        <Link
          to={`/network/${catchup.person}`}
          state={{ from }}
          className="flex flex-col items-center text-center"
        >
          <Avatar name={catchup.person_name} src={catchup.person_photo} size="xl" />
          <span className="mt-2.5 w-full truncate text-[14px] font-semibold text-ink">
            {catchup.person_name}
          </span>
        </Link>
        {catchup.person_companies_info?.length ? (
          <div className="mt-2 flex flex-wrap justify-center gap-1.5">
            {catchup.person_companies_info.map((company) => (
              <CompanyChip
                key={company.id}
                size="sm"
                label={company.name}
                fullName={company.full_name}
                logo={company.logo}
                companyId={company.id}
              />
            ))}
          </div>
        ) : null}

        <p className="mt-3 flex flex-wrap items-center justify-center gap-x-1.5 text-[11.5px] text-ink-3">
          <span>{formatDate(catchup.met_on)}</span>
          <span aria-hidden="true">·</span>
          <span>{catchup.format_display}</span>
        </p>
        {catchup.location ? (
          <RichText
            text={catchup.location}
            className="mt-1 text-center text-[11.5px] text-ink-3 [&_p]:m-0"
          />
        ) : null}

        {snippet ? (
          <p className="mt-2.5 line-clamp-3 text-[12.5px] leading-relaxed text-ink-2">{snippet}</p>
        ) : null}

        <div className="mt-auto flex items-center justify-between gap-2 pt-3">
          {catchup.follow_up_on ? (
            <Badge tone="brand">
              <Icon name="calendar" size={11} />
              {relativeDay(catchup.follow_up_on)}
            </Badge>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={onView}
            className="inline-flex items-center gap-1 text-[12px] font-medium text-brand hover:underline"
          >
            View minutes
            <Icon name="arrowRight" size={12} />
          </button>
        </div>
      </div>
    </div>
  )
}
