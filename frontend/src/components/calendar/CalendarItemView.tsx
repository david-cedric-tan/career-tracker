import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { CalendarEventRecord, Todo } from '../../api/types'
import { formatDate, formatTime, relativeDay } from '../../lib/format'
import { RichText } from '../../lib/richText'
import { CALENDAR_DOMAIN_META, PRIORITY_TONE } from '../../lib/tones'
import { Avatar } from '../ui/Avatar'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { CompanyMark } from '../ui/CompanyMark'
import { Icon } from '../ui/Icon'
import { Modal } from '../ui/Modal'

export type CalendarItem =
  | { kind: 'event'; record: CalendarEventRecord }
  | { kind: 'todo'; record: Todo }

/**
 * Read-first popup for a calendar entry — what it is, when, who and what it's
 * tied to, and the notes — with editing one click away rather than landing
 * you straight in the form. Clicking a chip is usually "what was this again?",
 * not "change this".
 */
export function CalendarItemView({
  item,
  from,
  onClose,
  onEdit,
}: {
  item: CalendarItem
  from: string
  onClose: () => void
  onEdit: () => void
}) {
  const meta = CALENDAR_DOMAIN_META[item.kind === 'event' ? 'custom' : 'todo']
  const title = item.record.title
  const date = item.kind === 'event' ? item.record.date : item.record.due_date
  const done = item.kind === 'event' ? item.record.is_done : item.record.status === 'done'

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={title}
      footer={
        <>
          <Button type="button" onClick={onClose}>
            Close
          </Button>
          <Button variant="primary" onClick={onEdit} icon={<Icon name="edit" size={14} />}>
            Edit
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3 rounded-xl border border-line bg-surface-2/60 p-3">
          <DateTile date={date} icon={meta.icon} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone={meta.tone}>{meta.label}</Badge>
              {item.kind === 'todo' ? (
                <>
                  <Badge tone={PRIORITY_TONE[item.record.priority] ?? 'neutral'}>
                    {item.record.priority_display}
                  </Badge>
                  <Badge tone={done ? 'good' : item.record.is_overdue ? 'critical' : 'neutral'}>
                    {item.record.status_display}
                  </Badge>
                </>
              ) : done ? (
                <Badge tone="good">Done</Badge>
              ) : null}
            </div>
            <p className="mt-2 text-[13.5px] text-ink">
              {date ? (
                <>
                  {formatDate(date)}
                  <span className="text-ink-3"> · {relativeDay(date)}</span>
                </>
              ) : (
                <span className="text-ink-3">No date</span>
              )}
            </p>
            {item.kind === 'event' ? (
              <p className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-ink-2">
                <Icon name="clock" size={13} className="text-ink-3" />
                {item.record.all_day
                  ? 'All day'
                  : `${item.record.start_time ? formatTime(item.record.start_time) : ''}${
                      item.record.end_time ? ` – ${formatTime(item.record.end_time)}` : ''
                    }`}
              </p>
            ) : null}
          </div>
        </div>

        <LinkedRows item={item} from={from} />

        {item.kind === 'event' && item.record.reminders.length ? (
          <Section title="Reminders">
            <ul className="flex flex-wrap gap-1.5">
              {item.record.reminders.map((reminder) => (
                <Badge key={reminder.id}>
                  <Icon name="bell" size={11} />
                  {reminderLabel(reminder.minutes_before)} before
                </Badge>
              ))}
            </ul>
          </Section>
        ) : null}

        {(item.kind === 'event' ? item.record.notes : item.record.description).trim() ? (
          <Section title={item.kind === 'event' ? 'Notes' : 'Description'}>
            <RichText
              text={item.kind === 'event' ? item.record.notes : item.record.description}
              className="rounded-lg border border-line bg-surface-2 p-3 text-[13px] leading-relaxed text-ink-2"
            />
          </Section>
        ) : null}
      </div>
    </Modal>
  )
}

function DateTile({ date, icon }: { date: string | null; icon: string }) {
  if (!date) {
    return (
      <span className="grid size-14 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-strong">
        <Icon name={icon} size={22} />
      </span>
    )
  }
  const parsed = new Date(`${date}T00:00:00`)
  return (
    <span className="flex size-14 shrink-0 flex-col items-center justify-center rounded-xl border border-brand-ring bg-brand-soft text-brand-strong">
      <span className="text-[10px] font-semibold uppercase leading-none tracking-wide">
        {parsed.toLocaleDateString(undefined, { month: 'short' })}
      </span>
      <span className="mt-0.5 text-[22px] font-semibold leading-none">{parsed.getDate()}</span>
    </span>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-3">{title}</p>
      {children}
    </div>
  )
}

/** Application, people and company — each with its mark, each a link. */
function LinkedRows({ item, from }: { item: CalendarItem; from: string }) {
  const rows: ReactNode[] = []
  const record = item.record

  if (record.application) {
    rows.push(
      <LinkedRow
        key="application"
        to={`/applications/${record.application}`}
        from={from}
        mark={
          <CompanyMark
            name={record.application_label ?? 'Application'}
            logo={record.application_logo}
            size={32}
            className="rounded-lg shadow-none"
          />
        }
        label={record.application_label ?? `Application #${record.application}`}
        kind="Application"
      />,
    )
  }

  if (item.kind === 'todo' && item.record.person) {
    rows.push(
      <LinkedRow
        key="person"
        to={`/network/${item.record.person}`}
        from={from}
        mark={<Avatar name={item.record.person_name ?? 'Contact'} src={item.record.person_photo} size="sm" />}
        label={item.record.person_name ?? 'Contact'}
        kind="Person"
      />,
    )
  }
  if (item.kind === 'event') {
    for (const person of item.record.people_details) {
      rows.push(
        <LinkedRow
          key={`person-${person.id}`}
          to={`/network/${person.id}`}
          from={from}
          mark={<Avatar name={person.full_name} src={person.photo} size="sm" />}
          label={person.full_name}
          kind={person.relationship_display || 'Person'}
        />,
      )
    }
  }

  if (record.company) {
    rows.push(
      <LinkedRow
        key="company"
        to={`/job-directory/companies/${record.company}`}
        from={from}
        mark={
          <CompanyMark
            name={record.company_name ?? 'Company'}
            logo={record.company_logo}
            size={32}
            className="rounded-lg shadow-none"
          />
        }
        label={record.company_name ?? 'Company'}
        kind="Company"
      />,
    )
  }

  if (!rows.length) return null
  return (
    <Section title="Linked to">
      <ul className="grid gap-1.5 sm:grid-cols-2">{rows}</ul>
    </Section>
  )
}

function LinkedRow({
  to,
  from,
  mark,
  label,
  kind,
}: {
  to: string
  from: string
  mark: ReactNode
  label: string
  kind: string
}) {
  return (
    <li>
      <Link
        to={to}
        state={{ from }}
        className="flex items-center gap-2.5 rounded-lg border border-line bg-surface px-2.5 py-2 transition-colors hover:border-brand-ring hover:bg-brand-soft"
      >
        {mark}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-ink">{label}</span>
          <span className="block text-[11px] text-ink-3">{kind}</span>
        </span>
        <Icon name="chevronRight" size={14} className="shrink-0 text-ink-3" />
      </Link>
    </li>
  )
}

function reminderLabel(minutes: number): string {
  if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes === 1440 ? '' : 's'}`
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? '' : 's'}`
  return `${minutes} min`
}
