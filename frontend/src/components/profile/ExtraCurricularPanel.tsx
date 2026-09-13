import { useEffect, useState, type FormEvent } from 'react'
import { fieldErrors, formatApiError } from '../../api/client'
import { extracurriculars } from '../../api/resources'
import type { ExtraCurricular } from '../../api/types'
import { formatDate } from '../../lib/format'
import { AttachmentGalleryDialog, AttachmentStrip } from './AttachmentGallery'
import { SectionIconPicker } from './SectionIconPicker'
import { Button } from '../ui/Button'
import { Card, CardHeader } from '../ui/Card'
import { Input, Textarea } from '../ui/Field'
import { Icon } from '../ui/Icon'
import { Modal } from '../ui/Modal'
import { EmptyState, Loading } from '../ui/States'
import { useToast } from '../ui/toast-context'

/** FR-PROF-11 — clubs, societies and volunteering. */
export function ExtraCurricularPanel() {
  const [rows, setRows] = useState<ExtraCurricular[] | null>(null)
  const [error, setError] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<ExtraCurricular | null>(null)
  const [galleryId, setGalleryId] = useState<number | null>(null)
  const gallery = rows?.find((row) => row.id === galleryId) ?? null

  function reload() {
    return extracurriculars.list().then(setRows)
  }

  function apply(saved: ExtraCurricular) {
    setRows((current) => (current ?? []).map((entry) => (entry.id === saved.id ? saved : entry)))
  }

  useEffect(() => {
    reload().catch((err) => setError(formatApiError(err)))
  }, [])

  return (
    <Card>
      <CardHeader
        title="Extra-curriculars"
        subtitle="Clubs, societies and volunteering."
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
        <EmptyState icon="users" title="Nothing added yet" className="py-8" />
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {rows.map((row) => (
            <li key={row.id} className="rounded-lg border border-line bg-surface-2 p-3">
              <div className="flex items-start gap-2.5">
                <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-lg border border-line bg-surface">
                  {row.icon ? (
                    <img src={row.icon} alt="" loading="lazy" className="size-full object-contain p-1" />
                  ) : (
                    <Icon name="users" size={16} className="text-ink-3" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-medium text-ink">
                    {row.organization}
                  </p>
                  <p className="truncate text-[12px] text-ink-3">
                    {row.role ? `${row.role} · ` : ''}
                    {formatDate(row.started_on)} —{' '}
                    {row.is_current ? 'now' : formatDate(row.ended_on)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(row)
                    setFormOpen(true)
                  }}
                  aria-label={`Edit ${row.organization}`}
                  className="shrink-0 rounded-lg p-1.5 text-ink-3 transition-colors hover:bg-surface hover:text-ink"
                >
                  <Icon name="edit" size={14} />
                </button>
              </div>

              {row.description ? (
                <p className="mt-2 text-[12.5px] text-ink-2">{row.description}</p>
              ) : null}

              <AttachmentStrip attachments={row.attachments} onOpen={() => setGalleryId(row.id)} />
            </li>
          ))}
        </ul>
      )}

      <ExtraCurricularForm
        open={formOpen}
        existing={editing}
        onClose={() => setFormOpen(false)}
        onSaved={() => void reload()}
        onDeleted={() => void reload()}
        onRowChange={apply}
      />

      {gallery ? (
        <AttachmentGalleryDialog
          title={gallery.organization}
          attachments={gallery.attachments}
          onClose={() => setGalleryId(null)}
          onAdd={async (file, caption) =>
            apply(await extracurriculars.addAttachment(gallery.id, file, caption))
          }
          onRemove={async (attachmentId) =>
            apply(await extracurriculars.removeAttachment(gallery.id, attachmentId))
          }
        />
      ) : null}
    </Card>
  )
}

function ExtraCurricularForm(props: {
  open: boolean
  onClose: () => void
  onSaved: () => void
  onDeleted: () => void
  onRowChange: (saved: ExtraCurricular) => void
  existing?: ExtraCurricular | null
}) {
  if (!props.open) return null
  return <ExtraCurricularFormBody {...props} />
}

function ExtraCurricularFormBody({
  onClose,
  onSaved,
  onDeleted,
  onRowChange,
  existing,
}: {
  onClose: () => void
  onSaved: () => void
  onDeleted: () => void
  onRowChange: (saved: ExtraCurricular) => void
  existing?: ExtraCurricular | null
}) {
  const { notify } = useToast()
  const [row, setRow] = useState<ExtraCurricular | null>(existing ?? null)
  const [pendingIcon, setPendingIcon] = useState<File | null>(null)
  const [form, setForm] = useState(() => ({
    organization: existing?.organization ?? '',
    role: existing?.role ?? '',
    started_on: existing?.started_on ?? '',
    ended_on: existing?.ended_on ?? '',
    description: existing?.description ?? '',
  }))
  const [error, setError] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setErrors({})
    const payload = { ...form, ended_on: form.ended_on || null }
    try {
      if (existing) {
        await extracurriculars.update(existing.id, payload)
      } else {
        const created = await extracurriculars.create(payload)
        if (pendingIcon) await extracurriculars.uploadIcon(created.id, pendingIcon)
      }
      notify(existing ? 'Updated.' : 'Added.')
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
      await extracurriculars.remove(existing.id)
      notify('Deleted.')
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
      title={existing ? 'Edit extra-curricular' : 'Add extra-curricular'}
      description="Leave the end date blank if you're still involved."
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
          <Button type="submit" form="extracurricular-form" variant="primary" loading={saving}>
            {existing ? 'Save' : 'Add'}
          </Button>
        </>
      }
    >
      <form id="extracurricular-form" onSubmit={onSubmit} className="flex flex-col gap-4">
        {error ? (
          <p role="alert" className="rounded-lg border border-critical/25 bg-critical/10 px-3 py-2 text-[13px] text-ink">
            {error}
          </p>
        ) : null}

        <SectionIconPicker
          name={form.organization || 'Organisation'}
          label="badge"
          row={row}
          api={extracurriculars}
          onRowChange={(saved) => {
            setRow(saved)
            onRowChange(saved)
          }}
          onPending={setPendingIcon}
        />

        <Input
          label="Organization"
          required
          autoFocus
          placeholder="Debate Society"
          value={form.organization}
          error={errors.organization}
          onChange={(event) => set('organization', event.target.value)}
        />
        <Input
          label="Role"
          placeholder="President"
          value={form.role}
          error={errors.role}
          onChange={(event) => set('role', event.target.value)}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
        />
      </form>
    </Modal>
  )
}
