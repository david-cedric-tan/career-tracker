import { useState } from 'react'
import { formatApiError } from '../../api/client'
import type { ProfileAttachment } from '../../api/types'
import type { PreviewSource } from '../../lib/documentPreview'
import { DocumentThumbnail } from '../applications/DocumentThumbnail'
import { DocumentViewer } from '../applications/DocumentViewer'
import { attachmentPreview } from './attachmentPreview'
import { Spinner } from '../ui/Button'
import { UploadDialog } from '../ui/UploadDialog'
import { Icon } from '../ui/Icon'

export const PROFILE_ATTACHMENT_ACCEPT =
  '.pdf,.docx,.doc,.pages,.odt,.rtf,.txt,image/*,application/pdf,application/msword'

/**
 * The shared "add a file with a caption" list used by Education,
 * Certification and ExtraCurricular (FR-PROF-13) — a photo of a certificate
 * or the PDF of it, mixed freely in one list rather than two separate ones.
 */
export function AttachmentList({
  attachments,
  onAdd,
  onRemove,
}: {
  attachments: ProfileAttachment[]
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
    <div>
      {attachments.length > 0 ? (
        <ul className="mb-2 flex flex-col gap-1.5">
          {attachments.map((attachment) => (
            <li
              key={attachment.id}
              className="flex items-center gap-2.5 rounded-lg border border-line bg-surface-2 px-2.5 py-2"
            >
              <button
                type="button"
                onClick={() => setViewing(attachmentPreview(attachment))}
                className="size-9 shrink-0 overflow-hidden rounded-md border border-line bg-surface"
                aria-label={`Open ${attachment.caption || attachment.original_name || 'attachment'}`}
              >
                <DocumentThumbnail document={attachmentPreview(attachment)} className="size-full" />
              </button>

              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => setViewing(attachmentPreview(attachment))}
                  className="block max-w-full truncate text-left text-[12.5px] font-medium text-ink hover:text-brand hover:underline"
                >
                  {attachment.caption || attachment.original_name || 'Attachment'}
                </button>
                {attachment.caption && attachment.original_name ? (
                  <p className="truncate text-[11.5px] text-ink-3">{attachment.original_name}</p>
                ) : null}
              </div>

              <button
                type="button"
                onClick={() => void remove(attachment.id)}
                disabled={busyId === attachment.id}
                aria-label={`Remove ${attachment.caption || attachment.original_name || 'attachment'}`}
                className="shrink-0 rounded-lg p-1.5 text-ink-3 transition-colors hover:bg-surface hover:text-critical"
              >
                {busyId === attachment.id ? <Spinner className="size-3.5" /> : <Icon name="trash" size={14} />}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <button
        type="button"
        onClick={() => setAdding(true)}
        className="upload-zone upload-host flex w-full items-center gap-2.5 rounded-lg border border-dashed border-line-strong bg-surface-2 px-3 py-2 text-left transition-colors hover:border-brand hover:bg-brand-soft"
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface text-ink-3">
          <Icon name="paperclip" size={15} className="upload-clip" />
        </span>
        <span className="text-[12.5px] font-medium text-ink">Attach a photo or document</span>
      </button>

      {adding ? (
        <UploadDialog
          title="Attach"
          accept="any"
          caption
          saveLabel="Attach"
          onClose={() => setAdding(false)}
          onSave={onAdd}
        />
      ) : null}

      {error ? <p className="mt-1.5 text-[12px] text-critical">{error}</p> : null}

      {viewing ? <DocumentViewer item={viewing} onClose={() => setViewing(null)} /> : null}
    </div>
  )
}
