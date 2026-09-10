import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { dashboard } from '../api/resources'
import type { ActivityItem } from '../api/types'
import type { Series } from '../components/charts/TrendChart'
import { BarList, type BarSegment } from '../components/charts/BarList'
import { OUTCOME_TONE, TONE_COLOR, stageTone } from '../lib/tones'
import { CompanyPanel } from '../components/dashboard/CompanyPanel'
import { WidgetBoard } from '../components/dashboard/WidgetBoard'
import { StatTile } from '../components/charts/StatTile'
import { TrendChart, TrendTable } from '../components/charts/TrendChart'
import { PageHeader } from '../components/layout/PageHeader'
import { Card, CardHeader } from '../components/ui/Card'
import { ClockWeather } from '../components/ui/ClockWeather'
import { Icon } from '../components/ui/Icon'
import { EmptyState, ErrorState, Loading, Refreshing } from '../components/ui/States'
import { useAuth } from '../auth/context'
import { useResource } from '../hooks/useResource'
import { cx, displayName, formatDate, relativeDay, relativeTime } from '../lib/format'

const PERIODS = [
  // "All" is the default: the dashboard's job on open is "how is this going",
  // which is a question about everything, not the last twelve months.
  { value: 'all', label: 'All' },
  { value: 'month', label: 'Monthly' },
  { value: 'quarter', label: 'Quarterly' },
] as const

type Period = (typeof PERIODS)[number]['value']

