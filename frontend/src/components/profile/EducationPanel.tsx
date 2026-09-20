import { useEffect, useState, type FormEvent } from 'react'
import { fieldErrors, formatApiError } from '../../api/client'
import { education } from '../../api/resources'
import type { Education } from '../../api/types'
import { formatDate } from '../../lib/format'
import { AttachmentList } from './AttachmentList'
import { AttachmentGalleryDialog, AttachmentStrip } from './AttachmentGallery'
import { Button } from '../ui/Button'
import { Card, CardHeader } from '../ui/Card'
import { Input } from '../ui/Field'
import { Icon } from '../ui/Icon'
import { ImagePicker } from '../ui/ImagePicker'
import { MentionTextarea } from '../ui/Mention'
import { Modal } from '../ui/Modal'
import { EmptyState, Loading } from '../ui/States'
import { useToast } from '../ui/toast-context'
import { RichText } from '../../lib/richText'

/** FR-PROF-10 — schools and programmes, each with a school logo and
 *  attachments (transcripts, certificates). List rows mirror Experience:
 *  leading mark, tight spacing, clamped description; file chrome lives in
 *  the edit modal so empty rows stay compact. */
export function EducationPanel() {
  const [rows, setRows] = useState<Education[] | null>(null)
  const [error, setError] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Education | null>(null)
  const [galleryId, setGalleryId] = useState<number | null>(null)
  const gallery = rows?.find((row) => row.id === galleryId) ?? null

  function reload() {
    return education.list().then(setRows)
  }

  useEffect(() => {
    reload().catch((err) => setError(formatApiError(err)))
  }, [])

  function apply(saved: Education) {
    setRows((current) =>
      (current ?? []).map((entry) => (entry.id === saved.id ? saved : entry)),
    )
    setEditing((current) => (current && current.id === saved.id ? saved : current))
  }

  return (
    <Card>
      <CardHeader
        title="Education"
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
          icon="library"
          title="No education yet"
          description="Add the schools and programmes you’ve studied at."
          className="py-8"
        />
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.id} className="rounded-lg border border-line bg-surface-2 p-3">
              <div className="flex items-start gap-2.5">
                <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-lg border border-line bg-surface">
                  {row.icon ? (
                    <img
                      src={row.icon}
                      alt=""
                      loading="lazy"
                      className="size-full object-contain p-1"
                    />
                  ) : (
                    <Icon name="library" size={16} className="text-ink-3" />
                  )}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="break-words text-[13.5px] font-medium text-ink">{row.school}</p>
                  <p className="break-words text-[12px] text-ink-3">
                    {[row.degree, row.field_of_study].filter(Boolean).join(', ')}
                    {row.degree || row.field_of_study ? ' · ' : ''}
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
                  aria-label={`Edit ${row.school}`}
                  className="shrink-0 rounded-lg p-1.5 text-ink-3 transition-colors hover:bg-surface hover:text-ink"
                >
                  <Icon name="edit" size={14} />
                </button>
              </div>

              {row.description ? (
                <RichText text={row.description} className="mt-2 break-words text-[12.5px] text-ink-2" />
              ) : null}

              <AttachmentStrip attachments={row.attachments} onOpen={() => setGalleryId(row.id)} />
            </li>
          ))}
        </ul>
      )}

      {gallery ? (
        <AttachmentGalleryDialog
          title={gallery.school}
          attachments={gallery.attachments}
          onClose={() => setGalleryId(null)}
          onAdd={async (file, caption) => apply(await education.addAttachment(gallery.id, file, caption))}
          onRemove={async (attachmentId) =>
            apply(await education.removeAttachment(gallery.id, attachmentId))
          }
        />
      ) : null}

      <EducationForm
        open={formOpen}
        existing={editing}
        onClose={() => setFormOpen(false)}
        onSaved={(saved) => {
          if (saved) apply(saved)
          else void reload()
        }}
        onDeleted={() => void reload()}
        onRowChange={apply}
      />
    </Card>
  )
}

function EducationForm(props: {
  open: boolean
  onClose: () => void
  onSaved: (saved?: Education) => void
  onDeleted: () => void
  onRowChange: (saved: Education) => void
  existing?: Education | null
}) {
  if (!props.open) return null
  return <EducationFormBody {...props} />
}

