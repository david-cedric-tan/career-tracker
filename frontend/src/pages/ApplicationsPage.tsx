import { useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { applications, companies, countries } from '../api/resources'
import type { Application, ApplicationSummary } from '../api/types'
import { ApplicationBubbleView } from '../components/applications/ApplicationBubbleView'
import { DeadlineStat } from '../components/applications/DeadlineStat'
import { WaitingBadge } from '../components/applications/WaitingBadge'
import { CompanyMark } from '../components/ui/CompanyMark'
import { ApplicationForm } from '../components/ApplicationForm'
import { PageHeader } from '../components/layout/PageHeader'
import { Badge } from '../components/ui/Badge'
import { OUTCOME_TONE, stageTone } from '../lib/tones'
import { outcomeHint, stageHint } from '../lib/badgeHints'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Select } from '../components/ui/Field'
import { Icon } from '../components/ui/Icon'
import { EmptyState, ErrorState, Loading, Refreshing } from '../components/ui/States'
import { useAutoOpenFromQuery } from '../hooks/useAutoOpenFromQuery'
import { useDebounced, useResource } from '../hooks/useResource'
import { rememberList } from '../lib/listState'
import { cx, formatDate, relativeDay } from '../lib/format'

const ORDERINGS = [
  { value: '-applied_at', label: 'Newest first' },
  { value: 'applied_at', label: 'Oldest first' },
  { value: 'company__name', label: 'Company A–Z' },
  { value: 'follow_up_date', label: 'Follow-up soonest' },
  { value: '-updated_at', label: 'Recently updated' },
]

const VIEWS = [
  { value: 'bubbles', label: 'Bubbles', icon: 'sparkles' },
  { value: 'table', label: 'Table', icon: 'table' },
  { value: 'cards', label: 'Cards', icon: 'briefcase' },
] as const
type View = (typeof VIEWS)[number]['value']

const GROUPINGS = [
  { value: 'portfolio', label: 'Current' },
  { value: 'furthest', label: 'Last Stage Reached' },
  { value: 'region', label: 'By Region' },
] as const
type GroupBy = (typeof GROUPINGS)[number]['value']

function parseGroupBy(raw: string | null): GroupBy {
  if (raw === 'region' || raw === 'furthest') return raw
  // Legacy `stage` and bare default both mean current portfolio.
  return 'portfolio'
}

