import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { fieldErrors, formatApiError } from '../api/client'
import { companies, experiences } from '../api/resources'
import type { Company, Experience } from '../api/types'
import { useCelebrate } from '../celebrate/context'
import { cx, formatDate } from '../lib/format'
import { Button, Spinner } from './ui/Button'
import { Card, CardHeader } from './ui/Card'
import { Combobox } from './ui/Combobox'
import { Input, Textarea } from './ui/Field'
import { Icon } from './ui/Icon'
import { Modal } from './ui/Modal'
import { EmptyState, Loading } from './ui/States'
import { useToast } from './ui/toast-context'

const MAX_BYTES = 5 * 1024 * 1024

/**
 * The user's work history, each entry with its own photo gallery (FR-EXP-*).
 *
 * Companies come from the shared catalog rather than free text, so an
 * experience lines up with applications and contacts at the same employer.
 */
export function ExperiencePanel() {
  const { notify } = useToast()
  const [rows, setRows] = useState<Experience[] | null>(null)
  const [error, setError] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Experience | null>(null)
  const [viewing, setViewing] = useState<Experience | null>(null)

  useEffect(() => {
    experiences
      .list()
      .then(setRows)
      .catch((err) => setError(formatApiError(err)))
  }, [])

  function reload() {
    return experiences.list().then(setRows)
  }

  /** Keep the open gallery in step with the row it came from. */
  function apply(saved: Experience) {
    setRows((current) =>
      (current ?? []).map((row) => (row.id === saved.id ? saved : row)),
    )
    setViewing((current) => (current && current.id === saved.id ? saved : current))
  }

  return (
    <Card>
      <CardHeader
        title="Experience"
        subtitle="Where you've worked, with a gallery per role."
        action={
          <Button
            size="sm"
            onClick={() => {
              setEditing(null)
              setFormOpen(true)
            }}
            icon={<Icon name="plus" size={14} />}
          >
            Add
          </Button>
        }
      />

      {error ? (
        <p className="mt-3 text-[13px] text-critical">{error}</p>
      ) : rows === null ? (
        <Loading />
      ) : rows.length === 0 ? (
        <EmptyState
          icon="building"
          title="No experience yet"
          description="Add the companies you work or have worked for."
          className="py-8"
        />
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {rows.map((experience) => (
            <li key={experience.id}>
              <ExperienceRow
                experience={experience}
                onEdit={() => {
                  setEditing(experience)
                  setFormOpen(true)
                }}
                onOpenGallery={() => setViewing(experience)}
              />
            </li>
          ))}
        </ul>
      )}

      <ExperienceForm
        open={formOpen}
        existing={editing}
        onClose={() => setFormOpen(false)}
        onSaved={() => void reload()}
        onDeleted={() => {
          setViewing(null)
          void reload()
        }}
      />

      {viewing ? (
        <GalleryDialog
          experience={viewing}
          onClose={() => setViewing(null)}
          onChanged={apply}
          notify={notify}
        />
      ) : null}
    </Card>
  )
}

