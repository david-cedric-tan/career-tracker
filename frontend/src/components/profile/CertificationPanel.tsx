import { useEffect, useState, type FormEvent } from 'react'
import { fieldErrors, formatApiError } from '../../api/client'
import { certifications } from '../../api/resources'
import type { Certification } from '../../api/types'
import { formatDate } from '../../lib/format'
import { AttachmentGalleryDialog, AttachmentStrip } from './AttachmentGallery'
import { SectionIconPicker } from './SectionIconPicker'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Card, CardHeader } from '../ui/Card'
import { Input, Textarea } from '../ui/Field'
import { Icon } from '../ui/Icon'
import { Modal } from '../ui/Modal'
import { EmptyState, Loading } from '../ui/States'
import { useToast } from '../ui/toast-context'

/** FR-PROF-12 — credentials, each with attachments (the certificate itself). */
export function CertificationPanel() {
  const [rows, setRows] = useState<Certification[] | null>(null)
  const [error, setError] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Certification | null>(null)
  const [galleryId, setGalleryId] = useState<number | null>(null)
  const gallery = rows?.find((row) => row.id === galleryId) ?? null

  function reload() {
    return certifications.list().then(setRows)
  }

  function apply(saved: Certification) {
    setRows((current) => (current ?? []).map((entry) => (entry.id === saved.id ? saved : entry)))
  }

  useEffect(() => {
    reload().catch((err) => setError(formatApiError(err)))
  }, [])

  return (
    <Card>
      <CardHeader
        title="Certifications"
        subtitle="Credentials and licences."
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
        <EmptyState icon="file" title="No certifications yet" className="py-8" />
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {rows.map((row) => (
            <li key={row.id} className="rounded-lg border border-line bg-surface-2 p-3">
              <div className="flex items-start gap-2.5">
                <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-lg border border-line bg-surface">
                  {row.icon ? (
                    <img src={row.icon} alt="" loading="lazy" className="size-full object-contain p-1" />
                  ) : (
                    <Icon name="file" size={16} className="text-ink-3" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate text-[13.5px] font-medium text-ink">
                    {row.name}
                    {row.is_expired ? <Badge tone="critical">Expired</Badge> : null}
                  </p>
                  <p className="truncate text-[12px] text-ink-3">
                    {row.issuer}
                    {row.issuer && (row.issued_on || row.expires_on) ? ' · ' : ''}
                    {row.issued_on ? formatDate(row.issued_on) : ''}
                    {row.expires_on ? ` — expires ${formatDate(row.expires_on)}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(row)
                    setFormOpen(true)
                  }}
                  aria-label={`Edit ${row.name}`}
                  className="shrink-0 rounded-lg p-1.5 text-ink-3 transition-colors hover:bg-surface hover:text-ink"
                >
                  <Icon name="edit" size={14} />
                </button>
              </div>

              {row.credential_url ? (
                <a
                  href={row.credential_url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="mt-1 inline-flex items-center gap-1 text-[12px] text-brand hover:underline"
                >
                  <Icon name="link" size={12} />
                  Credential link
                </a>
              ) : null}

              {row.description ? (
                <p className="mt-2 text-[12.5px] text-ink-2">{row.description}</p>
              ) : null}

              <AttachmentStrip attachments={row.attachments} onOpen={() => setGalleryId(row.id)} />
            </li>
          ))}
        </ul>
      )}

      <CertificationForm
        open={formOpen}
        existing={editing}
        onClose={() => setFormOpen(false)}
        onSaved={() => void reload()}
        onDeleted={() => void reload()}
        onRowChange={apply}
      />

      {gallery ? (
        <AttachmentGalleryDialog
          title={gallery.name}
          attachments={gallery.attachments}
          onClose={() => setGalleryId(null)}
          onAdd={async (file, caption) => apply(await certifications.addAttachment(gallery.id, file, caption))}
          onRemove={async (attachmentId) =>
            apply(await certifications.removeAttachment(gallery.id, attachmentId))
          }
        />
      ) : null}
    </Card>
  )
}

function CertificationForm(props: {
  open: boolean
  onClose: () => void
  onSaved: () => void
  onDeleted: () => void
  onRowChange: (saved: Certification) => void
  existing?: Certification | null
}) {
  if (!props.open) return null
  return <CertificationFormBody {...props} />
}

function CertificationFormBody({
  onClose,
  onSaved,
  onDeleted,
  onRowChange,
  existing,
}: {
  onClose: () => void
  onSaved: () => void
  onDeleted: () => void
  onRowChange: (saved: Certification) => void
  existing?: Certification | null
}) {
  const { notify } = useToast()
  const [row, setRow] = useState<Certification | null>(existing ?? null)
  const [pendingIcon, setPendingIcon] = useState<File | null>(null)
  const [form, setForm] = useState(() => ({
    name: existing?.name ?? '',
    issuer: existing?.issuer ?? '',
    issued_on: existing?.issued_on ?? '',
    expires_on: existing?.expires_on ?? '',
    credential_url: existing?.credential_url ?? '',
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
    const payload = {
      ...form,
      issued_on: form.issued_on || null,
      expires_on: form.expires_on || null,
    }
    try {
      if (existing) {
        await certifications.update(existing.id, payload)
      } else {
        const created = await certifications.create(payload)
        if (pendingIcon) await certifications.uploadIcon(created.id, pendingIcon)
      }
      notify(existing ? 'Certification updated.' : 'Certification added.')
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
      await certifications.remove(existing.id)
      notify('Certification deleted.')
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
      title={existing ? 'Edit certification' : 'Add certification'}
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
          <Button type="submit" form="certification-form" variant="primary" loading={saving}>
            {existing ? 'Save' : 'Add'}
          </Button>
        </>
      }
    >
      <form id="certification-form" onSubmit={onSubmit} className="flex flex-col gap-4">
        {error ? (
          <p role="alert" className="rounded-lg border border-critical/25 bg-critical/10 px-3 py-2 text-[13px] text-ink">
            {error}
          </p>
        ) : null}

        <SectionIconPicker
          name={form.name || 'Certification'}
          label="issuer logo"
          row={row}
          api={certifications}
          onRowChange={(saved) => {
            setRow(saved)
            onRowChange(saved)
          }}
          onPending={setPendingIcon}
        />

        <Input
          label="Name"
          required
          autoFocus
          placeholder="AWS Cloud Practitioner"
          value={form.name}
          error={errors.name}
          onChange={(event) => set('name', event.target.value)}
        />
        <Input
          label="Issuer"
          placeholder="Amazon Web Services"
          value={form.issuer}
          error={errors.issuer}
          onChange={(event) => set('issuer', event.target.value)}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label="Issued"
            type="date"
            value={form.issued_on}
            error={errors.issued_on}
            onChange={(event) => set('issued_on', event.target.value)}
          />
          <Input
            label="Expires"
            type="date"
            value={form.expires_on}
            error={errors.expires_on}
            onChange={(event) => set('expires_on', event.target.value)}
            help="Blank = doesn't expire"
          />
        </div>
        <Input
          label="Credential URL"
          type="url"
          placeholder="https://…"
          value={form.credential_url}
          error={errors.credential_url}
          onChange={(event) => set('credential_url', event.target.value)}
        />
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
