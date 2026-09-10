import { useEffect, useState, type FormEvent } from 'react'
import { fieldErrors, formatApiError } from '../api/client'
import { applications, calendarEvents, companies, people } from '../api/resources'
import type {
  ApplicationSummary,
  CalendarEventRecord,
  Company,
  Person,
} from '../api/types'
import { cx, today } from '../lib/format'
import { Button } from './ui/Button'
import { Input } from './ui/Field'
import { Combobox, MultiSelect } from './ui/Combobox'
import { MentionInput, MentionTextarea } from './ui/Mention'
import { Icon } from './ui/Icon'
import { Modal } from './ui/Modal'
import { useToast } from './ui/toast-context'
import { ConfirmDelete } from './ui/ConfirmDelete'

type Props = {
  open: boolean
  onClose: () => void
  onSaved: (event: CalendarEventRecord) => void
  onDeleted?: () => void
  existing?: CalendarEventRecord | null
  /** Pre-fills the date when opened from a day already selected on the grid. */
  defaultDate?: string
}

const DEFAULT_REMINDER_MINUTES = 30

const REMINDER_PRESETS = [
  { minutes: 0, label: 'At time of event' },
  { minutes: 5, label: '5 minutes before' },
  { minutes: 10, label: '10 minutes before' },
  { minutes: 15, label: '15 minutes before' },
  { minutes: 30, label: '30 minutes before' },
  { minutes: 60, label: '1 hour before' },
  { minutes: 120, label: '2 hours before' },
  { minutes: 180, label: '3 hours before' },
  { minutes: 1440, label: '1 day before' },
  { minutes: 10080, label: '1 week before' },
]

const CUSTOM_UNITS = [
  { value: 'minutes', label: 'Minutes', minutes: 1 },
  { value: 'hours', label: 'Hours', minutes: 60 },
  { value: 'days', label: 'Days', minutes: 1440 },
] as const
type CustomUnit = (typeof CUSTOM_UNITS)[number]['value']
const CUSTOM_VALUE = 'custom'

/** Humanizes any `minutes_before` — not just the presets above — so a
    custom value (say, 5 hours) still reads as "5 hours before" rather than
    the raw "300 minutes before" the backend actually stores. */
function reminderLabel(minutes: number): string {
  const preset = REMINDER_PRESETS.find((p) => p.minutes === minutes)
  if (preset) return preset.label
  for (const unit of [...CUSTOM_UNITS].reverse()) {
    if (unit.minutes > 1 && minutes % unit.minutes === 0) {
      const amount = minutes / unit.minutes
      const label = unit.label.toLowerCase()
      return `${amount} ${amount === 1 ? label.slice(0, -1) : label} before`
    }
  }
  return `${minutes} minutes before`
}

