import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { fieldErrors, formatApiError } from '../api/client'
import { applications, companies, people, todos } from '../api/resources'
import type {
  ApplicationSummary,
  Company,
  Person,
  Todo,
  TodoChoices,
  TodoSuggestion,
} from '../api/types'
import { useFormDirty } from '../hooks/useFormDirty'
import { Button } from './ui/Button'
import { Combobox } from './ui/Combobox'
import { Input, Select } from './ui/Field'
import { MentionInput, MentionTextarea } from './ui/Mention'
import { Modal } from './ui/Modal'
import { useToast } from './ui/toast-context'
import { companyOption } from '../lib/company'
import { usePublishDraft, type CalendarDraft, type CalendarDraftRef } from '../lib/calendarDraft'

export type TodoFormProps = {
  open: boolean
  onClose: () => void
  onSaved: () => void
  onDeleted: () => void
  choices: TodoChoices | null
  existing?: Todo | null
  seed?: TodoSuggestion | null
  /** Optional strip above the fields (e.g. calendar kind toggles). */
  banner?: ReactNode
  /** Values carried over from another calendar kind — see `CalendarDraft`. */
  draft?: CalendarDraft | null
  /** Lets the calendar's kind switcher read these fields back out. */
  draftRef?: CalendarDraftRef
}

function initialForm(
  existing?: Todo | null,
  seed?: TodoSuggestion | null,
  draft?: CalendarDraft | null,
) {
  // A timed draft becomes a due clock time; an all-day one leaves it blank.
  const timed = Boolean(draft && !draft.allDay)
  return {
    title: existing?.title ?? draft?.title ?? seed?.title ?? '',
    description: existing?.description ?? draft?.notes ?? '',
    due_date: existing?.due_date ?? draft?.date ?? seed?.due_date ?? '',
    // HTML time inputs want HH:MM; the API stores HH:MM:SS.
    due_time: existing?.due_time
      ? existing.due_time.slice(0, 5)
      : timed
        ? (draft?.startTime ?? '')
        : '',
    due_end_time: existing?.due_end_time
      ? existing.due_end_time.slice(0, 5)
      : timed
        ? (draft?.endTime ?? '')
        : '',
    priority: existing?.priority ?? 'medium',
    status: existing?.status ?? 'open',
    application: (existing?.application ?? draft?.application ?? seed?.application ?? null) as
      | number
      | null,
    person: (existing?.person ?? draft?.person ?? seed?.person ?? null) as number | null,
    company: (existing?.company ?? draft?.company ?? null) as number | null,
  }
}

function plusOneHour(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const total = Math.min(h * 60 + m + 60, 23 * 60 + 59)
  const nh = Math.floor(total / 60)
  const nm = total % 60
  return `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}`
}

/** Body mounts only while open, so its state is seeded once and never synced. */
export function TodoForm(props: TodoFormProps) {
  if (!props.open) return null
  return <TodoFormBody {...props} />
}

