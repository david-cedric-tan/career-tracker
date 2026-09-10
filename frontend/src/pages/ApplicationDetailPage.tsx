import { useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { formatApiError } from '../api/client'
import {
  applicationStages,
  applications,
  calendarEvents,
  people as peopleApi,
  todos as todosApi,
} from '../api/resources'
import type { Application, ApplicationStage } from '../api/types'
import { ApplicationForm } from '../components/ApplicationForm'
import { useCelebrate } from '../celebrate/context'
import { movedForward } from '../lib/pipeline'
import { ApplicationHistory } from '../components/ApplicationHistory'
import { PageHeader } from '../components/layout/PageHeader'
import { Badge } from '../components/ui/Badge'
import { OUTCOME_TONE, PRIORITY_TONE, stageTone } from '../lib/tones'
import { Button } from '../components/ui/Button'
import { Card, CardHeader } from '../components/ui/Card'
import { Combobox } from '../components/ui/Combobox'
import { MentionInput } from '../components/ui/Mention'
import { Input, Select } from '../components/ui/Field'
import { Icon } from '../components/ui/Icon'
import { Modal } from '../components/ui/Modal'
import { ErrorState, Loading } from '../components/ui/States'
import { useToast } from '../components/ui/toast-context'
import { useResource } from '../hooks/useResource'
import { listPath } from '../lib/listState'
import { cx, formatDate, formatDateTime, relativeDay, today } from '../lib/format'
import { RichText } from '../lib/richText'

export function ApplicationDetailPage() {
  const { id } = useParams()
  const applicationId = Number(id)
  const navigate = useNavigate()
  const location = useLocation()
  // A link from the dashboard, calendar, or anywhere else that carries a
  // `from` should return there — with whatever view/filters it had — rather
  // than to the applications list, which this visit may never have touched.
  const from = (location.state as { from?: string } | null)?.from ?? null
  const { notify } = useToast()

  const [editing, setEditing] = useState(false)
  const [advancing, setAdvancing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const choices = useResource(() => applications.choices(), [])
  const detail = useResource(() => applications.get(applicationId), [applicationId])
  // FR-X-01 — from an application, see the people and tasks attached to it.
  const related = useResource(
    () =>
      Promise.all([
        peopleApi.list({ application: applicationId }),
        todosApi.list({ application: applicationId }),
      ]),
    [applicationId],
  )

  if (detail.initial) return <Loading />
  if (!detail.data) {
    return <ErrorState message={detail.error || 'Application not found.'} onRetry={detail.reload} />
  }

  const application = detail.data
  const [relatedPeople, relatedTodos] = related.data ?? [[], []]

  async function remove() {
    try {
      await applications.remove(applicationId)
      notify('Application deleted.')
      navigate('/applications', { replace: true })
    } catch (err) {
      notify(formatApiError(err), 'error')
    }
  }

  return (
    <>
      <Link
        to={from ?? listPath('applications')}
        className="mb-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-3 transition-colors hover:text-ink"
      >
        <Icon name="chevronLeft" size={15} />
        {from ? 'Back' : 'All applications'}
      </Link>

      <PageHeader
        title={application.company_name}
        subtitle={
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge tone={stageTone(application.stage)}>
              {application.stage_display}
            </Badge>
            <Badge tone={OUTCOME_TONE[application.outcome] ?? 'neutral'}>
              {application.outcome_display}
            </Badge>
            <span className="text-ink-3">Applied {formatDate(application.applied_at)}</span>
          </span>
        }
        action={
          <>
            <Button onClick={() => setAdvancing(true)} icon={<Icon name="arrowRight" size={15} />}>
              Move stage
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
            <CardHeader title="Details" />
            <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <Detail label="Applied on" value={formatDate(application.applied_at)} />
              <Detail
                label="Follow-up"
                value={
                  application.follow_up_date ? (
                    <span
                      className={cx(
                        new Date(`${application.follow_up_date}T12:00:00`) <
                          new Date(new Date().toDateString()) && 'text-critical',
                      )}
                    >
                      {relativeDay(application.follow_up_date)}
                    </span>
                  ) : (
                    '—'
                  )
                }
              />
              <Detail
                label="Reapply reminder"
                value={
                  application.reapply_at ? (
                    <Link to="/calendar" className="text-brand hover:underline">
                      {relativeDay(application.reapply_at)}
                    </Link>
                  ) : (
                    '—'
                  )
                }
              />
              <Detail
                label="Source"
                value={
                  application.source ? (
                    <span className="inline-flex items-center gap-1.5">
                      {application.source}
                      {application.source.toLowerCase().includes('linkedin') ? (
                        <span className="inline-flex items-center gap-0.5 rounded-full bg-[#0a66c2]/10 px-1.5 py-0.5 text-[10.5px] font-semibold text-[#0a66c2]">
                          <Icon name="link" size={11} />
                          LinkedIn
                        </span>
                      ) : null}
                    </span>
                  ) : (
                    '—'
                  )
                }
              />
              <Detail
                label="Resume"
                value={
                  application.resume_label ? (
                    <Link to="/resumes" className="text-brand hover:underline">
                      {application.resume_label}
                    </Link>
                  ) : (
                    application.resume_version || '—'
                  )
                }
              />
              <Detail
                label="Stage last moved"
                value={
                  application.stage_updated_at
                    ? formatDateTime(application.stage_updated_at)
                    : '—'
                }
              />
              <Detail label="Created" value={formatDate(application.created_at.slice(0, 10))} />
            </dl>

            {application.notes ? (
              <div className="mt-4 rounded-lg border border-line bg-surface-2 p-3">
                <p className="mb-1 text-[12px] font-medium uppercase tracking-wide text-ink-3">
                  Notes
                </p>
                <RichText text={application.notes} className="text-[13.5px] text-ink-2" />
              </div>
            ) : null}
          </Card>

          <Card>
            <CardHeader
              title="Roles Covered"
              subtitle={
                <>
                  {application.listing_links.length} listing
                  {application.listing_links.length === 1 ? '' : 's'} at{' '}
                  <Link
                    to={`/job-directory/companies/${application.company}`}
                    state={{ from: `${location.pathname}${location.search}` }}
                    className="text-brand hover:underline"
                  >
                    {application.company_name}
                  </Link>
                </>
              }
            />
            {application.listing_links.length === 0 ? (
              <p className="mt-3 text-[13px] text-ink-3">
                No roles linked yet — add them from the edit dialog.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-line">
                {application.listing_links.map((link) => (
                  <li key={link.id} className="py-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 truncate text-[13.5px] font-medium text-ink">
                          {link.listing_detail.role_name}
                          {link.listing_detail.job_url ? (
                            <a
                              href={link.listing_detail.job_url}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="shrink-0 text-ink-3 transition-colors hover:text-brand"
                            >
                              <Icon name="link" size={13} />
                            </a>
                          ) : null}
                          {link.listing_detail.linkedin_application_count > 0 ? (
                            <span
                              title={`${link.listing_detail.linkedin_application_count} application${link.listing_detail.linkedin_application_count === 1 ? '' : 's'} via LinkedIn`}
                              className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-[#0a66c2]/10 px-1.5 py-0.5 text-[10.5px] font-semibold text-[#0a66c2]"
                            >
                              <Icon name="link" size={11} />
                              LinkedIn
                            </span>
                          ) : null}
                        </p>
                        <p className="mt-0.5 flex flex-wrap gap-x-2 text-[12px] text-ink-3">
                          {link.listing_detail.location_name ? (
                            <span>{link.listing_detail.location_name}</span>
                          ) : null}
                          {link.listing_detail.role_type_display ? (
                            <span>{link.listing_detail.role_type_display}</span>
                          ) : null}
                          {link.listing_detail.closing_at ? (
                            <span>Closes {formatDate(link.listing_detail.closing_at)}</span>
                          ) : null}
                        </p>
                      </div>
                      <Badge tone={OUTCOME_TONE[link.effective_outcome] ?? 'neutral'}>
                        {link.outcome ? 'Role: ' : ''}
                        {choices.data?.outcome.find((c) => c.value === link.effective_outcome)?.label ??
                          link.effective_outcome}
                      </Badge>
                    </div>
                    {link.listing_detail.description ? (
                      <p className="mt-1.5 line-clamp-2 text-[12.5px] text-ink-2">
                        {link.listing_detail.description}
                      </p>
                    ) : null}
                    {link.listing_detail.skills_list.length ? (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {link.listing_detail.skills_list.map((skill) => (
                          <span
                            key={skill}
                            className="rounded-full bg-brand-soft px-1.5 py-0.5 text-[10.5px] font-medium text-brand-strong"
                          >
                            {skill}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader
              title="History"
              subtitle="Append-only — every edit, stage move and outcome change is kept"
            />
            <ApplicationHistory logs={application.event_logs} />
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader
              title="People Here"
              action={
                <Link to="/network" className="text-[12.5px] font-medium text-brand hover:underline">
                  Network
                </Link>
              }
            />
            {relatedPeople.length === 0 ? (
              <p className="mt-3 text-[13px] text-ink-3">
                No contacts linked to this application yet.
              </p>
            ) : (
              <ul className="mt-2 divide-y divide-line">
                {relatedPeople.map((person) => (
                  <li key={person.id}>
                    <Link
                      to={`/network/${person.id}`}
                      className="-mx-2 flex items-center gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-surface-2"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-medium text-ink">
                          {person.full_name}
                        </span>
                        <span className="block truncate text-[12px] text-ink-3">
                          {person.title || person.relationship_display}
                        </span>
                      </span>
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
                  All todos
                </Link>
              }
            />
            {relatedTodos.length === 0 ? (
              <p className="mt-3 text-[13px] text-ink-3">No tasks for this application.</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-1.5">
                {relatedTodos.map((todo) => (
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

          <Card>
            <CardHeader title="Danger Zone" subtitle="Deleting also removes its history." />
            <Button
              variant="danger"
              className="mt-3 w-full"
              onClick={() => setConfirmDelete(true)}
              icon={<Icon name="trash" size={15} />}
            >
              Delete application
            </Button>
          </Card>
        </div>
      </div>

      <ApplicationForm
        open={editing}
        existing={application}
        choices={choices.data}
        onClose={() => setEditing(false)}
        onSaved={(saved) => detail.setData(saved)}
      />

      <AdvanceDialog
        open={advancing}
        application={application}
        choices={choices.data}
        onClose={() => setAdvancing(false)}
        onSaved={(saved) => {
          detail.setData(saved)
          notify('Stage updated and recorded in the history.')
        }}
      />

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this application?"
        description="Its roles and full event history go with it. This can’t be undone."
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
          You’re about to delete your <strong>{application.company_name}</strong> application
          and all {application.event_logs.length} history entries.
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

/** One row in the historical-logging list — `key` is only for React's list
    rendering and never leaves this component. */
/** Stages that describe something you actually turn up to, so they're worth
    offering a calendar entry for. A rejection or an offer is news, not an
    appointment. */
const SCHEDULABLE_STAGES = new Set([
  'online_assessment',
  'video_interview',
  'assessment_centre',
  'final_interview',
])

type MoveRow = { key: string; stage: string; outcome: string; changed_at: string; note: string }

function newMoveRow(stage: string): MoveRow {
  return { key: Math.random().toString(36).slice(2), stage, outcome: '', changed_at: '', note: '' }
}

function AdvanceDialog({
  open,
  application,
  choices,
  onClose,
  onSaved,
}: {
  open: boolean
  application: Application
  choices: import('../api/types').ApplicationChoices | null
  onClose: () => void
  onSaved: (application: Application) => void
}) {
  const { notify } = useToast()
  const celebrate = useCelebrate()
  const [stage, setStage] = useState(application.stage)
  const [outcome, setOutcome] = useState(application.outcome)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // FR-APP-HIST-* — "this already happened, log it with real dates" rather
  // than every backdated stage landing on today. A separate mode, not an
  // extra field on the form above: a single date doesn't fit a live move
  // (there's only ever one "now"), and a list of moves doesn't fit a live
  // one either (there's only one change to record).
  const [historical, setHistorical] = useState(false)
  const [moves, setMoves] = useState<MoveRow[]>(() => [newMoveRow(application.stage)])

  // An assessment centre or interview is a thing that happens on a day, in a
  // room, usually with people — i.e. a calendar event. Offered right here
  // because this is the moment you learn about it, and pre-linked to the
  // application so "where we met" on the network can find it later.
  // The catalog, not `choices.stage`: the picker needs each stage's id to
  // offer inline creation the way the company/role pickers do.
  const stageList = useResource(() => applicationStages.list(), [])
  // A stage created from the picker has to be resolvable *immediately*. The
  // Combobox calls `onChange(id)` the moment `onCreate` resolves, and the
  // refetch behind it hasn't landed yet — so looking the id up in the fetched
  // list alone returned nothing and blanked the stage, which then failed to
  // save. Holding the new row here closes that gap; the refetch dedupes it.
  const [justAdded, setJustAdded] = useState<ApplicationStage[]>([])
  const fetchedStages = stageList.data ?? []
  const stageRows = [
    ...fetchedStages,
    ...justAdded.filter((row) => !fetchedStages.some((known) => known.id === row.id)),
  ].sort((a, b) => a.position - b.position || a.id - b.id)
  const stageOptions = stageRows.map((row) => ({ id: row.id, label: row.name }))
  const idForStage = (key: string) => stageRows.find((row) => row.key === key)?.id ?? null

  /**
   * Translate the picker's id back to the key an application stores.
   *
   * `current` is returned when the id can't be resolved, rather than a blank.
   * The Combobox calls `onChange(id)` in the same tick that `onCreate`
   * resolves — before React has re-rendered with the new stage in the list —
   * so a freshly added stage is genuinely unknown here for one beat.
   * Blanking it there is what sent an empty stage to the API and made a new
   * stage impossible to save. Only an explicit clear (`null`) empties it.
   */
  const keyForStage = (id: number | null, current: string) => {
    if (id === null) return ''
    return stageRows.find((row) => row.id === id)?.key ?? current
  }

  async function createStage(name: string) {
    const created = await applicationStages.ensure({ name })
    setJustAdded((rows) => [...rows, created])
    stageList.reload()
    return created
  }

  const [addToCalendar, setAddToCalendar] = useState(false)
  const [eventDate, setEventDate] = useState(today())
  const schedulable = SCHEDULABLE_STAGES.has(stage) && stage !== application.stage

  const [lastOpen, setLastOpen] = useState(open)
  if (open !== lastOpen) {
    setLastOpen(open)
    if (open) {
      setStage(application.stage)
      setOutcome(application.outcome)
      setNote('')
      setError('')
      setHistorical(false)
      setMoves([newMoveRow(application.stage)])
      setAddToCalendar(false)
      setEventDate(today())
    }
  }

  function addMoveRow() {
    setMoves((prev) => [...prev, newMoveRow(prev[prev.length - 1]?.stage ?? application.stage)])
  }

  function updateMoveRow(key: string, patch: Partial<MoveRow>) {
    setMoves((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)))
  }

  function removeMoveRow(key: string) {
    setMoves((prev) => (prev.length > 1 ? prev.filter((row) => row.key !== key) : prev))
  }

  async function submit() {
    setSaving(true)
    setError('')
    try {
      const saved = await applications.advance(application.id, { stage, outcome, note })
      if (schedulable && addToCalendar) {
        const label = choices?.stage.find((c) => c.value === stage)?.label ?? 'Next step'
        await calendarEvents.create({
          title: `${application.company_name} ${label}`,
          date: eventDate,
          all_day: true,
          start_time: null,
          end_time: null,
          notes: '',
          is_done: false,
          company: application.company,
          application: application.id,
          people: [],
          reminders: [{ minutes_before: 1440 }],
        })
        notify('Added to your calendar.')
      }
      if (movedForward(application.stage, saved.stage, choices)) celebrate('stage')
      onSaved(saved)
      setNote('')
      onClose()
    } catch (err) {
      notify(formatApiError(err), 'error')
    } finally {
      setSaving(false)
    }
  }

  async function submitHistory() {
    setSaving(true)
    setError('')
    try {
      const saved = await applications.backfill(
        application.id,
        moves.map((move) => ({
          stage: move.stage,
          changed_at: move.changed_at,
          outcome: move.outcome || undefined,
          note: move.note || undefined,
        })),
      )
      onSaved(saved)
      notify(`Logged ${moves.length} past stage move${moves.length === 1 ? '' : 's'}.`)
      onClose()
    } catch (err) {
      setError(formatApiError(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size={historical ? 'lg' : undefined}
      title="Move this application"
      description={
        historical
          ? "For an application you're only entering now, already past this point — each move gets its own real date instead of landing on today."
          : 'A history entry is written only if something actually changes.'
      }
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          {historical ? (
            <Button variant="primary" loading={saving} onClick={() => void submitHistory()}>
              Log history
            </Button>
          ) : (
            <Button variant="primary" loading={saving} onClick={() => void submit()}>
              Record change
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <button
          type="button"
          onClick={() => setHistorical((current) => !current)}
          className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-left transition-colors hover:border-brand-ring"
        >
          <span>
            <span className="block text-[13px] font-medium text-ink">
              This already happened
            </span>
            <span className="block text-[12px] text-ink-3">
              Log old stage moves with their real dates, instead of today's.
            </span>
          </span>
          <span
            role="switch"
            aria-checked={historical}
            className={cx(
              'relative h-6 w-11 shrink-0 rounded-full transition-colors',
              historical ? 'bg-brand' : 'bg-surface ring-1 ring-inset ring-line',
            )}
          >
            <span
              className={cx(
                'absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition-transform',
                historical ? 'translate-x-5' : 'translate-x-0',
              )}
            />
          </span>
        </button>

        {error ? (
          <p role="alert" className="rounded-lg border border-critical/25 bg-critical/10 px-3 py-2 text-[13px] text-ink">
            {error}
          </p>
        ) : null}

        {historical ? (
          <div className="flex flex-col gap-3">
            {moves.map((move, index) => (
              <div
                key={move.key}
                className="flex flex-col gap-3 rounded-lg border border-line bg-surface-2 p-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-medium uppercase tracking-wide text-ink-3">
                    Move {index + 1}
                  </span>
                  {moves.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => removeMoveRow(move.key)}
                      aria-label={`Remove move ${index + 1}`}
                      className="rounded p-1 text-ink-3 hover:bg-surface hover:text-critical"
                    >
                      <Icon name="close" size={14} />
                    </button>
                  ) : null}
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Combobox
                    label="Stage"
                    value={idForStage(move.stage)}
                    options={stageOptions}
                    onChange={(id) =>
                      updateMoveRow(move.key, { stage: keyForStage(id, move.stage) })
                    }
                    onCreate={async (name) => {
                      const created = await createStage(name)
                      updateMoveRow(move.key, { stage: created.key })
                      return { id: created.id, label: created.name }
                    }}
                    createLabel="Add stage"
                    placeholder="Search or add…"
                  />
                  <Select
                    label="Outcome"
                    value={move.outcome}
                    onChange={(event) => updateMoveRow(move.key, { outcome: event.target.value })}
                  >
                    <option value="">— unchanged —</option>
                    {choices?.outcome.map((choice) => (
                      <option key={choice.value} value={choice.value}>
                        {choice.label}
                      </option>
                    ))}
                  </Select>
                  <Input
                    label="Date"
                    type="date"
                    required
                    value={move.changed_at}
                    onChange={(event) => updateMoveRow(move.key, { changed_at: event.target.value })}
                  />
                </div>
                <MentionInput
                  label="Note"
                  placeholder="e.g. Second OA round after a delay — @ to tag"
                  value={move.note}
                  onChange={(value) => updateMoveRow(move.key, { note: value })}
                />
              </div>
            ))}
            <Button onClick={addMoveRow} icon={<Icon name="plus" size={15} />}>
              Add another stage move
            </Button>
            <p className="text-[12px] text-ink-3">
              Oldest first — each move's date must be on or after the one before it.
            </p>
          </div>
        ) : (
          <>
            <Combobox
              label="Stage"
              value={idForStage(stage)}
              options={stageOptions}
              onChange={(id) => setStage((current) => keyForStage(id, current))}
              onCreate={async (name) => {
                const created = await createStage(name)
                // Set it here too: this is the one path where the id→key
                // lookup can't have caught up yet.
                setStage(created.key)
                return { id: created.id, label: created.name }
              }}
              createLabel="Add stage"
              placeholder="Search or add a stage…"
              help="Pipelines differ — add a phone interview or take-home if yours has one."
            />
            <Select label="Outcome" value={outcome} onChange={(event) => setOutcome(event.target.value)}>
              {choices?.outcome.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </Select>
            <MentionInput
              label="Note"
              placeholder="e.g. Passed the OA, AC booked for the 14th (@ to tag)"
              value={note}
              onChange={setNote}
            />

            {schedulable ? (
              <div className="flex flex-col gap-3 rounded-lg border border-line p-3">
                <label className="flex items-center justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium text-ink">
                      Put it in my calendar
                    </span>
                    <span className="block text-[12px] text-ink-3">
                      Linked to this application, with a reminder the day before.
                    </span>
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={addToCalendar}
                    onClick={() => setAddToCalendar((value) => !value)}
                    className={cx(
                      'relative h-6 w-11 shrink-0 rounded-full transition-colors',
                      addToCalendar ? 'bg-brand' : 'bg-surface-2 ring-1 ring-inset ring-line',
                    )}
                  >
                    <span
                      className={cx(
                        'absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition-transform',
                        addToCalendar ? 'translate-x-5' : 'translate-x-0',
                      )}
                    />
                  </button>
                </label>
                {addToCalendar ? (
                  <Input
                    label="When is it?"
                    type="date"
                    value={eventDate}
                    onChange={(event) => setEventDate(event.target.value)}
                  />
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </div>
    </Modal>
  )
}
