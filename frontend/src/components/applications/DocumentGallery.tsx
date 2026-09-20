import { useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { formatApiError } from '../../api/client'
import { applications } from '../../api/resources'
import type { Application, ApplicationDocument } from '../../api/types'
import { formatDate } from '../../lib/format'
import { Button } from '../ui/Button'
import { Card, CardHeader } from '../ui/Card'
import { Input, Textarea } from '../ui/Field'
import { downloadName, saveFileAs } from '../../lib/download'
import { Icon } from '../ui/Icon'
import { Modal } from '../ui/Modal'
import { EmptyState } from '../ui/States'
import { useToast } from '../ui/toast-context'
import { DocumentThumbnail } from './DocumentThumbnail'
import { DocumentViewer } from './DocumentViewer'

const MAX_BYTES = 10 * 1024 * 1024
const ACCEPT =
  '.pdf,.docx,.doc,.pages,.odt,.rtf,.txt,.md,.markdown,.pptx,.ppt,image/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation'
/** Cards per page — one row of three on desktop, so the arrows only appear
    once there's genuinely more than a screenful. */
const PAGE_SIZE = 6

/**
 * Supporting documents for one application (cover letter, take-home, offer
 * PDF), as a gallery of labelled cards.
 *
 * Paginated rather than scrolled: these are browsed occasionally and read
 * deliberately, so a stable grid with arrows beats a strip that has to be
 * dragged past everything to reach the end.
 */
export function DocumentGallery({
  application,
  onChanged,
}: {
  application: Application
  onChanged: (application: Application) => void
}) {
  const { notify } = useToast()
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [page, setPage] = useState(0)
  const [editing, setEditing] = useState<ApplicationDocument | null>(null)
  const [viewing, setViewing] = useState<ApplicationDocument | null>(null)

  const documents = application.documents
  const pageCount = Math.max(1, Math.ceil(documents.length / PAGE_SIZE))
  // A delete can empty the last page out from under us.
  const current = Math.min(page, pageCount - 1)
  const visible = documents.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE)

  async function onPick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    if (file.size > MAX_BYTES) {
      notify(`That file is ${(file.size / 1024 / 1024).toFixed(1)}MB. The limit is 10MB.`, 'error')
      return
    }

    setUploading(true)
    try {
      // Title and description are filled in afterwards, via the card's edit
      // button — asking for them up front turns a drag-and-drop into a form.
      onChanged(await applications.addDocument(application.id, file, '', ''))
      notify('Document added.')
    } catch (err) {
      notify(formatApiError(err), 'error')
    } finally {
      setUploading(false)
    }
  }

  async function remove(document: ApplicationDocument) {
    try {
      onChanged(await applications.removeDocument(application.id, document.id))
      notify('Document removed.')
    } catch (err) {
      notify(formatApiError(err), 'error')
    }
  }

  return (
    <Card padded={false}>
      <div className="flex items-start justify-between gap-3 p-4 sm:p-5">
        <CardHeader
          title="Documents"
          subtitle="Cover letters, take-homes, offer letters — also listed in File Directory."
        />
        <Button
          size="sm"
          onClick={() => inputRef.current?.click()}
          loading={uploading}
          icon={<Icon name="plus" size={14} />}
        >
          Add
        </Button>
      </div>

      <input ref={inputRef} type="file" accept={ACCEPT} onChange={onPick} className="hidden" />

      <div className="px-4 pb-4 sm:px-5 sm:pb-5">
        {documents.length === 0 ? (
          <EmptyState
            icon="file"
            title="No documents yet"
            description="Attach the cover letter or task you sent with this application."
            className="py-8"
          />
        ) : (
          <>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {visible.map((document) => (
                <li key={document.id}>
                  <DocumentCard
                    document={document}
                    onEdit={() => setEditing(document)}
                    onRemove={() => void remove(document)}
                    onPreview={() => setViewing(document)}
                  />
                </li>
              ))}
            </ul>

            {pageCount > 1 ? (
              <div className="mt-3 flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => setPage(current - 1)}
                  disabled={current === 0}
                  aria-label="Previous page of documents"
                  className="grid size-7 place-items-center rounded-full border border-line text-ink-2 transition-colors hover:text-ink disabled:opacity-30"
                >
                  <Icon name="chevronLeft" size={14} />
                </button>
                <span className="text-[12px] tabular-nums text-ink-3">
                  {current + 1} / {pageCount}
                </span>
                <button
                  type="button"
                  onClick={() => setPage(current + 1)}
                  disabled={current >= pageCount - 1}
                  aria-label="Next page of documents"
                  className="grid size-7 place-items-center rounded-full border border-line text-ink-2 transition-colors hover:text-ink disabled:opacity-30"
                >
                  <Icon name="chevronRight" size={14} />
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>

      {editing ? (
        <DocumentDetailsModal
          application={application}
          document={editing}
          onClose={() => setEditing(null)}
          onChanged={onChanged}
        />
      ) : null}

      {viewing ? <DocumentViewer item={viewing} onClose={() => setViewing(null)} /> : null}
    </Card>
  )
}

function DocumentCard({
  document,
  onEdit,
  onRemove,
  onPreview,
}: {
  document: ApplicationDocument
  onEdit: () => void
  onRemove: () => void
  onPreview: () => void
}) {
  return (
    <div className="group/doc flex h-full flex-col overflow-hidden rounded-lg border border-line bg-surface-2">
      <button
        type="button"
        onClick={onPreview}
        className="block h-28 w-full overflow-hidden bg-surface"
        aria-label={`Preview ${document.title}`}
      >
        <DocumentThumbnail document={document} className="size-full" />
      </button>

      <div className="flex flex-1 flex-col p-2.5">
        <p className="truncate text-[13px] font-medium text-ink" title={document.title}>
          {document.title}
        </p>
        {document.description ? (
          <p className="mt-0.5 line-clamp-2 text-[11.5px] text-ink-2">{document.description}</p>
        ) : null}
        <p className="mt-1 text-[11px] text-ink-3">
          {document.file_kind ? `${document.file_kind} · ` : ''}
          {formatDate(document.created_at)}
        </p>

        <div className="mt-2 flex items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover/doc:opacity-100">
          <button
            type="button"
            onClick={() =>
              void saveFileAs(
                document.file,
                downloadName(document.title, document.original_name || document.file),
              ).catch(() => window.open(document.file, '_blank', 'noopener'))
            }
            aria-label={`Download ${document.title}`}
            title="Download"
            className="rounded-lg p-1.5 text-ink-3 transition-colors hover:bg-surface hover:text-brand"
          >
            <Icon name="download" size={13} />
          </button>
          <button
            type="button"
            onClick={onEdit}
            aria-label={`Edit ${document.title}`}
            className="rounded-lg p-1.5 text-ink-3 transition-colors hover:bg-surface hover:text-brand"
          >
            <Icon name="edit" size={13} />
          </button>
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${document.title}`}
            className="rounded-lg p-1.5 text-ink-3 transition-colors hover:bg-surface hover:text-critical"
          >
            <Icon name="trash" size={13} />
          </button>
        </div>
      </div>
    </div>
  )
}

function DocumentDetailsModal({
  application,
  document,
  onClose,
  onChanged,
}: {
  application: Application
  document: ApplicationDocument
  onClose: () => void
  onChanged: (application: Application) => void
}) {
  const { notify } = useToast()
  const [title, setTitle] = useState(document.title)
  const [description, setDescription] = useState(document.description)
  const [saving, setSaving] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!title.trim()) return
    setSaving(true)
    try {
      onChanged(
        await applications.updateDocument(application.id, document.id, {
          title: title.trim(),
          description: description.trim(),
        }),
      )
      notify('Document updated.')
      onClose()
    } catch (err) {
      notify(formatApiError(err), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Document details"
      footer={
        <>
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="document-details-form" variant="primary" loading={saving}>
            Save
          </Button>
        </>
      }
    >
      <form id="document-details-form" onSubmit={onSubmit} className="flex flex-col gap-4">
        <Input
          label="Title"
          required
          autoFocus
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <Textarea
          label="Description"
          placeholder="What this document is, and why you sent it…"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
        <p className="text-[12px] text-ink-3">
          Uploaded as {document.original_name || 'a file'}.
        </p>
      </form>
    </Modal>
  )
}
