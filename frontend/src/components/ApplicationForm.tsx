import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { fieldErrors, formatApiError } from '../api/client'
import { applications, companies, jobListings, resumes, roles } from '../api/resources'
import type { Application, ApplicationChoices, Company, JobListing, Resume, Role } from '../api/types'
import { useCelebrate } from '../celebrate/context'
import { movedForward } from '../lib/pipeline'
import { Button } from './ui/Button'
import { Combobox, MultiSelect, type Option } from './ui/Combobox'
import { Input, Select } from './ui/Field'
import { MentionTextarea } from './ui/Mention'
import { Modal } from './ui/Modal'
import { useToast } from './ui/toast-context'
import { today } from '../lib/format'

type Props = {
  open: boolean
  onClose: () => void
  onSaved: (application: Application) => void
  choices: ApplicationChoices | null
  existing?: Application | null
}

function initialForm(existing?: Application | null) {
  return {
    company: (existing?.company ?? null) as number | null,
    stage: existing?.stage ?? 'applied',
    outcome: existing?.outcome ?? 'in_progress',
    applied_at: existing?.applied_at ?? today(),
    source: existing?.source ?? '',
    resume: (existing?.resume ?? null) as number | null,
    follow_up_date: existing?.follow_up_date ?? '',
    reapply_at: existing?.reapply_at ?? '',
    notes: existing?.notes ?? '',
    event_note: '',
  }
}

/**
 * The dialog body only mounts while it is open, so its form state is seeded
 * once from `existing` and thrown away on close — no effect syncing props into
 * state, and no stale values on the next open.
 */
export function ApplicationForm(props: Props) {
  if (!props.open) return null
  return <ApplicationFormBody {...props} />
}