function EducationFormBody({
  onClose,
  onSaved,
  onDeleted,
  onRowChange,
  existing,
}: {
  onClose: () => void
  onSaved: (saved?: Education) => void
  onDeleted: () => void
  onRowChange: (saved: Education) => void
  existing?: Education | null
}) {
  const { notify } = useToast()
  const [form, setForm] = useState(() => ({
    school: existing?.school ?? '',
    degree: existing?.degree ?? '',
    field_of_study: existing?.field_of_study ?? '',
    started_on: existing?.started_on ?? '',
    ended_on: existing?.ended_on ?? '',
    description: existing?.description ?? '',
  }))
  const [pendingIcon, setPendingIcon] = useState<File | null>(null)
  const [pendingPreview, setPendingPreview] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [row, setRow] = useState<Education | null>(existing ?? null)

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
      let saved: Education
      if (existing) {
        saved = await education.update(existing.id, payload)
      } else {
        saved = await education.create(payload)
        if (pendingIcon) {
          saved = await education.uploadIcon(saved.id, pendingIcon)
        }
      }
      notify(existing ? 'Education updated.' : 'Education added.')
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
      await education.remove(existing.id)
      notify('Education deleted.')
      onDeleted()
      onClose()
    } catch (err) {
      notify(formatApiError(err), 'error')
    }
  }

  const iconSrc = pendingPreview ?? row?.icon ?? null

  return (
    <Modal
      open
      onClose={onClose}
      title={existing ? 'Edit education' : 'Add education'}
      description="Leave the end date blank if you're still studying."
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
          <Button type="submit" form="education-form" variant="primary" loading={saving}>
            {existing ? 'Save' : 'Add'}
          </Button>
        </>
      }
    >
      <form id="education-form" onSubmit={onSubmit} className="flex flex-col gap-4">
        {error ? (
          <p
            role="alert"
            className="rounded-lg border border-critical/25 bg-critical/10 px-3 py-2 text-[13px] text-ink"
          >
            {error}
          </p>
        ) : null}

        <ImagePicker
          name={form.school || 'School'}
          src={iconSrc}
          size="lg"
          shape="square"
          label="school logo"
          helpText="Optional crest or logo — shown next to this school on your profile."
          onUpload={async (file) => {
            if (row) {
              const saved = await education.uploadIcon(row.id, file)
              setRow(saved)
              onRowChange(saved)
              setPendingIcon(null)
              if (pendingPreview) URL.revokeObjectURL(pendingPreview)
              setPendingPreview(null)
            } else {
              if (pendingPreview) URL.revokeObjectURL(pendingPreview)
              setPendingIcon(file)
              setPendingPreview(URL.createObjectURL(file))
            }
          }}
          onRemove={
            iconSrc
              ? async () => {
                  if (row?.icon) {
                    const saved = await education.removeIcon(row.id)
                    setRow(saved)
                    onRowChange(saved)
                  }
                  setPendingIcon(null)
                  if (pendingPreview) URL.revokeObjectURL(pendingPreview)
                  setPendingPreview(null)
                }
              : undefined
          }
        />

        <Input
          label="School"
          required
          autoFocus
          value={form.school}
          error={errors.school}
          onChange={(event) => set('school', event.target.value)}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Degree"
            placeholder="Bachelor of Commerce"
            value={form.degree}
            error={errors.degree}
            onChange={(event) => set('degree', event.target.value)}
          />
          <Input
            label="Field of study"
            placeholder="Finance"
            value={form.field_of_study}
            error={errors.field_of_study}
            onChange={(event) => set('field_of_study', event.target.value)}
          />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
        <MentionTextarea
          label="Description"
          value={form.description}
          error={errors.description}
          onChange={(value) => set('description', value)}
        />

        {row ? (
          <div>
            <p className="mb-2 text-[12.5px] font-medium text-ink">Attachments</p>
            <p className="mb-2 text-[12px] text-ink-3">
              Transcripts, certificates, or other files for this school.
            </p>
            <AttachmentList
              attachments={row.attachments}
              onAdd={async (file, caption) => {
                const saved = await education.addAttachment(row.id, file, caption)
                setRow(saved)
                onRowChange(saved)
              }}
              onRemove={async (attachmentId) => {
                const saved = await education.removeAttachment(row.id, attachmentId)
                setRow(saved)
                onRowChange(saved)
              }}
            />
          </div>
        ) : (
          <p className="text-[12px] text-ink-3">
            Save this school first, then you can add transcripts and other files.
          </p>
        )}
      </form>
    </Modal>
  )
}
