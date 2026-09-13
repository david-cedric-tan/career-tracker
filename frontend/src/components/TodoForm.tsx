import { useEffect, useRef, useState, type FormEvent } from 'react'
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

export type TodoFormProps = {
  open: boolean
  onClose: () => void
  onSaved: () => void
  onDeleted: () => void
  choices: TodoChoices | null
  existing?: Todo | null
  seed?: TodoSuggestion | null
}

function initialForm(existing?: Todo | null, seed?: TodoSuggestion | null) {
  return {
    title: existing?.title ?? seed?.title ?? '',
    description: existing?.description ?? '',
    due_date: existing?.due_date ?? seed?.due_date ?? '',
    priority: existing?.priority ?? 'medium',
    status: existing?.status ?? 'open',
    application: (existing?.application ?? seed?.application ?? null) as number | null,
    person: (existing?.person ?? seed?.person ?? null) as number | null,
    company: (existing?.company ?? null) as number | null,
  }
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
}: TodoFormProps) {
  const { notify } = useToast()
  const [form, setForm] = useState(() => initialForm(existing, seed))
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
    const payload = { ...form, due_date: form.due_date || null }
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
            onChange={(event) => set('due_date', event.target.value)}
          />
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
