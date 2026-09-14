import { useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { formatApiError } from '../api/client'
import { catchups as catchupsApi, people, todos as todosApi } from '../api/resources'
import { CatchupCard } from './CatchupsPage'
import { CatchupForm } from '../components/CatchupForm'
import { PersonForm } from '../components/PersonForm'
import { TaggedInPanel } from '../components/TaggedInPanel'
import { PageHeader } from '../components/layout/PageHeader'
import { Avatar } from '../components/ui/Avatar'
import { Badge } from '../components/ui/Badge'
import { CompanyChip } from '../components/ui/CompanyChip'
import { ImagePicker } from '../components/ui/ImagePicker'
import { CHANNEL_ICON, MESSAGE_CHANNEL_ICON, PERSON_STATUS_TONE, PRIORITY_TONE } from '../lib/tones'
import { Button } from '../components/ui/Button'
import { Card, CardHeader } from '../components/ui/Card'
import { Input } from '../components/ui/Field'
import { Icon } from '../components/ui/Icon'
import { Modal } from '../components/ui/Modal'
import { ErrorState, Loading } from '../components/ui/States'
import { useToast } from '../components/ui/toast-context'
import { useResource } from '../hooks/useResource'
import { listPath } from '../lib/listState'
import { cx, daysFromToday, formatDate, relativeDay, today } from '../lib/format'
import { RichText } from '../lib/richText'

export function PersonDetailPage() {
  const { id } = useParams()
  const personId = Number(id)
  const navigate = useNavigate()
  const location = useLocation()
  // A link from the dashboard, calendar, or anywhere else that carries a
  // `from` should return there — with whatever view/filters it had — rather
  // than to the network list, which this visit may never have touched.
  const from = (location.state as { from?: string } | null)?.from ?? null
  const { notify } = useToast()

  const [editing, setEditing] = useState(false)
  const [logging, setLogging] = useState(false)
  const [minuting, setMinuting] = useState<import('../api/types').Catchup | null>(null)
  const [minuteOpen, setMinuteOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const choices = useResource(() => people.choices(), [])
  const detail = useResource(() => people.get(personId), [personId])
  const tasks = useResource(() => todosApi.list({ person: personId }), [personId])
  // FR-CATCH-05 — their meeting minutes, on their profile.
  const meetings = useResource(
    () => catchupsApi.list({ person: personId, ordering: '-met_on' }),
    [personId],
  )
  const catchupChoices = useResource(() => catchupsApi.choices(), [])

  if (detail.initial) return <Loading />
  if (!detail.data) {
    return <ErrorState message={detail.error || 'Contact not found.'} onRetry={detail.reload} />
  }

  const person = detail.data
  const overdue = person.next_chat_at ? daysFromToday(person.next_chat_at) < 0 : false

  async function remove() {
    try {
      await people.remove(personId)
      notify('Contact deleted.')
      navigate('/network', { replace: true })
    } catch (err) {
      notify(formatApiError(err), 'error')
    }
  }

  return (
    <>
      <Link
        to={from ?? listPath('network')}
        className="mb-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-3 transition-colors hover:text-ink"
      >
        <Icon name="chevronLeft" size={15} />
        {from ? 'Back' : 'Network'}
      </Link>

      <PageHeader
        title={person.full_name}
        subtitle={
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge tone={PERSON_STATUS_TONE[person.status] ?? 'neutral'}>
              {person.status_display}
            </Badge>
            <span className="text-ink-3">
              {person.title ? `${person.title} · ` : ''}
              {person.relationship_display}
            </span>
          </span>
        }
        action={
          <>
            <Button
              variant="primary"
              onClick={() => {
                setMinuting(null)
                setMinuteOpen(true)
              }}
              icon={<Icon name="plus" size={15} />}
            >
              Add minutes
            </Button>
            <Button onClick={() => setLogging(true)} icon={<Icon name="calendar" size={15} />}>
              Log a catch-up
            </Button>
            <Button onClick={() => setEditing(true)} icon={<Icon name="edit" size={15} />}>
              Edit
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card>
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
              <ImagePicker
                className="sm:w-60 sm:shrink-0"
                name={person.full_name}
                src={person.photo}
                size="lg"
                label="photo"
                onUpload={async (file) => {
                  detail.setData(await people.uploadPhoto(person.id, file))
                  notify('Photo updated.')
                }}
                onRemove={async () => {
                  detail.setData(await people.removePhoto(person.id))
                  notify('Photo removed.')
                }}
              />
              <dl className="grid flex-1 gap-x-6 gap-y-3 sm:grid-cols-2">
                <Detail label="Met via" value={person.source_display || '—'} />
                <Detail
                  label="Companies"
                  value={
                    person.company_details.length ? (
                      <span className="flex flex-wrap gap-1.5">
                        {person.company_details.map((company) => (
                          <CompanyChip
                            key={company.id}
                            size="sm"
                            label={company.name}
                            fullName={
                              company.is_past
                                ? `${company.full_name} · past`
                                : company.full_name
                            }
                            logo={company.logo}
                            companyId={company.id}
                            className={cx(company.is_past && 'opacity-60')}
                          />
                        ))}
                      </span>
                    ) : (
                      '—'
                    )
                  }
                />
                <Detail label="Last met" value={formatDate(person.last_meeting_at)} />
                <Detail
                  label="Last messaged"
                  value={
                    person.last_messaged_at ? (
                      <span className="inline-flex flex-wrap items-center gap-1.5">
                        {formatDate(person.last_messaged_at)}
                        {person.last_message_channel ? (
                          <Badge>
                            <Icon
                              name={MESSAGE_CHANNEL_ICON[person.last_message_channel] ?? 'mail'}
                              size={11}
                            />
                            {person.last_message_channel_display}
                          </Badge>
                        ) : null}
                      </span>
                    ) : (
                      '—'
                    )
                  }
                />
                <Detail
                  label="Next chat"
                  value={
                    person.next_chat_at ? (
                      <span className={cx(overdue && 'font-medium text-critical')}>
                        {formatDate(person.next_chat_at)} · {relativeDay(person.next_chat_at)}
                      </span>
                    ) : (
                      'Not scheduled'
                    )
                  }
                />
              </dl>
            </div>

            {person.notes ? (
              <div className="mt-4 rounded-lg border border-line bg-surface-2 p-3">
                <p className="mb-1 text-[12px] font-medium uppercase tracking-wide text-ink-3">
                  Profile notes
                </p>
                <RichText text={person.notes} className="text-[13.5px] text-ink-2" />
              </div>
            ) : null}
          </Card>

          <Card>
            <CardHeader
              title="Connected To"
              subtitle="Who else in your network knows them."
            />
            {person.connection_details.length === 0 ? (
              <p className="mt-3 text-[13px] text-ink-3">
                No one linked yet — add connections when editing this contact.
              </p>
            ) : (
              /* Tiles rather than rows: this is a "who else do I know here"
                 glance, and faces scan far faster in a grid than stacked in a
                 list that pushes everything below it down the page. */
              <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {person.connection_details.map((connection) => {
                  const role = connection.title || connection.relationship_display || 'Contact'
                  const company = connection.company_names.join(', ')
                  return (
                    <li key={connection.id}>
                      <Link
                        to={`/network/${connection.id}`}
                        state={{ from: `${location.pathname}${location.search}` }}
                        // The tile truncates; the tooltip is where the full
                        // role and company live.
                        title={`${connection.full_name}\n${role}${company ? `\n${company}` : ''}`}
                        className="flex h-full flex-col items-center gap-1.5 rounded-lg border border-line bg-surface-2 p-2.5 text-center transition-all hover:-translate-y-0.5 hover:border-brand-ring hover:bg-brand-soft hover:shadow-md"
                      >
                        <Avatar name={connection.full_name} src={connection.photo} size="md" />
                        <span className="w-full truncate text-[12.5px] font-medium text-ink">
                          {connection.full_name}
                        </span>
                        <span className="w-full truncate text-[11px] text-ink-3">{role}</span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="How To Reach Them" />
            {person.contact_methods.length === 0 ? (
              <p className="mt-3 text-[13px] text-ink-3">No channels recorded yet.</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-2">
                {person.contact_methods.map((contact, index) => (
                  <li
                    key={contact.id ?? index}
                    className="flex items-center gap-3 rounded-lg border border-line bg-surface-2 px-3 py-2"
                  >
                    <Icon name={CHANNEL_ICON[contact.channel] ?? 'link'} size={16} className="text-ink-3" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[11.5px] uppercase tracking-wide text-ink-3">
                        {contact.channel_display ?? contact.channel}
                      </p>
                      {contact.value.startsWith('http') ? (
                        <a
                          href={contact.value}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="block truncate text-[13.5px] text-brand hover:underline"
                        >
                          {contact.value}
                        </a>
                      ) : (
                        <p className="truncate text-[13.5px] text-ink">{contact.value}</p>
                      )}
                    </div>
                    {contact.is_preferred ? <Badge tone="brand">Preferred</Badge> : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Catch-ups"
              subtitle={
                meetings.data?.length
                  ? `${meetings.data.length} minuted ${meetings.data.length === 1 ? 'meeting' : 'meetings'}`
                  : 'Minutes from your meetings with them'
              }
              action={
                <Link
                  to={`/catchups?person=${person.id}`}
                  className="text-[12.5px] font-medium text-brand hover:underline"
                >
                  All Catch-Ups
                </Link>
              }
            />
            {meetings.initial ? (
              <Loading />
            ) : !meetings.data?.length ? (
              <p className="mt-3 text-[13px] text-ink-3">
                No minutes yet — add some after your next chat.
              </p>
            ) : (
              <ul className="mt-3 flex flex-col gap-3">
                {meetings.data.map((meeting) => (
                  <li key={meeting.id}>
                    <CatchupCard
                      catchup={meeting}
                      showPerson={false}
                      onEdit={() => {
                        setMinuting(meeting)
                        setMinuteOpen(true)
                      }}
                    />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Linked Applications" />
            {!person.application_labels?.length ? (
              <p className="mt-3 text-[13px] text-ink-3">Not tied to an application yet.</p>
            ) : (
              <ul className="mt-2 divide-y divide-line">
                {person.application_labels.map((entry) => (
                  <li key={entry.id}>
                    <Link
                      to={`/applications/${entry.id}`}
                      className="-mx-2 flex items-center gap-2 rounded-lg px-2 py-2 text-[13.5px] text-ink transition-colors hover:bg-surface-2"
                    >
                      <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                      <Icon name="chevronRight" size={15} className="text-ink-3" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Tasks"
              action={
                <Link to="/todos" className="text-[12.5px] font-medium text-brand hover:underline">
                  All Todos
                </Link>
              }
            />
            {!tasks.data?.length ? (
              <p className="mt-3 text-[13px] text-ink-3">No tasks for this contact.</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-1.5">
                {tasks.data.map((todo) => (
                  <li key={todo.id} className="flex items-start gap-2">
                    <Icon
                      name={todo.status === 'done' ? 'check' : 'clock'}
                      size={15}
                      className={cx(
                        'mt-0.5',
                        todo.status === 'done'
                          ? 'text-good'
                          : todo.is_overdue
                            ? 'text-critical'
                            : 'text-ink-3',
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span
                        className={cx(
                          'block text-[13px]',
                          todo.status === 'done' ? 'text-ink-3 line-through' : 'text-ink',
                        )}
                      >
                        {todo.title}
                      </span>
                      {todo.due_date ? (
                        <span className="block text-[11.5px] text-ink-3">
                          {relativeDay(todo.due_date)}
                        </span>
                      ) : null}
                    </span>
                    <Badge tone={PRIORITY_TONE[todo.priority] ?? 'neutral'}>
                      {todo.priority_display}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <TaggedInPanel tag={person.full_name.replace(/\s+/g, '')} />

          <Card>
            <CardHeader title="Danger Zone" />
            <Button
              variant="danger"
              className="mt-3 w-full"
              onClick={() => setConfirmDelete(true)}
              icon={<Icon name="trash" size={15} />}
            >
              Delete contact
            </Button>
          </Card>
        </div>
      </div>

      <PersonForm
        open={editing}
        existing={person}
        choices={choices.data}
        onClose={() => setEditing(false)}
        onSaved={(saved) => detail.setData(saved)}
      />

      <CatchupForm
        open={minuteOpen}
        existing={minuting}
        personId={person.id}
        choices={catchupChoices.data}
        onClose={() => setMinuteOpen(false)}
        onSaved={() => {
          meetings.reload()
          detail.reload()
        }}
        onDeleted={() => {
          meetings.reload()
          detail.reload()
        }}
      />

      <LogMeetingDialog
        open={logging}
        personId={person.id}
        onClose={() => setLogging(false)}
        onSaved={(saved) => {
          detail.setData(saved)
          notify('Catch-up logged — next chat moved forward three months.')
        }}
      />

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this contact?"
        description="Their contact channels and task links go with them."
        footer={
          <>
            <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button variant="danger" onClick={() => void remove()}>
              Delete
            </Button>
          </>
        }
      >
        <p className="text-[13.5px] text-ink-2">
          You’re about to remove <strong>{person.full_name}</strong> from your network.
        </p>
      </Modal>
    </>
  )
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11.5px] font-medium uppercase tracking-wide text-ink-3">{label}</dt>
      <dd className="mt-0.5 text-[13.5px] text-ink">{value}</dd>
    </div>
  )
}

function LogMeetingDialog({
  open,
  personId,
  onClose,
  onSaved,
}: {
  open: boolean
  personId: number
  onClose: () => void
  onSaved: (person: import('../api/types').Person) => void
}) {
  const { notify } = useToast()
  const [metOn, setMetOn] = useState(today())
  const [nextChat, setNextChat] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit() {
    setSaving(true)
    try {
      const saved = await people.logMeeting(personId, {
        met_on: metOn,
        next_chat_at: nextChat || undefined,
      })
      onSaved(saved)
      setNextChat('')
      onClose()
    } catch (err) {
      notify(formatApiError(err), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Log a catch-up"
      description="Leave the next chat blank and it defaults to three months out."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={saving} onClick={() => void submit()}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Input
          label="We met on"
          type="date"
          value={metOn}
          onChange={(event) => setMetOn(event.target.value)}
        />
        <Input
          label="Next chat"
          type="date"
          value={nextChat}
          onChange={(event) => setNextChat(event.target.value)}
          help="Optional — an explicit date is kept as-is."
        />
      </div>
    </Modal>
  )
}
