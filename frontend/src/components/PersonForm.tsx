import { useEffect, useState, type FormEvent } from 'react'
import { fieldErrors, formatApiError } from '../api/client'
import { applications, companies, metSources, people, relationships } from '../api/resources'
import type {
  ApplicationSummary,
  Company,
  ContactMethod,
  MetSourceTag,
  NetworkChoices,
  Person,
  RelationshipTag,
} from '../api/types'
import { useCelebrate } from '../celebrate/context'
import { Button } from './ui/Button'
import { ImagePicker } from './ui/ImagePicker'
import { Combobox, MultiSelect } from './ui/Combobox'
import { Input, Select } from './ui/Field'
import { MentionTextarea } from './ui/Mention'
import { Icon } from './ui/Icon'
import { Modal } from './ui/Modal'
import { useToast } from './ui/toast-context'

type Props = {
  open: boolean
  onClose: () => void
  onSaved: (person: Person) => void
  choices: NetworkChoices | null
  existing?: Person | null
}

function initialForm(existing?: Person | null) {
  return {
    full_name: existing?.full_name ?? '',
    title: existing?.title ?? '',
    status: existing?.status ?? 'lead',
    last_meeting_at: existing?.last_meeting_at ?? '',
    next_chat_at: existing?.next_chat_at ?? '',
    // != null, not a truthy check: 0 is a real setting ("don't schedule")
    // and would otherwise load back as the default.
    cadence_months: existing?.cadence_months != null ? String(existing.cadence_months) : '',
    notes: existing?.notes ?? '',
  }
}

/** Body mounts only while open, so its state is seeded once and never synced. */
export function PersonForm(props: Props) {
  if (!props.open) return null
  return <PersonFormBody {...props} />
}

