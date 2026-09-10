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
  PersonCompanyInput,
  RelationshipTag,
} from '../api/types'
import { useCelebrate } from '../celebrate/context'
import { Avatar } from './ui/Avatar'
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
  // The memberships *are* the company selection — the multi-select below reads
  // its ids off them and writes back, so picking a company and dating it are
  // the same piece of state rather than two that can drift apart.
  const [memberships, setMemberships] = useState<PersonCompanyInput[]>(() =>
    (existing?.company_details ?? []).map((company) => ({
      company: company.id,
      title: company.title,
      started_on: company.started_on,
      ended_on: company.ended_on,
      is_current: company.is_current,
    })),
  )
  const companyIds = memberships.map((entry) => entry.company)

  /** Keeps the dates already entered for companies that stay selected. */
  function setCompanyIds(ids: number[]) {
    setMemberships((previous) =>
      ids.map((id) => previous.find((entry) => entry.company === id) ?? { company: id }),
    )
  }

  function setMembership(companyId: number, patch: Partial<PersonCompanyInput>) {
    setMemberships((previous) =>
      previous.map((entry) =>
        entry.company === companyId ? { ...entry, ...patch } : entry,
      ),
    )
  }
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
  const [peopleOptions, setPeopleOptions] = useState<Person[]>([])
  const [connectionIds, setConnectionIds] = useState<number[]>(
    () => existing?.connections ?? [],
  )

  useEffect(() => {
    void Promise.all([
      companies.list(),
      applications.list(),
      relationships.list(),
      metSources.list(),
      people.list(),
    ]).then(([companyRows, applicationRows, relationshipRows, sourceRows, peopleRows]) => {
      setCompanyOptions(companyRows)
      setApplicationOptions(applicationRows)
      setRelationshipOptions(relationshipRows)
      setSourceOptions(sourceRows)
      setPeopleOptions(peopleRows)
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
      company_memberships: memberships,
      connections: connectionIds,
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
            options={companyOptions.map((company) => ({
              id: company.id,
              label: company.name,
              avatar: company.logo,
              avatarShape: 'square' as const,
            }))}
            value={companyIds}
            onChange={setCompanyIds}
            emptyText="No companies yet."
          />
        </div>

        {memberships.length ? (
          <div className="rounded-lg border border-line bg-surface-2 p-3">
            <p className="mb-2 text-[12px] font-medium uppercase tracking-wide text-ink-3">
              Where they work, or worked
            </p>
            {/* All optional. Left blank, a company just reads as "current" —
                which is how every contact added before this existed behaves. */}
            <ul className="flex flex-col gap-2.5">
              {memberships.map((entry) => {
                const company = companyOptions.find((option) => option.id === entry.company)
                const stillHere = entry.is_current !== false && !entry.ended_on
                return (
                  <li key={entry.company} className="rounded-lg border border-line bg-surface p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2">
                        <Avatar
                          name={company?.name ?? 'Company'}
                          src={company?.logo}
                          size="xs"
                          shape="square"
                        />
                        <span className="truncate text-[13px] font-medium text-ink">
                          {company?.name ?? 'Company'}
                        </span>
                      </span>
                      <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-[11.5px] text-ink-2">
                        <input
                          type="checkbox"
                          checked={stillHere}
                          onChange={(event) =>
                            setMembership(entry.company, {
                              is_current: event.target.checked,
                              // Ticking "still here" clears a leaving date that
                              // would otherwise override it.
                              ended_on: event.target.checked ? null : entry.ended_on,
                            })
                          }
                          className="size-3.5 accent-[var(--color-brand)]"
                        />
                        Still here
                      </label>
                    </div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-3">
                      <Input
                        aria-label="Their title here"
                        placeholder="Title (optional)"
                        value={entry.title ?? ''}
                        onChange={(event) =>
                          setMembership(entry.company, { title: event.target.value })
                        }
                      />
                      <Input
                        type="date"
                        aria-label="Started"
                        value={entry.started_on ?? ''}
                        onChange={(event) =>
                          setMembership(entry.company, { started_on: event.target.value || null })
                        }
                      />
                      <Input
                        type="date"
                        aria-label="Left"
                        value={entry.ended_on ?? ''}
                        onChange={(event) =>
                          setMembership(entry.company, {
                            ended_on: event.target.value || null,
                            // A leaving date and "still here" contradict; the
                            // date the user just typed is the newer intent.
                            is_current: event.target.value ? false : entry.is_current,
                          })
                        }
                      />
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <MultiSelect
            label="Connected to"
            options={peopleOptions
              // Nobody is connected to themselves, so the person being edited
              // is never offered as an option.
              .filter((option) => option.id !== existing?.id)
              // Face and name only — the roles here run long enough to crowd
              // the name out of the row, and the photo identifies someone
              // faster than their job title does anyway.
              .map((option) => ({
                id: option.id,
                label: option.full_name,
                avatar: option.photo,
              }))}
            value={connectionIds}
            onChange={setConnectionIds}
            emptyText="No other contacts yet."
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
          label="Profile notes"
          value={form.notes}
          error={errors.notes}
          onChange={(value) => set('notes', value)}
          placeholder="How you met, what you talked about… (@ to tag a contact, company or place)"
        />
      </form>
    </Modal>
  )
}