function ExperienceRow({
  experience,
  onEdit,
  onOpenGallery,
}: {
  experience: Experience
  onEdit: () => void
  onOpenGallery: () => void
}) {
  const period = `${formatDate(experience.started_on)} — ${
    experience.ended_on ? formatDate(experience.ended_on) : 'now'
  }`

  return (
    <div className="rounded-lg border border-line bg-surface-2 p-3">
      <div className="flex items-start gap-2.5">
        <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-lg border border-line bg-surface">
          {experience.company_logo ? (
            <img
              src={experience.company_logo}
              alt=""
              loading="lazy"
              className="size-full object-contain p-1"
            />
          ) : (
            <Icon name="building" size={16} className="text-ink-3" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-medium text-ink">
            {experience.title}
          </p>
          <p className="truncate text-[12px] text-ink-3">
            {experience.company_name} · {period}
          </p>
        </div>

        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit ${experience.title}`}
          className="shrink-0 rounded-lg p-1.5 text-ink-3 transition-colors hover:bg-surface hover:text-ink"
        >
          <Icon name="edit" size={14} />
        </button>
      </div>

      {experience.description ? (
        <p className="mt-2 line-clamp-2 text-[12.5px] text-ink-2">
          {experience.description}
        </p>
      ) : null}

      <button
        type="button"
        onClick={onOpenGallery}
        className="mt-2.5 flex w-full items-center gap-2 rounded-lg border border-line bg-surface px-2 py-1.5 text-left transition-colors hover:border-line-strong"
      >
        {experience.photos.length ? (
          <span className="flex -space-x-2">
            {experience.photos.slice(0, 4).map((photo) => (
              <img
                key={photo.id}
                src={photo.image}
                alt=""
                loading="lazy"
                className="size-7 rounded-md object-cover ring-2 ring-surface"
              />
            ))}
          </span>
        ) : (
          <span className="grid size-7 place-items-center rounded-md border border-dashed border-line-strong text-ink-3">
            <Icon name="plus" size={13} />
          </span>
        )}
        <span className="flex-1 text-[12px] text-ink-2">
          {experience.photos.length
            ? `${experience.photos.length} photo${experience.photos.length === 1 ? '' : 's'}`
            : 'Add photos'}
        </span>
        <Icon name="chevronRight" size={14} className="text-ink-3" />
      </button>
    </div>
  )
}

function GalleryDialog({
  experience,
  onClose,
  onChanged,
  notify,
}: {
  experience: Experience
  onClose: () => void
  onChanged: (experience: Experience) => void
  notify: (message: string, tone?: 'success' | 'error' | 'info') => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [caption, setCaption] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [lightbox, setLightbox] = useState<string | null>(null)

  async function onPick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setError('')
    if (!file.type.startsWith('image/')) {
      setError('Pick an image file.')
      return
    }
    if (file.size > MAX_BYTES) {
      setError(`That image is ${(file.size / 1024 / 1024).toFixed(1)}MB. The limit is 5MB.`)
      return
    }

    setBusy(true)
    try {
      onChanged(await experiences.addPhoto(experience.id, file, caption.trim()))
      setCaption('')
    } catch (err) {
      setError(formatApiError(err))
    } finally {
      setBusy(false)
    }
  }

  async function remove(photoId: number) {
    setBusy(true)
    try {
      onChanged(await experiences.removePhoto(experience.id, photoId))
      notify('Photo removed.')
    } catch (err) {
      setError(formatApiError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`${experience.title} · ${experience.company_name}`}
      description="Photos from this role."
      footer={<Button onClick={onClose}>Done</Button>}
    >
      <div className="flex flex-col gap-4">
        {error ? (
          <p role="alert" className="rounded-lg border border-critical/25 bg-critical/10 px-3 py-2 text-[13px] text-ink">
            {error}
          </p>
        ) : null}

        <div className="flex items-end gap-2">
          <Input
            label="Caption for the next photo"
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
            placeholder="Optional"
            wrapperClassName="flex-1"
          />
          <Button
            variant="primary"
            onClick={() => inputRef.current?.click()}
            loading={busy}
            icon={<Icon name="plus" size={15} />}
          >
            Add photo
          </Button>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          onChange={onPick}
          className="hidden"
        />

        {experience.photos.length === 0 ? (
          <EmptyState
            icon="file"
            title="No photos yet"
            description="Team offsites, your desk on day one, the grad cohort — whatever you want to keep."
            className="py-8"
          />
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {experience.photos.map((photo) => (
              <li key={photo.id} className="group relative">
                <button
                  type="button"
                  onClick={() => setLightbox(photo.image)}
                  className="block w-full overflow-hidden rounded-lg border border-line"
                  aria-label={photo.caption || 'View photo'}
                >
                  <img
                    src={photo.image}
                    alt={photo.caption}
                    loading="lazy"
                    className="aspect-4/3 w-full object-cover transition-transform group-hover:scale-105"
                  />
                </button>
                <button
                  type="button"
                  onClick={() => void remove(photo.id)}
                  disabled={busy}
                  aria-label={`Remove ${photo.caption || 'photo'}`}
                  className={cx(
                    'absolute right-1.5 top-1.5 grid size-7 place-items-center rounded-lg',
                    'bg-slate-950/60 text-white opacity-0 transition-opacity',
                    'group-hover:opacity-100 focus-visible:opacity-100',
                  )}
                >
                  {busy ? <Spinner className="size-3.5" /> : <Icon name="trash" size={13} />}
                </button>
                {photo.caption ? (
                  <p className="mt-1 truncate text-[11.5px] text-ink-3">{photo.caption}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      {lightbox ? (
        <button
          type="button"
          onClick={() => setLightbox(null)}
          aria-label="Close photo"
          className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/80 p-6"
        >
          <img
            src={lightbox}
            alt=""
            className="max-h-full max-w-full rounded-xl object-contain"
          />
        </button>
      ) : null}
    </Modal>
  )
}

function ExperienceForm({
  open,
  onClose,
  onSaved,
  onDeleted,
  existing,
}: {
  open: boolean
  onClose: () => void
  onSaved: () => void
  onDeleted: () => void
  existing?: Experience | null
}) {
  if (!open) return null
  return (
    <ExperienceFormBody
      onClose={onClose}
      onSaved={onSaved}
      onDeleted={onDeleted}
      existing={existing}
    />
  )
}

function ExperienceFormBody({
  onClose,
  onSaved,
  onDeleted,
  existing,
}: {
  onClose: () => void
  onSaved: () => void
  onDeleted: () => void
  existing?: Experience | null
}) {
  const { notify } = useToast()
  const celebrate = useCelebrate()
  const [form, setForm] = useState(() => ({
    company: (existing?.company ?? null) as number | null,
    title: existing?.title ?? '',
    started_on: existing?.started_on ?? '',
    ended_on: existing?.ended_on ?? '',
    description: existing?.description ?? '',
  }))
  const [companyOptions, setCompanyOptions] = useState<Company[]>([])
  const [error, setError] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void companies.list().then(setCompanyOptions)
  }, [])

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
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

    const payload = { ...form, company: form.company, ended_on: form.ended_on || null }
    try {
      if (existing) {
        await experiences.update(existing.id, payload)
      } else {
        await experiences.create(payload)
        celebrate('experience')
      }
      notify(existing ? 'Experience updated.' : 'Experience added.')
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
      await experiences.remove(existing.id)
      notify('Experience deleted, along with its photos.')
      onDeleted()
      onClose()
    } catch (err) {
      notify(formatApiError(err), 'error')
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={existing ? 'Edit experience' : 'Add experience'}
      description="Leave the end date blank if it's your current role."
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
          <Button type="submit" form="experience-form" variant="primary" loading={saving}>
            {existing ? 'Save' : 'Add'}
          </Button>
        </>
      }
    >
      <form id="experience-form" onSubmit={onSubmit} className="flex flex-col gap-4">
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
          options={companyOptions.map((company) => ({
            id: company.id,
            label: company.name,
          }))}
          onChange={(id) => set('company', id)}
          onCreate={async (name) => {
            const created = await companies.ensure({ name })
            setCompanyOptions((prev) =>
              prev.some((entry) => entry.id === created.id) ? prev : [...prev, created],
            )
            return { id: created.id, label: created.name }
          }}
          placeholder="Search or add a company…"
        />

        <Input
          label="Title"
          required
          placeholder="Vacationer — Technology Consulting"
          value={form.title}
          error={errors.title}
          onChange={(event) => set('title', event.target.value)}
        />

        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Started"
            type="date"
            required
            value={form.started_on}
            error={errors.started_on}
            onChange={(event) => set('started_on', event.target.value)}
          />
          <Input
            label="Ended"
            type="date"
            value={form.ended_on}
            error={errors.ended_on}
            onChange={(event) => set('ended_on', event.target.value)}
            help="Blank = current"
          />
        </div>

        <Textarea
          label="Description"
          value={form.description}
          error={errors.description}
          onChange={(event) => set('description', event.target.value)}
          placeholder="What you did there."
        />
      </form>
    </Modal>
  )
}