function TodoFormBody({
  open,
  onClose,
  onSaved,
  onDeleted,
  choices,
  existing,
  seed,
  banner,
  draft,
  draftRef,
}: TodoFormProps) {
  const { notify } = useToast()
  const [form, setForm] = useState(() => initialForm(existing, seed, draft))

  usePublishDraft(draftRef, () => ({
    title: form.title,
    date: form.due_date,
    allDay: !form.due_time,
    startTime: form.due_time,
    endTime: form.due_end_time,
    notes: form.description,
    person: form.person,
    company: form.company,
    application: form.application,
  }))
  const [error, setError] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const dirty = useFormDirty(form)
  const guardedCloseRef = useRef<(() => void) | null>(null)

  const [applicationOptions, setApplicationOptions] = useState<ApplicationSummary[]>([])
  const [personOptions, setPersonOptions] = useState<Person[]>([])
  const [companyOptions, setCompanyOptions] = useState<Company[]>([])

  useEffect(() => {
    void Promise.all([applications.list(), people.list(), companies.list()]).then(
      ([applicationRows, personRows, companyRows]) => {
        setApplicationOptions(applicationRows)
        setPersonOptions(personRows)
        setCompanyOptions(companyRows)
      },
    )
  }, [])

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setErrors({})
    const dueDate = form.due_date || null
    const dueTime = dueDate && form.due_time ? `${form.due_time}:00` : null
    const payload = {
      ...form,
      due_date: dueDate,
      due_time: dueTime,
      due_end_time:
        dueTime && form.due_end_time ? `${form.due_end_time}:00` : null,
    }
    try {
      if (existing) await todos.update(existing.id, payload)
      else await todos.create(payload)
      notify(existing ? 'Todo updated.' : 'Todo added.')
      onSaved()
      onClose()
    } catch (err) {
      setError(formatApiError(err))
      setErrors(fieldErrors(err))
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!existing) return
    try {
      await todos.remove(existing.id)
      notify('Todo deleted.')
      onDeleted()
      onClose()
    } catch (err) {
      notify(formatApiError(err), 'error')
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      dirty={dirty}
      guardedCloseRef={guardedCloseRef}
      title={existing ? 'Edit todo' : 'New todo'}
      footer={
        <>
          {existing ? (
            <Button variant="danger" onClick={() => void remove()} className="mr-auto">
              Delete
            </Button>
          ) : null}
          <Button type="button" onClick={() => guardedCloseRef.current?.()}>
            Cancel
          </Button>
          <Button type="submit" form="todo-form" variant="primary" loading={saving}>
            {existing ? 'Save changes' : 'Add todo'}
          </Button>
        </>
      }
    >
      <form id="todo-form" onSubmit={onSubmit} className="flex flex-col gap-4">
        {banner}
        {error ? (
          <p
            role="alert"
            className="rounded-lg border border-critical/25 bg-critical/10 px-3 py-2 text-[13px] text-ink"
          >
            {error}
          </p>
        ) : null}

        <MentionInput
          label="Title"
          required
          autoFocus
          value={form.title}
          error={errors.title}
          onChange={(value) => set('title', value)}
          placeholder="Message Sarah after the OA"
        />

        <div className="grid gap-4 sm:grid-cols-3">
          <Input
            label="Due date"
            type="date"
            value={form.due_date}
            error={errors.due_date}
            onChange={(event) => {
              const next = event.target.value
              setForm((prev) => ({
                ...prev,
                due_date: next,
                due_time: next ? prev.due_time : '',
                due_end_time: next ? prev.due_end_time : '',
              }))
            }}
          />
          <Input
            label="Start"
            type="time"
            value={form.due_time}
            error={errors.due_time}
            disabled={!form.due_date}
            help={form.due_date ? 'Optional — places it on the calendar.' : 'Pick a due date first.'}
            onChange={(event) => {
              const next = event.target.value
              setForm((prev) => {
                const end =
                  !next
                    ? ''
                    : !prev.due_end_time || prev.due_end_time <= next
                      ? plusOneHour(next)
                      : prev.due_end_time
                return { ...prev, due_time: next, due_end_time: end }
              })
            }}
          />
          <Input
            label="End"
            type="time"
            value={form.due_end_time}
            error={errors.due_end_time}
            disabled={!form.due_date || !form.due_time}
            help={
              form.due_time
                ? 'How long it lasts on the calendar (drag the bottom edge to resize).'
                : 'Set a start time first.'
            }
            onChange={(event) => set('due_end_time', event.target.value)}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Priority"
            value={form.priority}
            onChange={(event) => set('priority', event.target.value)}
          >
            {choices?.priority.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </Select>
          <Select
            label="Status"
            value={form.status}
            onChange={(event) => set('status', event.target.value)}
          >
            {choices?.status.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </Select>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Combobox
            label="Application"
            value={form.application}
            onChange={(id) => set('application', id)}
            options={applicationOptions.map((application) => ({
              id: application.id,
              label: application.company_name,
              hint: application.stage_display,
            }))}
            placeholder="None"
          />
          <Combobox
            label="Person"
            value={form.person}
            onChange={(id) => set('person', id)}
            options={personOptions.map((person) => ({
              id: person.id,
              label: person.full_name,
              avatar: person.photo,
            }))}
            placeholder="None"
          />
          <Combobox
            label="Company"
            value={form.company}
            onChange={(id) => set('company', id)}
            options={companyOptions.map(companyOption)}
            placeholder="None"
          />
        </div>

        <MentionTextarea
          label="Description"
          value={form.description}
          error={errors.description}
          onChange={(value) => set('description', value)}
          placeholder="What needs doing…"
          help="Use @ to link it to an application, a person or a company."
        />
      </form>
    </Modal>
  )
}