export function DashboardPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [period, setPeriod] = useState<Period>('all')
  const [showTable, setShowTable] = useState(false)

  // Pipeline/Outcomes bars reuse Applications' own filter params, so a click
  // on either just deep-links there with a stateful way back to this page.
  function goToApplications(
    param: 'stage' | 'outcome',
    value: string,
    segment: BarSegment = 'all',
  ) {
    const params = new URLSearchParams({ [param]: value })
    // Clicking a coloured slice filters to what that slice represents, so the
    // list you land on is the applications you just pointed at.
    if (segment === 'rejected') params.set('outcome', 'rejected')
    if (segment === 'awaiting') params.set('awaiting', '1')
    navigate(`/applications?${params}`, { state: { from: '/' } })
  }

  // Every applications-derived widget reads the same window, so the counters,
  // the chart and the company panel can't end up describing different spans.
  const summary = useResource(() => dashboard.summary({ period }), [period])
  const trend = useResource(
    () => dashboard.timeseries({ period, buckets: period === 'quarter' ? 8 : 12 }),
    [period],
  )
  const attention = useResource(() => dashboard.attention(), [])
  const activity = useResource(() => dashboard.activity({ limit: 12 }), [])
  const companyStats = useResource(() => dashboard.companies({ period }), [period])
  const regionStats = useResource(() => dashboard.regions(), [])

  if (summary.initial) return <Loading label="Building your dashboard…" />
  if (summary.error && !summary.data) {
    return <ErrorState message={summary.error} onRetry={summary.reload} />
  }

  const stats = summary.data
  const series: Series[] = [
    {
      key: 'applications',
      label: 'Applications sent',
      color: 'var(--series-1)',
      values: trend.data?.buckets.map((bucket) => bucket.applications) ?? [],
    },
    {
      key: 'advances',
      label: 'Stage advances',
      color: 'var(--series-2)',
      values: trend.data?.buckets.map((bucket) => bucket.stage_advances) ?? [],
    },
    {
      key: 'todos',
      label: 'Todos completed',
      color: 'var(--series-3)',
      values: trend.data?.buckets.map((bucket) => bucket.todos_completed) ?? [],
    },
  ]
  const trendLabels = trend.data?.buckets.map((bucket) => bucket.start) ?? []

  return (
    <>
      {/* Ordinary in-flow content, same as every other page's header — it
          scrolls away with the rest of the page rather than staying pinned. */}
      <PageHeader
        title={`Hi, ${displayName(user)}`}
        subtitle="Where your search stands today."
        action={
          <div className="hidden lg:block">
            <ClockWeather />
          </div>
        }
      />

      {/* One filter row, above everything it scopes. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-line bg-surface p-0.5">
          {PERIODS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setPeriod(option.value)}
              aria-pressed={period === option.value}
              className={cx(
                'rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors',
                period === option.value
                  ? 'bg-brand-soft text-brand-strong'
                  : 'text-ink-2 hover:text-ink',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Active Applications"
          value={stats?.applications.active ?? 0}
          hint={`${stats?.applications.total ?? 0} logged in total`}
          icon="briefcase"
          to="/applications?outcome=in_progress"
        />
        <StatTile
          label="Offers"
          value={stats?.applications.offers ?? 0}
          hint={`${stats?.applications.rejected ?? 0} rejected`}
          icon="check"
          tone="good"
          to="/applications?outcome=offer_received"
        />
        <StatTile
          label="Todos Overdue"
          value={stats?.todos.overdue ?? 0}
          hint={`${stats?.todos.due_this_week ?? 0} due this week`}
          icon="clock"
          tone={stats?.todos.overdue ? 'critical' : 'default'}
          to="/todos?scope=overdue"
        />
        <StatTile
          label="Chats Overdue"
          value={stats?.network.chats_overdue ?? 0}
          hint={`${stats?.network.total ?? 0} people tracked`}
          icon="users"
          tone={stats?.network.chats_overdue ? 'warning' : 'default'}
          to="/network?due=overdue"
        />
      </div>

      {/* Every panel below is a board widget — movable, resizable and
          hideable — rather than a fixed section. The page still owns their
          data and local state (period, chart-vs-table); the board only
          decides where each one sits and how wide it runs. */}
      <WidgetBoard
        summary={stats}
        attention={attention.data}
        regions={regionStats.data ?? []}
        panels={{
          trend: (
            <Card className="h-full">
              <CardHeader
                title="Progress Over Time"
                subtitle={
                  period === 'all'
                    ? 'Everything you\u2019ve logged'
                    : period === 'month'
                      ? 'Last 12 months'
                      : 'Last 8 quarters'
                }
                action={
                  <button
                    type="button"
                    onClick={() => setShowTable((current) => !current)}
                    aria-label={showTable ? 'Show chart' : 'Show table'}
                    title={showTable ? 'Show chart' : 'Show table'}
                    className="rounded-lg border border-line bg-surface p-2 text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
                  >
                    <Icon name={showTable ? 'barChart' : 'table'} size={15} />
                  </button>
                }
              />
              <div className="mt-4">
                <Refreshing active={trend.loading && !trend.initial}>
                  {trend.initial ? (
                    <div className="h-[248px]" />
                  ) : showTable ? (
                    <TrendTable labels={trendLabels} series={series} />
                  ) : (
                    <TrendChart labels={trendLabels} series={series} valueLabel={period} />
                  )}
                </Refreshing>
              </div>

              <div className="mt-5 border-t border-line pt-4">
                <CardHeader
                  title="Companies"
                  subtitle="Every company you've applied to, biggest first"
                />
                <div className="mt-3">
                  {companyStats.initial ? (
                    <Loading />
                  ) : (
                    <CompanyPanel companies={companyStats.data ?? []} />
                  )}
                </div>
              </div>
            </Card>
          ),

          pipeline: (
            <Card className="h-full">
              <CardHeader
                title="Pipeline & outcomes"
                subtitle="Where applications are now, and how the finished ones landed"
              />
              {/* The legend shows the marks themselves rather than describing
                  them: matching a swatch to a bar is a glance, reading a
                  sentence and then looking for what it meant is not. */}
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className="text-[11.5px] font-medium uppercase tracking-wide text-ink-3">
                  By stage
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-warning/30 bg-warning/15 px-2 py-0.5 text-[11px] font-medium text-[#8a5d00] dark:text-warning">
                  <span className="size-2 shrink-0 rounded-sm bg-warning" aria-hidden="true" />
                  Waiting on them
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-critical/25 bg-critical/10 px-2 py-0.5 text-[11px] font-medium text-critical">
                  <span className="bar-rejected size-2 shrink-0 rounded-sm" aria-hidden="true" />
                  Rejected
                </span>
              </div>
              <div className="mt-3">
                <BarList
                  rows={
                    stats?.applications.by_stage.map((bucket) => ({
                      key: bucket.value,
                      label: bucket.label,
                      count: bucket.count,
                      rejected: bucket.rejected,
                      awaiting: bucket.awaiting,
                      // Offer is green here for the same reason its badge is:
                      // the ramp says "how far along", but reaching an offer
                      // is a different kind of fact from being one step later.
                      color: TONE_COLOR[stageTone(bucket.value)],
                    })) ?? []
                  }
                  emptyText="No applications logged yet."
                  onSelect={(row, segment) => goToApplications('stage', row.key, segment)}
                />
              </div>

              <p className="mt-5 border-t border-line pt-4 text-[11.5px] font-medium uppercase tracking-wide text-ink-3">
                By outcome
              </p>
              <div className="mt-3">
                <BarList
                  rows={
                    stats?.applications.by_outcome
                      .filter((bucket) => bucket.count > 0)
                      .map((bucket) => ({
                        key: bucket.value,
                        label: bucket.label,
                        count: bucket.count,
                        color: TONE_COLOR[OUTCOME_TONE[bucket.value] ?? 'neutral'],
                      })) ?? []
                  }
                  emptyText="No outcomes recorded yet."
                  onSelect={(row) => goToApplications('outcome', row.key)}
                />
              </div>
            </Card>
          ),

          attention: (
            <Card className="h-full">
              <CardHeader title="Needs Attention" subtitle="Due now or within the next 7 days" />
              <AttentionLists
                data={attention.data}
                loading={attention.initial}
                error={attention.error}
                onRetry={attention.reload}
              />
            </Card>
          ),

          activity: (
            <Card className="h-full">
              <CardHeader title="Recent Activity" subtitle="Across every domain" />
              <div className="mt-2">
                {activity.initial ? (
                  <Loading />
                ) : activity.data && activity.data.length > 0 ? (
                  <ul className="divide-y divide-line">
                    {activity.data.map((item, index) => (
                      <li key={`${item.domain}-${item.target_id}-${index}`}>
                        <Link
                          to={item.target_url}
                          state={{ from: '/' }}
                          className="-mx-2 flex items-start gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-surface-2"
                        >
                          <span
                            className={cx(
                              'mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg',
                              activityStyle(item).className,
                            )}
                          >
                            <Icon name={activityStyle(item).icon} size={14} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-[13px] text-ink">{item.summary}</span>
                            {item.note ? (
                              <span className="block truncate text-[12px] text-ink-3">
                                {item.note}
                              </span>
                            ) : null}
                          </span>
                          <span className="shrink-0 text-[11.5px] text-ink-3">
                            {relativeTime(item.occurred_at)}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState
                    icon="sparkles"
                    title="Nothing here yet"
                    description="Log your first application and the feed will fill in."
                  />
                )}
              </div>
            </Card>
          ),
        }}
      />

    </>
  )
}

/** Icon and tone per activity row — an edit shouldn't look like a stage move. */
function activityStyle(item: ActivityItem): { icon: string; className: string } {
  if (item.domain === 'todo') {
    return { icon: 'check', className: 'bg-good/10 text-good' }
  }
  if (item.domain === 'network') {
    return { icon: 'users', className: 'bg-surface-2 text-ink-2' }
  }
  if (item.domain === 'catchup') {
    return { icon: 'coffee', className: 'bg-brand-soft text-brand-strong' }
  }
  switch (item.event_type) {
    case 'stage':
      return { icon: 'arrowRight', className: 'bg-brand-soft text-brand-strong' }
    case 'outcome':
      return { icon: 'check', className: 'bg-brand-soft text-brand-strong' }
    case 'edited':
      return { icon: 'edit', className: 'bg-surface-2 text-ink-2' }
    default:
      return { icon: 'briefcase', className: 'bg-brand-soft text-brand-strong' }
  }
}

function AttentionLists({
  data,
  loading,
  error,
  onRetry,
}: {
  data: import('../api/types').Attention | null
  loading: boolean
  error: string
  onRetry: () => void
}) {
  if (loading) return <Loading />
  if (error && !data) return <ErrorState message={error} onRetry={onRetry} />

  const empty =
    !data ||
    (data.follow_ups.length === 0 &&
      data.chats.length === 0 &&
      data.tasks.length === 0 &&
      data.reapplies.length === 0)

  if (empty) {
    return (
      <EmptyState
        icon="check"
        title="You’re all caught up"
        description="No follow-ups, catch-ups, tasks or reapply reminders are due in the next week."
      />
    )
  }

  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <AttentionColumn title="Follow-ups" icon="briefcase" empty="None due">
        {data.follow_ups.map((item) => (
          <AttentionRow
            key={item.id}
            to={`/applications/${item.id}`}
            title={item.company}
            meta={item.stage}
            date={item.follow_up_date}
          />
        ))}
      </AttentionColumn>

      <AttentionColumn title="Catch-ups" icon="users" empty="None due">
        {data.chats.map((item) => (
          <AttentionRow
            key={item.id}
            to={`/network/${item.id}`}
            title={item.full_name}
            meta={item.status}
            date={item.next_chat_at}
          />
        ))}
      </AttentionColumn>

      <AttentionColumn title="Tasks" icon="checklist" empty="None due">
        {data.tasks.map((item) => (
          <AttentionRow
            key={item.id}
            to="/todos"
            title={item.title}
            meta={item.priority}
            date={item.due_date}
          />
        ))}
      </AttentionColumn>

      <AttentionColumn title="Reapply" icon="calendar" empty="None due">
        {data.reapplies.map((item) => (
          <AttentionRow
            key={item.id}
            to={`/applications/${item.id}`}
            title={item.company}
            meta={item.outcome}
            date={item.reapply_at}
          />
        ))}
      </AttentionColumn>
    </div>
  )
}

function AttentionColumn({
  title,
  icon,
  empty,
  children,
}: {
  title: string
  icon: string
  empty: string
  children: React.ReactNode
}) {
  const items = Array.isArray(children) ? children : [children]
  const isEmpty = items.flat().filter(Boolean).length === 0

  return (
    <div className="rounded-lg border border-line bg-surface-2/50 p-3">
      <p className="mb-2.5 flex items-center gap-1.5 border-b border-line pb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-3">
        <Icon name={icon} size={13} />
        {title}
      </p>
      {isEmpty ? (
        <p className="text-[13px] text-ink-3">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-2">{children}</ul>
      )}
    </div>
  )
}

function AttentionRow({
  to,
  title,
  meta,
  date,
}: {
  to: string
  title: string
  meta: string
  date: string
}) {
  const overdue = new Date(`${date}T12:00:00`) < new Date(new Date().toDateString())

  return (
    <li>
      <Link
        to={to}
        state={{ from: '/' }}
        className="-mx-2 flex flex-col gap-1 rounded-lg px-2 py-2 transition-colors hover:bg-surface"
      >
        {/* `justify-between` guarantees a clear gap regardless of how long
            either side runs — a fixed `gap-*` alone let a long title crowd
            straight into "Yesterday"/"Today" with nothing between them. */}
        <span className="flex items-baseline justify-between gap-3">
          <span className="min-w-0 truncate text-[13px] font-medium text-ink">{title}</span>
          <span
            className={cx(
              'shrink-0 text-[11.5px] font-medium',
              overdue ? 'text-critical' : 'text-ink-3',
            )}
            title={formatDate(date)}
          >
            {relativeDay(date)}
          </span>
        </span>
        <span className="truncate text-[11.5px] capitalize text-ink-3">{meta}</span>
      </Link>
    </li>
  )
}