/** "14:30" -> next half hour, rounded up, as a fresh default start time. */
function roundedNow(): string {
  const now = new Date()
  const minutes = now.getMinutes() < 30 ? 30 : 0
  const hour = (now.getMinutes() < 30 ? now.getHours() : now.getHours() + 1) % 24
  return `${String(hour).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number)
  const total = (h * 60 + m + minutes + 1440) % 1440
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/** FR-CAL-07 — a plain event with no home anywhere else in the app. Body
    mounts only while open, so its state is seeded once and never synced. */
export function CalendarEventForm(props: Props) {
  if (!props.open) return null
  return <CalendarEventFormBody {...props} />
}

function CalendarEventFormBody({ onClose, onSaved, onDeleted, existing, defaultDate }: Props) {
  const { notify } = useToast()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [form, setForm] = useState(() => ({
    title: existing?.title ?? '',
    date: existing?.date ?? defaultDate ?? today(),
    all_day: existing?.all_day ?? true,
    start_time: existing?.start_time?.slice(0, 5) ?? roundedNow(),
    end_time: existing?.end_time?.slice(0, 5) ?? addMinutes(roundedNow(), 30),
    notes: existing?.notes ?? '',
    is_done: existing?.is_done ?? false,
    reminders: existing?.reminders.map((r) => r.minutes_before) ?? [],
  }))
  const [company, setCompany] = useState<number | null>(existing?.company ?? null)
  const [application, setApplication] = useState<number | null>(existing?.application ?? null)
  const [attendees, setAttendees] = useState<number[]>(existing?.people ?? [])
  const [companyOptions, setCompanyOptions] = useState<Company[]>([])
  const [applicationOptions, setApplicationOptions] = useState<ApplicationSummary[]>([])
  const [personOptions, setPersonOptions] = useState<Person[]>([])

  useEffect(() => {
    void companies.list().then(setCompanyOptions)
    void applications.list().then(setApplicationOptions)
    void people.list().then(setPersonOptions)
  }, [])
  const [error, setError] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [addingReminder, setAddingReminder] = useState(false)
  const [customReminder, setCustomReminder] = useState(false)
  const [customAmount, setCustomAmount] = useState(2)
  const [customUnit, setCustomUnit] = useState<CustomUnit>('hours')

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function toggleAllDay(nextAllDay: boolean) {
    setForm((prev) => ({
      ...prev,
      all_day: nextAllDay,
      // Switching into a timed event for the first time seeds the same
      // default reminder the backend would — instant feedback either way.
      reminders:
        !nextAllDay && prev.all_day && prev.reminders.length === 0
          ? [DEFAULT_REMINDER_MINUTES]
          : prev.reminders,
    }))
  }

  function addReminder(minutes: number) {
    setForm((prev) =>
      prev.reminders.includes(minutes)
        ? prev
        : { ...prev, reminders: [...prev.reminders, minutes].sort((a, b) => a - b) },
    )
    setAddingReminder(false)
    setCustomReminder(false)
  }

  // A plain confirm — not a submit handler — because this control lives
  // inside the event's own <form>; a nested <form> would be invalid HTML and
  // Enter-to-submit here would otherwise save the whole event instead.
  function confirmCustomReminder() {
    if (!customAmount || customAmount < 1) return
    const unitMinutes = CUSTOM_UNITS.find((u) => u.value === customUnit)?.minutes ?? 1
    addReminder(customAmount * unitMinutes)
    setCustomAmount(2)
    setCustomUnit('hours')
  }

  function removeReminder(minutes: number) {
    set(
      'reminders',
      form.reminders.filter((m) => m !== minutes),
    )
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setErrors({})
    const body = {
      title: form.title,
      date: form.date,
      all_day: form.all_day,
      start_time: form.all_day ? null : `${form.start_time}:00`,
      end_time: form.all_day ? null : `${form.end_time}:00`,
      notes: form.notes,
      is_done: form.is_done,
      company,
      application,
      people: attendees,
      reminders: form.reminders.map((minutes_before) => ({ minutes_before })),
    }
    try {
      const saved = existing
        ? await calendarEvents.update(existing.id, body)
        : await calendarEvents.create(body)
      notify(existing ? 'Event updated.' : 'Event added.')
      onSaved(saved)
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
      await calendarEvents.remove(existing.id)
      notify('Event deleted.')
      onDeleted?.()
      onClose()
    } catch (err) {
      notify(formatApiError(err), 'error')
    }
  }

  const availablePresets = REMINDER_PRESETS.filter((p) => !form.reminders.includes(p.minutes))

  return (
    <Modal
      open
      onClose={onClose}
      title={existing ? 'Edit event' : 'Add event'}
      footer={
        <>
          {existing ? (
            <Button
              variant="danger"
              onClick={() => setConfirmDelete(true)}
              className="mr-auto"
            >
              Delete
            </Button>
          ) : null}
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="calendar-event-form" variant="primary" loading={saving}>
            {existing ? 'Save' : 'Add event'}
          </Button>
        </>
      }
    >
      <form id="calendar-event-form" onSubmit={onSubmit} className="flex flex-col gap-4">
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
          placeholder="Career fair, coffee with a friend…"
          value={form.title}
          error={errors.title}
          onChange={(value) => set('title', value)}
        />

        <div className="flex flex-col gap-3 rounded-lg border border-line p-3">
          <label className="flex items-center justify-between gap-3">
            <span className="text-[13px] font-medium text-ink">All-day</span>
            <button
              type="button"
              role="switch"
              aria-checked={form.all_day}
              onClick={() => toggleAllDay(!form.all_day)}
              className={cx(
                'relative h-6 w-11 shrink-0 rounded-full transition-colors',
                form.all_day ? 'bg-brand' : 'bg-surface-2 ring-1 ring-inset ring-line',
              )}
            >
              <span
                className={cx(
                  'absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition-transform',
                  form.all_day ? 'translate-x-5' : 'translate-x-0',
                )}
              />
            </button>
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Date"
              type="date"
              required
              value={form.date}
              error={errors.date}
              onChange={(event) => set('date', event.target.value)}
            />
            {!form.all_day ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Input
                  label="Start"
                  type="time"
                  required
                  value={form.start_time}
                  error={errors.start_time}
                  onChange={(event) => set('start_time', event.target.value)}
                />
                <Input
                  label="End"
                  type="time"
                  value={form.end_time}
                  error={errors.end_time}
                  onChange={(event) => set('end_time', event.target.value)}
                />
              </div>
            ) : null}
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-[13px] font-medium text-ink">Reminders</p>
          <div className="flex flex-wrap gap-1.5">
            {form.reminders.map((minutes) => (
              <span
                key={minutes}
                className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 py-1 pl-3 pr-1.5 text-[12.5px] text-ink-2"
              >
                <Icon name="bell" size={13} className="text-ink-3" />
                {reminderLabel(minutes)}
                <button
                  type="button"
                  onClick={() => removeReminder(minutes)}
                  aria-label={`Remove reminder: ${reminderLabel(minutes)}`}
                  className="rounded-full p-0.5 text-ink-3 hover:bg-surface hover:text-ink"
                >
                  <Icon name="close" size={12} />
                </button>
              </span>
            ))}

            {customReminder ? (
              <div className="inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-surface py-1 pl-2.5 pr-1.5">
                <input
                  type="number"
                  min={1}
                  autoFocus
                  value={customAmount}
                  onChange={(event) => setCustomAmount(Number(event.target.value))}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      confirmCustomReminder()
                    }
                  }}
                  className="w-10 bg-transparent text-[12.5px] text-ink outline-none"
                />
                <select
                  value={customUnit}
                  onChange={(event) => setCustomUnit(event.target.value as CustomUnit)}
                  className="bg-transparent text-[12.5px] text-ink outline-none"
                >
                  {CUSTOM_UNITS.map((unit) => (
                    <option key={unit.value} value={unit.value}>
                      {unit.label}
                    </option>
                  ))}
                </select>
                <span className="text-[12.5px] text-ink-3">before</span>
                <button
                  type="button"
                  onClick={confirmCustomReminder}
                  disabled={!customAmount || customAmount < 1}
                  aria-label="Add this reminder"
                  className="rounded-full p-1 text-brand hover:bg-brand-soft disabled:pointer-events-none disabled:opacity-40"
                >
                  <Icon name="check" size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCustomReminder(false)
                    setAddingReminder(false)
                  }}
                  aria-label="Cancel custom reminder"
                  className="rounded-full p-1 text-ink-3 hover:bg-surface-2 hover:text-ink"
                >
                  <Icon name="close" size={12} />
                </button>
              </div>
            ) : addingReminder ? (
              <select
                autoFocus
                onChange={(event) => {
                  if (event.target.value === CUSTOM_VALUE) {
                    setCustomReminder(true)
                    return
                  }
                  addReminder(Number(event.target.value))
                }}
                onBlur={() => setAddingReminder(false)}
                defaultValue=""
                className="rounded-full border border-line bg-surface px-2.5 py-1 text-[12.5px] text-ink focus:border-brand focus:outline-none"
              >
                <option value="" disabled>
                  Choose…
                </option>
                {availablePresets.map((preset) => (
                  <option key={preset.minutes} value={preset.minutes}>
                    {preset.label}
                  </option>
                ))}
                <option value={CUSTOM_VALUE}>Custom…</option>
              </select>
            ) : (
              <button
                type="button"
                onClick={() => setAddingReminder(true)}
                className="inline-flex items-center gap-1 rounded-full border border-dashed border-line-strong px-2.5 py-1 text-[12.5px] text-ink-3 transition-colors hover:border-brand-ring hover:text-brand-strong"
              >
                <Icon name="plus" size={12} />
                Add reminder
              </button>
            )}
          </div>
        </div>

        <MentionTextarea
          label="Notes"
          rows={4}
          value={form.notes}
          error={errors.notes}
          onChange={(value) => set('notes', value)}
          placeholder="Anything worth remembering — @ to tag a contact, company or place."
        />

        {/* What the event was about. All optional — a dentist appointment
            links to nothing — but a careers fair is where you met people, an
            info session belongs to a company, and an assessment centre comes
            out of an application reaching that stage. */}
        <div className="flex flex-col gap-4 rounded-lg border border-line p-3">
          <p className="text-[13px] font-medium text-ink">What was it about?</p>

          <div className="grid gap-4 sm:grid-cols-2">
            <Combobox
              label="Company"
              value={company}
              onChange={setCompany}
              options={companyOptions.map((entry) => ({
                id: entry.id,
                label: entry.short_name || entry.name,
                hint: entry.industry_names[0],
                avatar: entry.logo,
                avatarShape: 'square' as const,
              }))}
              placeholder="Info session, site tour…"
            />
            <Combobox
              label="Application"
              value={application}
              onChange={setApplication}
              options={applicationOptions.map((entry) => ({
                id: entry.id,
                label: entry.company_name,
                hint: entry.stage_display,
              }))}
              placeholder="Assessment centre, interview…"
            />
          </div>

          <MultiSelect
            label="Who you met"
            value={attendees}
            onChange={setAttendees}
            options={personOptions.map((entry) => ({
              id: entry.id,
              label: entry.full_name,
              hint: entry.company_names[0],
            }))}
            emptyText="No contacts yet — add them under Network."
          />
        </div>

        {existing ? (
          <label className="flex items-center gap-2 text-[13px] text-ink-2">
            <input
              type="checkbox"
              checked={form.is_done}
              onChange={(event) => set('is_done', event.target.checked)}
              className="size-4 rounded border-line-strong accent-brand"
            />
            Done
          </label>
        ) : null}
      </form>

      <ConfirmDelete
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={remove}
        kind="event"
        name={existing?.title ?? null}
      />
    </Modal>
  )
}