function ApplicationFormBody({ open, onClose, onSaved, choices, existing }: Props) {
  const { notify } = useToast()
  const celebrate = useCelebrate()
  const [form, setForm] = useState(() => initialForm(existing))
  const [listingIds, setListingIds] = useState<number[]>(
    () => existing?.listing_links.map((link) => link.job_listing) ?? [],
  )
  const [error, setError] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const [companyOptions, setCompanyOptions] = useState<Company[]>([])
  const [roleOptions, setRoleOptions] = useState<Role[]>([])
  const [resumeOptions, setResumeOptions] = useState<Resume[]>([])
  const [listings, setListings] = useState<JobListing[]>([])
  const [creatingListing, setCreatingListing] = useState(false)
  const [newRole, setNewRole] = useState<number | null>(null)

  // Load the pickers once the dialog mounts, not on every page render.
  useEffect(() => {
    void Promise.all([
      companies.list(),
      roles.list(),
      resumes.list({ is_active: true }),
      jobListings.list(),
    ]).then(([companyRows, roleRows, resumeRows, listingRows]) => {
      setCompanyOptions(companyRows)
      setRoleOptions(roleRows)
      setResumeOptions(resumeRows)
      setListings(listingRows)
    })
  }, [])

  // FR-APP-03: only this company's listings can be attached.
  const companyListings = useMemo<Option[]>(
    () =>
      listings
        .filter((listing) => listing.company === form.company)
        .map((listing) => ({
          id: listing.id,
          label: listing.role_name,
          hint: listing.location_name ?? undefined,
        })),
    [listings, form.company],
  )

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  /** Picking a role here — existing or just created — adds it immediately,
      rather than staging it in the combobox for a separate "Add" click.
      That second click was too easy to skip: the role itself is real the
      moment it's chosen (it already shows up under Job Directory → Roles),
      which reads as "done" even though nothing had been attached to this
      application yet — the combobox just quietly went back to empty on
      submit, with Roles Covered still at 0. */
  async function addListing(roleId: number) {
    if (!form.company) return
    const existingMatch = listings.find(
      (listing) => listing.company === form.company && listing.role === roleId,
    )
    if (existingMatch) {
      setListingIds((prev) => (prev.includes(existingMatch.id) ? prev : [...prev, existingMatch.id]))
      setNewRole(null)
      return
    }
    setCreatingListing(true)
    try {
      const created = await jobListings.create({ company: form.company, role: roleId })
      setListings((prev) => [...prev, created])
      setListingIds((prev) => [...prev, created.id])
    } catch (err) {
      notify(formatApiError(err), 'error')
    } finally {
      setCreatingListing(false)
      setNewRole(null)
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!form.company) {
      setErrors({ company: 'Pick a company.' })
      return
    }
    setSaving(true)
    setError('')
    setErrors({})

    const payload = {
      ...form,
      company: form.company,
      follow_up_date: form.follow_up_date || null,
      reapply_at: form.reapply_at || null,
      resume: form.resume,
      listing_ids: listingIds,
    }

    try {
      const saved = existing
        ? await applications.update(existing.id, payload)
        : await applications.create(payload)

      // FR-FX-03 — only genuine forward movement, never a plain edit.
      if (!existing) celebrate('application')
      else if (movedForward(existing.stage, saved.stage, choices)) celebrate('stage')

      notify(existing ? 'Application updated.' : 'Application logged.')
      onSaved(saved)
      onClose()
    } catch (err) {
      setError(formatApiError(err))
      setErrors(fieldErrors(err))
    } finally {
      setSaving(false)
    }
  }

  const stageChanged = existing ? form.stage !== existing.stage || form.outcome !== existing.outcome : false

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={existing ? 'Edit application' : 'Log an application'}
      description={
        existing
          ? 'Stage and outcome changes are appended to this application’s history.'
          : 'One application per company — add every role it covers below.'
      }
      footer={
        <>
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="application-form" variant="primary" loading={saving}>
            {existing ? 'Save changes' : 'Log application'}
          </Button>
        </>
      }
    >
      <form id="application-form" onSubmit={onSubmit} className="flex flex-col gap-4">
        {error ? (
          <p role="alert" className="rounded-lg border border-critical/25 bg-critical/10 px-3 py-2 text-[13px] text-ink">
            {error}
          </p>
        ) : null}

        <Combobox
          label="Company"
          required
          value={form.company}
          error={errors.company}
          options={companyOptions.map((company) => ({ id: company.id, label: company.name }))}
          onChange={(id) => {
            set('company', id)
            setListingIds([])
          }}
          onCreate={async (name) => {
            const created = await companies.ensure({ name })
            setCompanyOptions((prev) =>
              prev.some((entry) => entry.id === created.id) ? prev : [...prev, created],
            )
            return { id: created.id, label: created.name }
          }}
          placeholder="Search or add a company…"
          help="Not in the list? Type a name and create it inline."
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Stage"
            value={form.stage}
            error={errors.stage}
            onChange={(event) => set('stage', event.target.value)}
          >
            {choices?.stage.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </Select>
          <Select
            label="Outcome"
            value={form.outcome}
            error={errors.outcome}
            onChange={(event) => set('outcome', event.target.value)}
          >
            {choices?.outcome.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </Select>
        </div>

        {stageChanged ? (
          <Input
            label="What changed?"
            placeholder="e.g. Invited to the assessment centre"
            value={form.event_note}
            onChange={(event) => set('event_note', event.target.value)}
            help="Saved with this transition in the application’s history."
          />
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Applied on"
            type="date"
            required
            value={form.applied_at}
            error={errors.applied_at}
            onChange={(event) => set('applied_at', event.target.value)}
          />
          <Input
            label="Follow up on"
            type="date"
            value={form.follow_up_date}
            error={errors.follow_up_date}
            onChange={(event) => set('follow_up_date', event.target.value)}
            help="Surfaces on the dashboard when it comes due."
          />
        </div>

        <Input
          label="Reapply reminder"
          type="date"
          value={form.reapply_at}
          error={errors.reapply_at}
          onChange={(event) => set('reapply_at', event.target.value)}
          help="For a rejection you might revisit — e.g. next year's intake. Shows on the calendar."
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Source"
            placeholder="LinkedIn, referral, careers site…"
            value={form.source}
            error={errors.source}
            onChange={(event) => set('source', event.target.value)}
          />
          <Combobox
            label="Resume used"
            value={form.resume}
            error={errors.resume}
            options={resumeOptions.map((resume) => ({
              id: resume.id,
              label: resume.label,
              hint: resume.variant_type_display,
            }))}
            onChange={(id) => set('resume', id)}
            placeholder="Pick from your library…"
          />
        </div>

        <div>
          <MultiSelect
            label="Roles covered by this application"
            options={companyListings}
            value={listingIds}
            onChange={setListingIds}
            emptyText={
              form.company
                ? 'No listings for this company yet — add one below.'
                : 'Pick a company first.'
            }
            help="One application can cover several roles at the same company."
          />
          {errors.listing_ids ? (
            <p className="mt-1 text-[12px] text-critical">{errors.listing_ids}</p>
          ) : null}

          {form.company ? (
            <div className="mt-2">
              <Combobox
                value={newRole}
                options={roleOptions.map((role) => ({ id: role.id, label: role.name }))}
                onChange={(id) => {
                  setNewRole(id)
                  if (id !== null) void addListing(id)
                }}
                onCreate={async (name) => {
                  const created = await roles.ensure({ name })
                  setRoleOptions((prev) =>
                    prev.some((entry) => entry.id === created.id) ? prev : [...prev, created],
                  )
                  return { id: created.id, label: created.name }
                }}
                placeholder={
                  creatingListing ? 'Adding…' : 'Add a role to this company…'
                }
                disabled={creatingListing}
              />
            </div>
          ) : null}
        </div>

        <MentionTextarea
          label="Notes"
          rows={3}
          value={form.notes}
          error={errors.notes}
          onChange={(value) => set('notes', value)}
          placeholder="Anything worth remembering about this application… (@ to tag a contact, company or place)"
        />
      </form>
    </Modal>
  )
}
