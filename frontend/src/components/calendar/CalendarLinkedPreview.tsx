import { useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { formatApiError } from '../../api/client'
import { applications, catchups, people } from '../../api/resources'
import type { CalendarEvent } from '../../api/types'
import { useFormDirty } from '../../hooks/useFormDirty'
import { formatDate } from '../../lib/format'
import { CALENDAR_DOMAIN_META } from '../../lib/tones'
import { Button } from '../ui/Button'
import { Input } from '../ui/Field'
import { Avatar } from '../ui/Avatar'
import { CompanyMark } from '../ui/CompanyMark'
import { Icon } from '../ui/Icon'
import { Modal } from '../ui/Modal'
import { useToast } from '../ui/toast-context'

function parseLinkedId(event: CalendarEvent): number {
  const raw = event.id.includes('-') ? event.id.slice(event.id.lastIndexOf('-') + 1) : event.id
  return Number(raw)
}

/** Date field on the underlying record for linked calendar domains. */
function dateFieldFor(domain: CalendarEvent['domain']): string | null {
  switch (domain) {
    case 'application_followup':
      return 'follow_up_date'
    case 'application_reapply':
      return 'reapply_at'
    case 'person_chat':
      return 'next_chat_at'
    case 'catchup_followup':
      return 'follow_up_on'
    case 'catchup':
      return 'met_on'
    default:
      return null
  }
}

/**
 * Lightweight editable preview for calendar items that live on another
 * screen (application follow-ups, catch-ups, etc.).
 */
export function CalendarLinkedPreview({
  event,
  from,
  onClose,
  onSaved,
}: {
  event: CalendarEvent
  from: string
  onClose: () => void
  onSaved: () => void
}) {
  const { notify } = useToast()
  const meta = CALENDAR_DOMAIN_META[event.domain]
  const field = dateFieldFor(event.domain)
  const [date, setDate] = useState(event.date)
  const [saving, setSaving] = useState(false)
  const dirty = useFormDirty({ date })
  const guardedCloseRef = useRef<(() => void) | null>(null)

  async function onSubmit(submit: FormEvent) {
    submit.preventDefault()
    if (!field) return
    setSaving(true)
    try {
      const id = parseLinkedId(event)
      if (event.domain === 'application_followup' || event.domain === 'application_reapply') {
        await applications.update(id, { [field]: date || null })
      } else if (event.domain === 'person_chat') {
        await people.update(id, { [field]: date || null })
      } else if (event.domain === 'catchup_followup' || event.domain === 'catchup') {
        await catchups.update(id, { [field]: date || null })
      }
      notify('Date updated.')
      onSaved()
      onClose()
    } catch (err) {
      notify(formatApiError(err), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      dirty={dirty}
      guardedCloseRef={guardedCloseRef}
      title={event.title}
      description={field ? `${meta.label} · edit the date here, or open the full record.` : meta.label}
      footer={
        <>
          <Button type="button" onClick={() => guardedCloseRef.current?.()}>
            Close
          </Button>
          {event.target_url ? (
            <Link
              to={event.target_url}
              state={{ from }}
              className="inline-flex items-center justify-center rounded-lg border border-line bg-surface px-3 py-1.5 text-[13px] font-medium text-ink transition-colors hover:bg-surface-2"
              onClick={onClose}
            >
              Open full page
            </Link>
          ) : null}
          {field ? (
            <Button type="submit" form="calendar-linked-preview" variant="primary" loading={saving}>
              Save date
            </Button>
          ) : null}
        </>
      }
    >
      <form id="calendar-linked-preview" onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="flex items-center gap-3 rounded-lg border border-line bg-surface-2/60 px-3 py-2.5">
          {event.person ? (
            <Link
              to={`/network/${event.person.id}`}
              state={{ from }}
              onClick={onClose}
              title={`Open ${event.person.full_name}`}
              className="shrink-0 rounded-full transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-brand"
            >
              <Avatar name={event.person.full_name} src={event.person.photo} size="md" />
            </Link>
          ) : event.company ? (
            <Link
              to={`/job-directory/companies/${event.company.id}`}
              state={{ from }}
              onClick={onClose}
              title={`Open ${event.company.name}`}
              className="shrink-0 rounded-xl transition-transform hover:scale-105"
            >
              <CompanyMark name={event.company.name} logo={event.company.logo} size={40} />
            </Link>
          ) : (
            <span className="grid size-10 place-items-center rounded-lg bg-brand-soft text-brand-strong">
              <Icon name={meta.icon} size={17} />
            </span>
          )}
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-ink">{event.title}</p>
            <p className="text-[12px] text-ink-3">
              {meta.label}
              {event.details ? ` · ${event.details}` : ''}
              {' · '}
              {formatDate(event.date)}
            </p>
          </div>
        </div>
        {field ? (
          <Input
            label="Date"
            type="date"
            value={date}
            onChange={(change) => setDate(change.target.value)}
          />
        ) : null}
      </form>
    </Modal>
  )
}
