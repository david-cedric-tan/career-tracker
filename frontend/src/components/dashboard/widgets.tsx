import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import type { Attention, DashboardSummary } from '../../api/types'
import { cx, formatDate, relativeDay } from '../../lib/format'
import { Icon } from '../ui/Icon'

/* Placeholder content — swap for a real source when one exists. */
const QUOTES = [
  ['Rejection is redirection. Log it and move.', 'Careers desk'],
  ['The best time to network was a year ago. The second best is today.', 'Old proverb, adapted'],
  ['You miss 100% of the applications you don’t submit.', 'Also a proverb'],
  ['Momentum beats motivation. Send one more.', 'Anon'],
  ['A follow-up is not a nuisance. Silence is.', 'Every recruiter, quietly'],
  ['Track it or it didn’t happen.', 'This app'],
] as const

// Chosen once when the module loads rather than during render: reading the
// clock mid-render is impure, and a quote that changed on every re-render
// would make the dashboard feel unstable.
const TODAYS_QUOTE = QUOTES[Math.floor(Date.now() / 86_400_000) % QUOTES.length]

export function QuoteWidget() {
  const [text, source] = TODAYS_QUOTE

  return (
    <div className="flex h-full flex-col justify-between gap-3">
      <p className="text-[15px] font-medium leading-snug text-ink">“{text}”</p>
      <p className="text-[12px] text-ink-3">— {source}</p>
    </div>
  )
}

export function CalendarWidget({ attention }: { attention: Attention | null }) {
  const items = useMemo(() => {
    if (!attention) return []
    return [
      ...attention.follow_ups.map((row) => ({
        key: `a${row.id}`,
        label: row.company,
        meta: 'Follow-up',
        date: row.follow_up_date,
        to: `/applications/${row.id}`,
      })),
      ...attention.chats.map((row) => ({
        key: `p${row.id}`,
        label: row.full_name,
        meta: 'Catch-up',
        date: row.next_chat_at,
        to: `/network/${row.id}`,
      })),
      ...attention.tasks.map((row) => ({
        key: `t${row.id}`,
        label: row.title,
        meta: 'Task',
        date: row.due_date,
        to: '/todos',
      })),
    ]
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 5)
  }, [attention])

  if (items.length === 0) {
    return <p className="text-[13px] text-ink-3">Nothing due in the next week.</p>
  }

  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((item) => {
        const overdue =
          new Date(`${item.date}T12:00:00`) < new Date(new Date().toDateString())
        return (
          <li key={item.key}>
            <Link
              to={item.to}
              state={{ from: '/' }}
              className="-mx-1.5 flex items-center gap-2 rounded-lg px-1.5 py-1 transition-colors hover:bg-surface-2"
            >
              <span className="grid w-10 shrink-0 place-items-center rounded-md bg-surface-2 py-0.5 text-[10px] font-semibold uppercase text-ink-3">
                {formatDate(item.date).split(' ').slice(0, 2).join(' ')}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] text-ink">{item.label}</span>
                <span className="block text-[11px] text-ink-3">{item.meta}</span>
              </span>
              <span
                className={cx(
                  'shrink-0 text-[11px] font-medium',
                  overdue ? 'text-critical' : 'text-ink-3',
                )}
              >
                {relativeDay(item.date)}
              </span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

export function PhotoWidget() {
  return (
    <div className="flex h-full flex-col gap-2">
      <div
        className="grid min-h-24 flex-1 place-items-center rounded-lg text-ink-3 ring-1 ring-line"
        style={{
          backgroundImage:
            'linear-gradient(135deg, var(--color-brand-soft), var(--color-surface-2))',
        }}
      >
        <Icon name="file" size={22} />
      </div>
      <p className="text-[11.5px] text-ink-3">
        Placeholder — will pin a photo from an experience gallery.
      </p>
    </div>
  )
}

export function FocusWidget({ summary }: { summary: DashboardSummary | null }) {
  const rows = [
    {
      label: 'Active applications',
      value: summary?.applications.active ?? 0,
      to: '/applications?outcome=in_progress',
    },
    { label: 'Open todos', value: summary?.todos.open ?? 0, to: '/todos' },
    {
      label: 'Chats overdue',
      value: summary?.network.chats_overdue ?? 0,
      to: '/network?due=overdue',
    },
  ]

  return (
    <ul className="flex flex-col gap-1.5">
      {rows.map((row) => (
        <li key={row.label}>
          <Link
            to={row.to}
            state={{ from: '/' }}
            className="-mx-1.5 flex items-baseline gap-2 rounded-lg px-1.5 py-1 transition-colors hover:bg-surface-2"
          >
            <span className="flex-1 text-[12.5px] text-ink-2">{row.label}</span>
            <span className="text-[17px] font-semibold tabular-nums text-ink">
              {row.value}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
