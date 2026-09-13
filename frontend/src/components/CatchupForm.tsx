import { useEffect, useRef, useState, type FormEvent } from 'react'
import { fieldErrors, formatApiError } from '../api/client'
import { catchups, people } from '../api/resources'
import type { Catchup, CatchupChoices, Person } from '../api/types'
import { useCelebrate } from '../celebrate/context'
import { useFormDirty } from '../hooks/useFormDirty'
import { cx, today } from '../lib/format'
import { MESSAGE_CHANNEL_ICON } from '../lib/tones'
import { Icon } from './ui/Icon'
import { Button } from './ui/Button'
import { Combobox } from './ui/Combobox'
import { Input } from './ui/Field'
import { FormatPicker } from './catchups/FormatPicker'
import { MentionInput, MentionTextarea } from './ui/Mention'
import { Modal } from './ui/Modal'
import { useToast } from './ui/toast-context'
import { ConfirmDelete } from './ui/ConfirmDelete'

type Props = {
  open: boolean
  onClose: () => void
  onSaved: (catchup: Catchup) => void
  onDeleted?: () => void
  choices: CatchupChoices | null
  existing?: Catchup | null
  /** Pre-selects the contact when opened from their profile. */
  personId?: number | null
}

/** Body mounts only while open, so its state is seeded once and never synced. */
export function CatchupForm(props: Props) {
  if (!props.open) return null
  return <CatchupFormBody {...props} />
}

function CatchupFormBody({
  onClose,
  onSaved,
  onDeleted,
  choices,
  existing,
  personId,
}: Props) {
  const { notify } = useToast()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const celebrate = useCelebrate()
  const [form, setForm] = useState(() => ({
    person: (existing?.person ?? personId ?? null) as number | null,
    met_on: existing?.met_on ?? today(),
    title: existing?.title ?? '',
    format: existing?.format ?? 'coffee',
    format_other: existing?.format_other ?? '',
    message_channel: existing?.message_channel ?? 'linkedin',
    location: existing?.location ?? '',
    minutes: existing?.minutes ?? '',
    takeaways: existing?.takeaways ?? '',
    follow_up_on: existing?.follow_up_on ?? '',
  }))
  const [personOptions, setPersonOptions] = useState<Person[]>([])
  const [error, setError] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const dirty = useFormDirty(form)
  const guardedCloseRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    void people.list().then(setPersonOptions)
  }, [])

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!form.person) {
      setErrors({ person: 'Pick who you met.' })
      return
    }
    setSaving(true)
    setError('')
    setErrors({})

    const payload = {
      ...form,
      person: form.person,
      follow_up_on: form.follow_up_on || null,
      // Stale "what was it" text shouldn't survive switching away from Other.
      format_other: form.format === 'other' ? form.format_other : '',
      message_channel: form.format === 'message' ? form.message_channel : '',
    }

    try {
      const saved = existing
        ? await catchups.update(existing.id, payload)
        : await catchups.create(payload)
      if (!existing) celebrate('catchup')
      notify(existing ? 'Minutes updated.' : 'Catch-up logged.')
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
      await catchups.remove(existing.id)
      notify('Catch-up deleted.')
      onDeleted?.()
      onClose()
    } catch (err) {
      notify(formatApiError(err), 'error')
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      dirty={dirty}
      guardedCloseRef={guardedCloseRef}
      size="lg"
      title={existing ? 'Edit minutes' : 'Log a catch-up'}
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
          <Button type="button" onClick={() => guardedCloseRef.current?.()}>
            Cancel
          </Button>
          <Button type="submit" form="catchup-form" variant="primary" loading={saving}>
            {existing ? 'Save minutes' : 'Log catch-up'}
          </Button>
        </>
      }
    >
      <form id="catchup-form" onSubmit={onSubmit} className="flex flex-col gap-4">
        {error ? (
          <p role="alert" className="rounded-lg border border-critical/25 bg-critical/10 px-3 py-2 text-[13px] text-ink">
            {error}
          </p>
        ) : null}

        <Combobox
          label="Who did you meet?"
          required
          value={form.person}
          error={errors.person}
          options={personOptions.map((person) => ({
            id: person.id,
            label: person.full_name,
            hint: person.company_names[0],
            avatar: person.photo,
          }))}
          onChange={(id) => set('person', id)}
          placeholder="Search your network…"
        />

        <div>
          <FormatPicker
            label="Format"
            value={form.format}
            onChange={(next) => set('format', next)}
            choices={choices?.format}
          />
          {form.format === 'other' ? (
            <Input
              className="mt-2"
              value={form.format_other}
              onChange={(event) => set('format_other', event.target.value)}
              placeholder="What was it?"
              aria-label="What the format actually was"
            />
          ) : null}
          {form.format === 'message' ? (
            <div className="mt-2">
              <div role="radiogroup" aria-label="Message channel" className="flex flex-wrap gap-1.5">
                {choices?.message_channel.map((choice) => {
                  const active = form.message_channel === choice.value
                  return (
                    <button
                      key={choice.value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => set('message_channel', choice.value)}
                      className={cx(
                        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors',
                        active
                          ? 'border-brand bg-brand-soft text-brand-strong'
                          : 'border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink',
                      )}
                    >
                      <Icon name={MESSAGE_CHANNEL_ICON[choice.value] ?? 'mail'} size={11} />
                      {choice.label}
                    </button>
                  )
                })}
              </div>
              <p className="mt-1.5 text-[11.5px] text-ink-3">
                Updates “last messaged” only — it won’t count as a meeting or appear on the calendar.
              </p>
            </div>
          ) : null}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Met on"
            type="date"
            required
            value={form.met_on}
            error={errors.met_on}
            onChange={(event) => set('met_on', event.target.value)}
          />
          <Input
            label="Follow up on"
            type="date"
            value={form.follow_up_on}
            error={errors.follow_up_on}
            onChange={(event) => set('follow_up_on', event.target.value)}
            help="Blank = +3 months."
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <MentionInput
            label="Label"
            placeholder="Coffee at Barangaroo, Intro call, Mentoring…"
            value={form.title}
            error={errors.title}
            onChange={(value) => set('title', value)}
            help="Shown at the top of the card — what this catch-up was about."
          />
          <MentionInput
            label="Location"
            placeholder="Where, or which call — @ to tag a venue"
            value={form.location}
            error={errors.location}
            onChange={(value) => set('location', value)}
          />
        </div>

        <MentionTextarea
          label="Minutes"
          rows={7}
          value={form.minutes}
          error={errors.minutes}
          onChange={(value) => set('minutes', value)}
          placeholder="What you talked about, who they mentioned, what they suggested… (@ to tag a contact, company or place)"
        />

        <MentionTextarea
          label="Takeaways"
          rows={3}
          value={form.takeaways}
          error={errors.takeaways}
          onChange={(value) => set('takeaways', value)}
          placeholder="The two or three things worth remembering before the next one."
        />
      </form>

      <ConfirmDelete
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={remove}
        kind="catch-up"
        name={existing?.title || (existing ? 'This catch-up' : null)}
      />
    </Modal>
  )
}
