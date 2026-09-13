import { useState } from 'react'
import { formatApiError } from '../../api/client'
import type { ProfileAttachment } from '../../api/types'
import type { PreviewSource } from '../../lib/documentPreview'
import { cx } from '../../lib/format'
import { DocumentThumbnail } from '../applications/DocumentThumbnail'
import { DocumentViewer } from '../applications/DocumentViewer'
import { Button, Spinner } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { Modal } from '../ui/Modal'
import { UploadDialog } from '../ui/UploadDialog'
import { EmptyState } from '../ui/States'
import { attachmentPreview } from './attachmentPreview'

/**
 * The row-level entry point — the same strip Experience uses for photos:
 * stacked thumbnails, a count, and a chevron into the gallery.
 */
export function AttachmentStrip({
  attachments,
  onOpen,
}: {
  attachments: ProfileAttachment[]
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cx(
        "mt-2.5 flex w-full items-center gap-2 rounded-lg border border-line bg-surface px-2 py-1.5 text-left transition-colors hover:border-line-strong",
        !attachments.length && "upload-zone",
      )}
    >
      {attachments.length ? (
        <span className="flex -space-x-2">
          {attachments.slice(0, 4).map((attachment) => (
            <span
              key={attachment.id}
              className="size-7 overflow-hidden rounded-md bg-surface-2 ring-2 ring-surface"
            >
              <DocumentThumbnail document={attachmentPreview(attachment)} className="size-full" />
            </span>
          ))}
        </span>
      ) : (
        <span className="grid size-7 place-items-center rounded-md border border-dashed border-line-strong text-ink-3">
          <Icon name="plus" size={13} className="upload-plus" />
        </span>
      )}
      <span className="flex-1 text-[12px] text-ink-2">
        {attachments.length
          ? `${attachments.length} attachment${attachments.length === 1 ? '' : 's'}`
          : 'Add attachments'}
      </span>
      <Icon name="chevronRight" size={14} className="text-ink-3" />
    </button>
  )
}

/**
 * Transcripts, certificates, photos — one gallery per row, mirroring the
 * Experience photo gallery. Every tile opens in the same viewer the File
 * Directory uses (PDF, Word, text and images), so a certificate reads the
 * same wherever it lives.
 */
export function AttachmentGalleryDialog({
  title,
  attachments,
  onClose,
  onAdd,
  onRemove,
}: {
  title: string
  attachments: ProfileAttachment[]
  onClose: () => void
  onAdd: (file: File, caption: string) => Promise<void>
  onRemove: (id: number) => Promise<void>
}) {
  const [adding, setAdding] = useState(false)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [viewing, setViewing] = useState<PreviewSource | null>(null)

  async function remove(id: number) {
    setBusyId(id)
    setError('')
    try {
      await onRemove(id)
    } catch (err) {
      setError(formatApiError(err))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={title}
      description={`${attachments.length} attachment${attachments.length === 1 ? '' : 's'}`}
      footer={
        <Button type="button" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="upload-zone upload-host flex w-full items-center gap-2.5 rounded-lg border border-dashed border-line-strong bg-surface-2 px-3 py-2.5 text-left transition-colors hover:border-brand hover:bg-brand-soft"
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface text-ink-3">
            <Icon name="paperclip" size={17} className="upload-clip" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-medium text-ink">Attach a photo or document</span>
            <span className="block text-[11.5px] text-ink-3">A transcript, a certificate, a picture of the award…</span>
          </span>
        </button>
        {error ? (
          <p role="alert" className="text-[12px] text-critical">
            {error}
          </p>
        ) : null}

        {attachments.length === 0 ? (
          <EmptyState
            icon="file"
            title="Nothing attached yet"
            description="A transcript, a certificate PDF, a photo of the award — anything worth keeping with this."
            className="py-8"
          />
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {attachments.map((attachment) => {
              const preview = attachmentPreview(attachment)
              return (
                <li key={attachment.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => setViewing(preview)}
                    className="block w-full overflow-hidden rounded-lg border border-line bg-surface-2"
                    aria-label={`Open ${preview.title}`}
                  >
                    <span className="block aspect-4/3 w-full overflow-hidden">
                      <DocumentThumbnail document={preview} className="size-full" />
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(attachment.id)}
                    disabled={busyId === attachment.id}
                    aria-label={`Remove ${preview.title}`}
                    className={cx(
                      'absolute right-1.5 top-1.5 grid size-7 place-items-center rounded-lg',
                      'bg-slate-950/60 text-white opacity-0 transition-opacity',
                      'group-hover:opacity-100 focus-visible:opacity-100',
                    )}
                  >
                    {busyId === attachment.id ? (
                      <Spinner className="size-3.5" />
                    ) : (
                      <Icon name="trash" size={13} />
                    )}
                  </button>
                  <p className="mt-1 truncate text-[11.5px] text-ink-2" title={preview.title}>
                    {preview.title}
                  </p>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {viewing ? <DocumentViewer item={viewing} onClose={() => setViewing(null)} /> : null}

      {adding ? (
        <UploadDialog
          title="Attach to this"
          accept="any"
          caption
          saveLabel="Attach"
          onClose={() => setAdding(false)}
          onSave={onAdd}
        />
      ) : null}
    </Modal>
  )
}
