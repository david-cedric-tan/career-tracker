import { useEffect, useState, type FormEvent } from 'react'
import { fieldErrors, formatApiError } from '../api/client'
import { companies, resumes, roles } from '../api/resources'
import type { Company, Resume, Role } from '../api/types'
import { PageHeader } from '../components/layout/PageHeader'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { MultiSelect } from '../components/ui/Combobox'
import { Checkbox, Input, Label, Select } from '../components/ui/Field'
import { MentionTextarea } from '../components/ui/Mention'
import { FilePicker } from '../components/ui/FilePicker'
import { Icon } from '../components/ui/Icon'
import { Modal } from '../components/ui/Modal'
import { EmptyState, ErrorState, Loading, Refreshing } from '../components/ui/States'
import { useToast } from '../components/ui/toast-context'
import { useAutoOpenFromQuery } from '../hooks/useAutoOpenFromQuery'
import { useResource } from '../hooks/useResource'
import { cx, formatDate } from '../lib/format'

const VARIANTS = [
  { value: 'general', label: 'General' },
  { value: 'company', label: 'Company-specific' },
  { value: 'role', label: 'Role-specific' },
]

export function ResumesPage() {
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Resume | null>(null)
  const [showArchived, setShowArchived] = useState(false)

  // The onboarding tour's "try it" action for this page — `?new=1` opens the
  // same form the "Add resume" button does.
  useAutoOpenFromQuery('new', () => {
    setEditing(null)
    setFormOpen(true)
  })

  const list = useResource(
    () => resumes.list(showArchived ? {} : { is_active: true }),
    [showArchived],
  )

  const rows = list.data ?? []

  return (
    <>
      <PageHeader
        title="My Resumes"
        subtitle="Your resumes live here, and applications point at one of them."
        action={
          <Button
            variant="primary"
            onClick={() => {
              setEditing(null)
              setFormOpen(true)
            }}
            icon={<Icon name="plus" size={16} />}
          >
            Add resume
          </Button>
        }
      />

      <div className="mb-4">
        <Checkbox
          label="Include archived"
          checked={showArchived}
          onChange={(event) => setShowArchived(event.target.checked)}
        />
      </div>

      {list.initial ? (
        <Loading />
      ) : list.error && !list.data ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : rows.length === 0 ? (
        <Card padded={false}>
          <EmptyState
            icon="file"
            title="No resumes yet"
            description="Add the versions you send out — general, company-tailored or role-tailored."
            action={
              <Button
                variant="primary"
                onClick={() => {
                  setEditing(null)
                  setFormOpen(true)
                }}
                icon={<Icon name="plus" size={16} />}
              >
                Add resume
              </Button>
            }
          />
        </Card>
      ) : (
        <Refreshing active={list.loading && !list.initial}>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {rows.map((resume) => (
              <li key={resume.id}>
                <Card
                  className={cx(
                    'flex h-full flex-col',
                    !resume.is_active && 'opacity-70',
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink">{resume.label}</p>
                      <p className="mt-0.5 text-[12px] text-ink-3">
                        Updated {formatDate(resume.updated_at.slice(0, 10))}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(resume)
                        setFormOpen(true)
                      }}
                      aria-label={`Edit ${resume.label}`}
                      className="rounded-lg p-1.5 text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
                    >
                      <Icon name="edit" size={15} />
                    </button>
                  </div>

                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    <Badge tone="brand">{resume.variant_type_display}</Badge>
                    {resume.is_active ? null : <Badge>Archived</Badge>}
                    <Badge>
                      {resume.application_count} application
                      {resume.application_count === 1 ? '' : 's'}
                    </Badge>
                  </div>

                  {resume.target_company_names.length || resume.target_role_names.length ? (
                    <p className="mt-3 text-[12.5px] text-ink-3">
                      Tailored for{' '}
                      <span className="text-ink-2">
                        {[...resume.target_company_names, ...resume.target_role_names].join(', ')}
                      </span>
                    </p>
                  ) : null}

                  {resume.notes ? (
                    <p className="mt-3 line-clamp-3 text-[12.5px] text-ink-2">{resume.notes}</p>
                  ) : null}

                  <div className="mt-auto pt-3">
                    {resume.file ? (
                      <a
                        href={resume.file}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-2.5 py-2 transition-colors hover:border-brand-ring hover:bg-brand-soft"
                      >
                        <Icon name="file" size={15} className="shrink-0 text-brand" />
                        <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">
                          {resume.file_name || 'Attachment'}
                        </span>
                        <Badge tone="brand">{resume.file_kind}</Badge>
                      </a>
                    ) : (
                      <p className="text-[12px] text-ink-3">No file attached</p>
                    )}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </Refreshing>
      )}

      <ResumeForm
        open={formOpen}
        existing={editing}
        onClose={() => setFormOpen(false)}
        onSaved={() => list.reload()}
      />
    </>
  )
}

type ResumeFormProps = {
  open: boolean
  onClose: () => void
  onSaved: () => void
  existing?: Resume | null
}

/** Body mounts only while open, so its state is seeded once and never synced. */
function ResumeForm(props: ResumeFormProps) {
  if (!props.open) return null
  return <ResumeFormBody {...props} />
}

function ResumeFormBody({ open, onClose, onSaved, existing }: ResumeFormProps) {
  const { notify } = useToast()
  // The file endpoint is keyed by id, so a brand-new resume can't take an
  // attachment until it's been saved once.
  const [current, setCurrent] = useState<Resume | null>(existing ?? null)
  const [form, setForm] = useState(() => ({
    label: existing?.label ?? '',
    variant_type: (existing?.variant_type ?? 'general') as Resume['variant_type'],
    notes: existing?.notes ?? '',
    is_active: existing?.is_active ?? true,
  }))
  const [targetCompanies, setTargetCompanies] = useState<number[]>(
    () => existing?.target_companies ?? [],
  )
  const [targetRoles, setTargetRoles] = useState<number[]>(() => existing?.target_roles ?? [])
  const [companyOptions, setCompanyOptions] = useState<Company[]>([])
  const [roleOptions, setRoleOptions] = useState<Role[]>([])
  const [error, setError] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void Promise.all([companies.list(), roles.list()]).then(([companyRows, roleRows]) => {
      setCompanyOptions(companyRows)
      setRoleOptions(roleRows)
    })
  }, [])

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setErrors({})
    const payload = {
      ...form,
      target_companies: targetCompanies,
      target_roles: targetRoles,
    }
    try {
      const saved = existing
        ? await resumes.update(existing.id, payload)
        : await resumes.create(payload)
      setCurrent(saved)
      notify(existing ? 'Resume updated.' : 'Resume added.')
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
      await resumes.remove(existing.id)
      notify('Resume deleted.')
      onSaved()
      onClose()
    } catch (err) {
      notify(formatApiError(err), 'error')
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={existing ? 'Edit resume' : 'Add a resume'}
      description="Labels are unique to you — pick something you'll recognise later."
      footer={
        <>
          {existing ? (
            <Button variant="danger" onClick={() => void remove()} className="mr-auto">
              Delete
            </Button>
          ) : null}
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="resume-form" variant="primary" loading={saving}>
            {existing ? 'Save changes' : 'Add resume'}
          </Button>
        </>
      }
    >
      <form id="resume-form" onSubmit={onSubmit} className="flex flex-col gap-4">
        {error ? (
          <p role="alert" className="rounded-lg border border-critical/25 bg-critical/10 px-3 py-2 text-[13px] text-ink">
            {error}
          </p>
        ) : null}

        <Input
          label="Label"
          required
          autoFocus
          placeholder="ey-vac-2026"
          value={form.label}
          error={errors.label}
          onChange={(event) => setForm((prev) => ({ ...prev, label: event.target.value }))}
        />

        <Select
          label="Variant"
          value={form.variant_type}
          onChange={(event) =>
            setForm((prev) => ({
              ...prev,
              variant_type: event.target.value as Resume['variant_type'],
            }))
          }
        >
          {VARIANTS.map((variant) => (
            <option key={variant.value} value={variant.value}>
              {variant.label}
            </option>
          ))}
        </Select>

        <div className="grid gap-4 sm:grid-cols-2">
          <MultiSelect
            label="Target companies"
            options={companyOptions.map((company) => ({ id: company.id, label: company.name }))}
            value={targetCompanies}
            onChange={setTargetCompanies}
            emptyText="No companies yet."
          />
          <MultiSelect
            label="Target roles"
            options={roleOptions.map((role) => ({ id: role.id, label: role.name }))}
            value={targetRoles}
            onChange={setTargetRoles}
            emptyText="No roles yet."
          />
        </div>

        <MentionTextarea
          label="Notes"
          value={form.notes}
          error={errors.notes}
          onChange={(value) => setForm((prev) => ({ ...prev, notes: value }))}
          placeholder="What's different about this version… (@ to tag a contact, company or place)"
        />

        <Checkbox
          label="Active (uncheck to archive)"
          checked={form.is_active}
          onChange={(event) =>
            setForm((prev) => ({ ...prev, is_active: event.target.checked }))
          }
        />

        <div>
          <Label>Attachment</Label>
          {current ? (
            <FilePicker
              url={current.file}
              name={current.file_name}
              kind={current.file_kind}
              size={current.file_size}
              onUpload={async (file) => {
                setCurrent(await resumes.uploadFile(current.id, file))
                onSaved()
              }}
              onRemove={async () => {
                setCurrent(await resumes.removeFile(current.id))
                onSaved()
              }}
            />
          ) : (
            <p className="rounded-lg border border-dashed border-line-strong bg-surface-2 p-3 text-[12.5px] text-ink-3">
              Save this resume first, then attach the PDF, Word or Pages file.
            </p>
          )}
        </div>
      </form>
    </Modal>
  )
}