export function ApplicationsPage() {
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  // A link from the dashboard carries a `from` so there's a way back to it —
  // direct nav here (sidebar, bookmark) shows no such link.
  const from = (location.state as { from?: string } | null)?.from ?? null
  const [formOpen, setFormOpen] = useState(false)
  const [search, setSearch] = useState(params.get('search') ?? '')
  const debouncedSearch = useDebounced(search)

  // The onboarding tour's "try it" action for this page — `?new=1` opens the
  // same form the "Log application" button does.
  useAutoOpenFromQuery('new', () => setFormOpen(true))

  const stage = params.get('stage') ?? ''
  const outcome = params.get('outcome') ?? ''
  const company = params.get('company') ?? ''
  const region = params.get('region') ?? ''
  const awaiting = params.get('awaiting') ?? ''
  const ordering = params.get('ordering') ?? '-applied_at'
  const view: View = VIEWS.some((v) => v.value === params.get('view'))
    ? (params.get('view') as View)
    : 'bubbles'
  const groupBy: GroupBy = parseGroupBy(params.get('groupBy'))

  // So an application opened from here can send you back to this exact slice.
  rememberList('applications', params.toString() ? `?${params}` : '')

  const choices = useResource(() => applications.choices(), [])
  const companyList = useResource(() => companies.list(), [])
  const countryList = useResource(() => countries.list(), [])
  const list = useResource(
    () =>
      applications.list({
        stage,
        // "offers" is the dashboard's grouping: an offer on the table or
        // one already taken. The API takes the outcomes it stands for.
        outcome: outcome === 'offers' ? ['offer_received', 'accepted'] : outcome,
        company,
        region,
        awaiting,
        ordering,
        search: debouncedSearch,
      }),
    [stage, outcome, company, region, awaiting, ordering, debouncedSearch],
  )

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  const activeFilters = [stage, outcome, company, region, awaiting].filter(Boolean).length
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
        title="My Applications"
        subtitle={
          list.data ? `${rows.length} ${rows.length === 1 ? 'application' : 'applications'}` : undefined
        }
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
            <Button
              variant="primary"
              onClick={() => setFormOpen(true)}
              icon={<Icon name="plus" size={16} />}
            >
              Log application
            </Button>
          </>
        }
      />

      {/* One filter row above the list; every control scopes the same query. */}
      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
        <div className="relative sm:col-span-2 lg:col-span-2">
          <Icon
            name="search"
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3"
          />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search company, role or notes…"
            aria-label="Search applications"
            className="h-10 w-full rounded-lg border border-line bg-surface pl-9 pr-3 text-sm text-ink placeholder:text-ink-3 hover:border-line-strong focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-ring"
          />
        </div>

        <Select value={stage} onChange={(event) => setParam('stage', event.target.value)} aria-label="Filter by stage">
          <option value="">All Stages</option>
          {choices.data?.stage.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </Select>

        <Select value={outcome} onChange={(event) => setParam('outcome', event.target.value)} aria-label="Filter by outcome">
          <option value="">All Outcomes</option>
          <option value="offers">Offers (received or accepted)</option>
          {choices.data?.outcome.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </Select>

        <Select value={region} onChange={(event) => setParam('region', event.target.value)} aria-label="Filter by region">
          <option value="">All Regions</option>
          {countryList.data?.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </Select>

        <Select value={ordering} onChange={(event) => setParam('ordering', event.target.value)} aria-label="Sort applications">
          {ORDERINGS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </div>

      {activeFilters > 0 || search ? (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {company ? (
            <FilterChip
              label={companyList.data?.find((c) => String(c.id) === company)?.name ?? 'Company'}
              onClear={() => setParam('company', '')}
            />
          ) : null}
          {region ? (
            <FilterChip
              label={countryList.data?.find((c) => String(c.id) === region)?.name ?? 'Region'}
              onClear={() => setParam('region', '')}
            />
          ) : null}
          <button
            type="button"
            onClick={() => {
              setSearch('')
              setParams(new URLSearchParams(), { replace: true })
            }}
            className="text-[12.5px] font-medium text-brand hover:underline"
          >
            Clear all
          </button>
        </div>
      ) : null}

      {view === 'bubbles' ? (
        <div className="mb-3 inline-flex flex-wrap rounded-lg border border-line bg-surface p-0.5">
          {GROUPINGS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() =>
                setParam('groupBy', option.value === 'portfolio' ? '' : option.value)
              }
              aria-pressed={groupBy === option.value}
              className={cx(
                'rounded-md px-2.5 py-1.5 text-[12.5px] font-medium transition-colors',
                groupBy === option.value
                  ? 'bg-brand-soft text-brand-strong'
                  : 'text-ink-2 hover:text-ink',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}

      {list.initial ? (
        <Loading />
      ) : list.error && !list.data ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : rows.length === 0 ? (
        <Card padded={false}>
          <EmptyState
            icon="briefcase"
            title={activeFilters || search ? 'No matches' : 'No applications yet'}
            description={
              activeFilters || search
                ? 'Try loosening the filters above.'
                : 'Log your first application and the pipeline starts filling in.'
            }
            action={
              !activeFilters && !search ? (
                <Button variant="primary" onClick={() => setFormOpen(true)} icon={<Icon name="plus" size={16} />}>
                  Log application
                </Button>
              ) : null
            }
          />
        </Card>
      ) : view === 'bubbles' ? (
        <Refreshing active={list.loading && !list.initial}>
          <ApplicationBubbleView rows={rows} companies={companyList.data ?? []} groupBy={groupBy} />
        </Refreshing>
      ) : view === 'cards' ? (
        <Refreshing active={list.loading && !list.initial}>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {rows.map((row) => (
              <li key={row.id}>
                <MobileRow row={row} />
              </li>
            ))}
          </ul>
        </Refreshing>
      ) : (
        <Refreshing active={list.loading && !list.initial}>
          {/* Cards on mobile, a table from `md` up — same data, right density. */}
          <ul className="flex flex-col gap-2 md:hidden">
            {rows.map((row) => (
              <li key={row.id}>
                <MobileRow row={row} />
              </li>
            ))}
          </ul>

          <Card padded={false} className="hidden overflow-hidden md:block">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line bg-surface-2 text-left text-[12px] uppercase tracking-wide text-ink-3">
                    <th className="px-4 py-2.5 font-medium">Company</th>
                    <th className="px-4 py-2.5 font-medium">Roles</th>
                    <th className="px-4 py-2.5 font-medium">Stage</th>
                    <th className="px-4 py-2.5 font-medium">Outcome</th>
                    <th className="px-4 py-2.5 font-medium">Applied</th>
                    <th className="px-4 py-2.5 font-medium">Follow-up</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((row) => (
                    <tr key={row.id} className="transition-colors hover:bg-surface-2">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          {/* The mark links to the company, the name to the
                              application — two different destinations, so they
                              stay two separate targets. */}
                          <Link
                            to={`/job-directory/companies/${row.company}`}
                            state={{ from: `${location.pathname}${location.search}` }}
                            title={`Open ${row.company_name}`}
                            className="shrink-0 rounded-md transition-opacity hover:opacity-80"
                          >
                            <CompanyMark name={row.company_name} logo={row.company_logo} size={32} />
                          </Link>
                          <div className="min-w-0">
                            <Link
                              to={`/applications/${row.id}`}
                              className="font-medium text-ink hover:text-brand"
                            >
                              {row.company_name}
                            </Link>
                            {row.resume_label ? (
                              <p className="mt-0.5 text-[11.5px] text-ink-3">{row.resume_label}</p>
                            ) : null}
                          </div>
                        </div>
                      </td>
                      <td className="max-w-56 px-4 py-3 text-[13px] text-ink-2">
                        {row.role_names.length ? (
                          <span className="line-clamp-2">{row.role_names.join(', ')}</span>
                        ) : (
                          <span className="text-ink-3">—</span>
                        )}
                        <DeadlineStat deadline={row.deadline} className="mt-1.5" />
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          tone={stageTone(row.stage)}
                          title={stageHint(row.stage_display, row.stage_updated_at)}
                        >
                          {row.stage_display}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {/* "In progress" is what waiting *means*, so showing
                              both just says it twice. Any other outcome still
                              shows — "Rejected" beside a stale waiting badge
                              would be worth seeing. */}
                          {row.awaiting_response ? (
                            <WaitingBadge since={row.awaiting_since} days={row.awaiting_days} />
                          ) : null}
                          {row.awaiting_response && row.outcome === 'in_progress' ? null : (
                            <Badge
                              tone={OUTCOME_TONE[row.outcome] ?? 'neutral'}
                              title={outcomeHint(
                                row.outcome_display,
                                row.outcome,
                                row.outcome_changed_at,
                              )}
                            >
                              {row.outcome_display}
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-[13px] tabular-nums text-ink-2">
                        {formatDate(row.applied_at)}
                      </td>
                      <td className="px-4 py-3 text-[13px]">
                        <FollowUp date={row.follow_up_date} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </Refreshing>
      )}

      <ApplicationForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={() => list.reload()}
        choices={choices.data}
      />
    </>
  )
}

function MobileRow({ row }: { row: ApplicationSummary | Application }) {
  return (
    <Link
      to={`/applications/${row.id}`}
      className="glass-panel block rounded-card border border-line bg-surface p-3.5 transition-colors hover:bg-surface-2"
    >
      <div className="flex items-start justify-between gap-3">
        <CompanyMark name={row.company_name} logo={row.company_logo} size={32} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-ink">{row.company_name}</p>
          <p className="mt-0.5 truncate text-[12.5px] text-ink-3">
            {row.role_names.length ? row.role_names.join(', ') : 'No roles linked'}
          </p>
        </div>
        <Icon name="chevronRight" size={16} className="mt-1 text-ink-3" />
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <Badge
          tone={stageTone(row.stage)}
          title={stageHint(row.stage_display, row.stage_updated_at)}
        >
          {row.stage_display}
        </Badge>
        {row.awaiting_response ? (
          <WaitingBadge since={row.awaiting_since} days={row.awaiting_days} />
        ) : null}
        {row.awaiting_response && row.outcome === 'in_progress' ? null : (
          <Badge
            tone={OUTCOME_TONE[row.outcome] ?? 'neutral'}
            title={outcomeHint(row.outcome_display, row.outcome, row.outcome_changed_at)}
          >
            {row.outcome_display}
          </Badge>
        )}
        <DeadlineStat deadline={row.deadline} />
        <span className="ml-auto text-[11.5px] text-ink-3">{formatDate(row.applied_at)}</span>
      </div>
    </Link>
  )
}

function FollowUp({ date }: { date: string | null }) {
  if (!date) return <span className="text-ink-3">—</span>
  const overdue = new Date(`${date}T12:00:00`) < new Date(new Date().toDateString())
  return (
    <span
      className={cx('font-medium', overdue ? 'text-critical' : 'text-ink-2')}
      title={formatDate(date)}
    >
      {relativeDay(date)}
    </span>
  )
}

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-brand-ring bg-brand-soft px-2.5 py-1 text-[12px] font-medium text-brand-strong">
      {label}
      <button type="button" onClick={onClear} aria-label={`Clear ${label} filter`}>
        <Icon name="close" size={13} />
      </button>
    </span>
  )
}
