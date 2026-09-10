import { useRef, useState, type ChangeEvent } from 'react'
import { formatApiError } from '../../api/client'
import type { ProfileAttachment } from '../../api/types'
import { cx } from '../../lib/format'
import { Button, Spinner } from '../ui/Button'
import { Input } from '../ui/Field'
import { Icon } from '../ui/Icon'

const MAX_BYTES = 10 * 1024 * 1024
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
  const inputRef = useRef<HTMLInputElement>(null)
  const [caption, setCaption] = useState('')
  const [busyId, setBusyId] = useState<number | 'new' | null>(null)
  const [error, setError] = useState('')
  const [lightbox, setLightbox] = useState<string | null>(null)

  async function onPick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setError('')
    if (file.size > MAX_BYTES) {
      setError(`That file is ${(file.size / 1024 / 1024).toFixed(1)}MB. The limit is 10MB.`)
      return
    }

    setBusyId('new')
    try {
      await onAdd(file, caption.trim())
      setCaption('')
    } catch (err) {
      setError(formatApiError(err))
    } finally {
      setBusyId(null)
    }
  }

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
              {attachment.kind === 'image' ? (
                <button
                  type="button"
                  onClick={() => setLightbox(attachment.file)}
                  className="size-9 shrink-0 overflow-hidden rounded-md"
                  aria-label={attachment.caption || 'View image'}
                >
                  <img
                    src={attachment.file}
                    alt=""
                    loading="lazy"
                    className="size-full object-cover"
                  />
                </button>
              ) : (
                <span className="grid size-9 shrink-0 place-items-center rounded-md bg-surface text-brand">
                  <Icon name="file" size={16} />
                </span>
              )}

              <div className="min-w-0 flex-1">
                {attachment.kind === 'document' ? (
                  <a
                    href={attachment.file}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="block truncate text-[12.5px] font-medium text-ink hover:text-brand hover:underline"
                  >
                    {attachment.original_name || 'Document'}
                  </a>
                ) : null}
                {attachment.caption ? (
                  <p className="truncate text-[11.5px] text-ink-3">{attachment.caption}</p>
                ) : attachment.kind === 'image' ? (
                  <p className="truncate text-[12px] text-ink-2">Image</p>
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

      <div className="flex items-end gap-2">
        <Input
          value={caption}
          onChange={(event) => setCaption(event.target.value)}
          placeholder="Caption (optional)"
          wrapperClassName="flex-1"
        />
        <Button
          type="button"
          size="sm"
          onClick={() => inputRef.current?.click()}
          loading={busyId === 'new'}
          icon={<Icon name="plus" size={14} />}
        >
          Attach
        </Button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={PROFILE_ATTACHMENT_ACCEPT}
        onChange={onPick}
        className="hidden"
      />

      {error ? <p className="mt-1.5 text-[12px] text-critical">{error}</p> : null}

      {lightbox ? (
        <button
          type="button"
          onClick={() => setLightbox(null)}
          aria-label="Close image"
          className={cx(
            'fixed inset-0 z-[60] grid place-items-center bg-slate-950/80 p-6',
          )}
        >
          <img src={lightbox} alt="" className="max-h-full max-w-full rounded-xl object-contain" />
        </button>
      ) : null}
    </div>
  )
}