function PersonFormBody({ open, onClose, onSaved, choices, existing }: Props) {
  const { notify } = useToast()
  const celebrate = useCelebrate()
  const [form, setForm] = useState(() => initialForm(existing))
  const [relationshipId, setRelationshipId] = useState<number | null>(
    existing?.relationship ?? null,
  )
  const [sourceId, setSourceId] = useState<number | null>(existing?.source ?? null)
  const [companyIds, setCompanyIds] = useState<number[]>(() => existing?.companies ?? [])
  const [applicationIds, setApplicationIds] = useState<number[]>(
    () => existing?.applications ?? [],
  )
  const [contacts, setContacts] = useState<ContactMethod[]>(() =>
    existing
      ? existing.contact_methods.map((contact) => ({
          channel: contact.channel,
          value: contact.value,
          is_preferred: contact.is_preferred,
        }))
      : [{ channel: 'linkedin', value: '', is_preferred: true }],
  )

  // A new contact has no id yet, so the photo can't be POSTed until after the
  // create. Hold the File (and a local preview) and upload it on save.
  const [photoUrl, setPhotoUrl] = useState<string | null>(existing?.photo ?? null)
  const [pendingPhoto, setPendingPhoto] = useState<File | null>(null)
  const [error, setError] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const [relationshipOptions, setRelationshipOptions] = useState<RelationshipTag[]>([])
  const [sourceOptions, setSourceOptions] = useState<MetSourceTag[]>([])
  const [companyOptions, setCompanyOptions] = useState<Company[]>([])
  const [applicationOptions, setApplicationOptions] = useState<ApplicationSummary[]>([])

  useEffect(() => {
    void Promise.all([
      companies.list(),
      applications.list(),
      relationships.list(),
      metSources.list(),
    ]).then(([companyRows, applicationRows, relationshipRows, sourceRows]) => {
      setCompanyOptions(companyRows)
      setApplicationOptions(applicationRows)
      setRelationshipOptions(relationshipRows)
      setSourceOptions(sourceRows)
    })
  }, [])

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function updateContact(index: number, patch: Partial<ContactMethod>) {
    setContacts((prev) =>
      prev.map((contact, position) => {
        if (position === index) return { ...contact, ...patch }
        // Only one channel can be preferred at a time.
        if (patch.is_preferred) return { ...contact, is_preferred: false }
        return contact
      }),
    )
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setErrors({})

    const payload = {
      ...form,
      relationship: relationshipId,
      source: sourceId,
      last_meeting_at: form.last_meeting_at || null,
      next_chat_at: form.next_chat_at || null,
      cadence_months: form.cadence_months ? Number(form.cadence_months) : null,
      companies: companyIds,
      applications: applicationIds,
      contacts: contacts.filter((contact) => contact.value.trim()),
    }

    try {
      let saved = existing
        ? await people.update(existing.id, payload)
        : await people.create(payload)

      if (pendingPhoto) {
        // The record exists now, so the photo endpoint is reachable. A failure
        // here shouldn't lose the contact the user just filled in.
        try {
          saved = await people.uploadPhoto(saved.id, pendingPhoto)
        } catch (err) {
          notify(`Contact saved, but the photo didn’t upload. ${formatApiError(err)}`, 'error')
        }
      }

      if (!existing) celebrate('connection')
      notify(existing ? 'Contact updated.' : 'Contact added.')
      onSaved(saved)
      onClose()
    } catch (err) {
      setError(formatApiError(err))
      setErrors(fieldErrors(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={existing ? 'Edit contact' : 'Add a contact'}
      description="Leave the next chat blank and it defaults to three months after the last meeting."
      footer={
        <>
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="person-form" variant="primary" loading={saving}>
            {existing ? 'Save changes' : 'Add contact'}
          </Button>
        </>
      }
    >
      <form id="person-form" onSubmit={onSubmit} className="flex flex-col gap-4">
        {error ? (
          <p role="alert" className="rounded-lg border border-critical/25 bg-critical/10 px-3 py-2 text-[13px] text-ink">
            {error}
          </p>
        ) : null}

        <ImagePicker
          name={form.full_name || 'New contact'}
          src={photoUrl}
          size="lg"
          label="photo"
          helpText={
            existing
              ? 'Shown wherever this contact appears.'
              : 'Uploaded once you save this contact.'
          }
          onUpload={async (file) => {
            if (existing) {
              const saved = await people.uploadPhoto(existing.id, file)
              setPhotoUrl(saved.photo)
            } else {
              setPendingPhoto(file)
              setPhotoUrl(URL.createObjectURL(file))
            }
          }}
          onRemove={
            photoUrl
              ? async () => {
                  if (existing && !pendingPhoto) {
                    const saved = await people.removePhoto(existing.id)
                    setPhotoUrl(saved.photo)
                  } else {
                    setPendingPhoto(null)
                    setPhotoUrl(existing?.photo ?? null)
                  }
                }
              : undefined
          }
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Name"
            required
            autoFocus
            value={form.full_name}
            error={errors.full_name}
            onChange={(event) => set('full_name', event.target.value)}
          />
          <Input
            label="Title"
            placeholder="Senior Consultant"
            value={form.title}
            error={errors.title}
            onChange={(event) => set('title', event.target.value)}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Select label="Status" value={form.status} onChange={(event) => set('status', event.target.value)}>
            {choices?.status.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </Select>
          <Combobox
            label="Relationship"
            value={relationshipId}
            onChange={setRelationshipId}
            options={relationshipOptions.map((entry) => ({ id: entry.id, label: entry.name }))}
            onCreate={async (name) => {
              const created = await relationships.ensure({ name })
              setRelationshipOptions((prev) => [...prev, created])
              return { id: created.id, label: created.name }
            }}
            placeholder="Optional — type to add one"
          />
          <Combobox
            label="Met via"
            value={sourceId}
            onChange={setSourceId}
            options={sourceOptions.map((entry) => ({ id: entry.id, label: entry.name }))}
            onCreate={async (name) => {
              const created = await metSources.ensure({ name })
              setSourceOptions((prev) => [...prev, created])
              return { id: created.id, label: created.name }
            }}
            placeholder="Optional — type to add one"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Last meeting"
            type="date"
            value={form.last_meeting_at}
            error={errors.last_meeting_at}
            onChange={(event) => set('last_meeting_at', event.target.value)}
          />
          <Input
            label="Next chat"
            type="date"
            value={form.next_chat_at}
            error={errors.next_chat_at}
            onChange={(event) => set('next_chat_at', event.target.value)}
            help={
              form.cadence_months === '0'
                ? 'No catch-up is scheduled for this contact unless you name a date here.'
                : `Blank = last meeting + ${form.cadence_months || 3} month${(Number(form.cadence_months) || 3) === 1 ? '' : 's'}.`
            }
          />
        </div>

        <Select
          label="Catch-up frequency"
          value={form.cadence_months}
          onChange={(event) => set('cadence_months', event.target.value)}
          help={
            form.cadence_months === '0'
              ? "This contact won't get a catch-up scheduled — any pending one is cleared on save."
              : "How often you check in with this contact — used to auto-fill Next chat when it's left blank."
          }
        >
          <option value="">Default (3 months)</option>
          <option value="1">Every month</option>
          <option value="2">Every 2 months</option>
          <option value="3">Every 3 months</option>
          <option value="6">Every 6 months</option>
          <option value="12">Every year</option>
          <option value="0">Don't schedule a catch-up</option>
        </Select>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[13px] font-medium text-ink-2">Contact channels</span>
            <button
              type="button"
              onClick={() =>
                setContacts((prev) => [
                  ...prev,
                  { channel: 'email', value: '', is_preferred: prev.length === 0 },
                ])
              }
              className="inline-flex items-center gap-1 text-[12.5px] font-medium text-brand hover:underline"
            >
              <Icon name="plus" size={13} />
              Add channel
            </button>
          </div>

          <div className="flex flex-col gap-2">
            {contacts.map((contact, index) => (
              <div key={index} className="flex items-center gap-2">
                <select
                  value={contact.channel}
                  onChange={(event) => updateContact(index, { channel: event.target.value })}
                  aria-label="Channel"
                  className="h-9 w-32 shrink-0 rounded-lg border border-line bg-surface px-2 text-[13px] text-ink hover:border-line-strong focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-ring"
                >
                  {choices?.channel.map((choice) => (
                    <option key={choice.value} value={choice.value}>
                      {choice.label}
                    </option>
                  ))}
                </select>
                <input
                  value={contact.value}
                  onChange={(event) => updateContact(index, { value: event.target.value })}
                  placeholder="URL, handle or address"
                  aria-label="Contact value"
                  className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-surface px-2.5 text-[13px] text-ink placeholder:text-ink-3 hover:border-line-strong focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-ring"
                />
                <label
                  className="flex shrink-0 cursor-pointer items-center gap-1.5 text-[12px] text-ink-2"
                  title="Preferred channel"
                >
                  <input
                    type="radio"
                    name="preferred-contact"
                    checked={contact.is_preferred}
                    onChange={() => updateContact(index, { is_preferred: true })}
                    className="size-3.5 cursor-pointer accent-[var(--color-brand)]"
                  />
                  <span className="hidden sm:inline">Preferred</span>
                </label>
                <button
                  type="button"
                  onClick={() => setContacts((prev) => prev.filter((_, i) => i !== index))}
                  aria-label="Remove channel"
                  className="shrink-0 rounded-lg p-1.5 text-ink-3 transition-colors hover:bg-surface-2 hover:text-critical"
                >
                  <Icon name="trash" size={15} />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <MultiSelect
            label="Companies"
            options={companyOptions.map((company) => ({ id: company.id, label: company.name }))}
            value={companyIds}
            onChange={setCompanyIds}
            emptyText="No companies yet."
          />
          <MultiSelect
            label="Relevant applications"
            options={applicationOptions.map((application) => ({
              id: application.id,
              label: application.company_name,
              hint: application.stage_display,
            }))}
            value={applicationIds}
            onChange={setApplicationIds}
            emptyText="No applications yet."
          />
        </div>

        <MentionTextarea
          label="Notes"
          value={form.notes}
          error={errors.notes}
          onChange={(value) => set('notes', value)}
          placeholder="How you met, what you talked about… (@ to tag a contact, company or place)"
        />
      </form>
    </Modal>
  )
}
