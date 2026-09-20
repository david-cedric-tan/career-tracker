import { useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { formatApiError } from '../../api/client'
import { cx } from '../../lib/format'
import { Spinner } from './Button'
import { Icon } from './Icon'
import { UploadDialog } from './UploadDialog'

const MAX_BYTES = 10 * 1024 * 1024
export const DOCUMENT_ACCEPT =
  '.pdf,.docx,.doc,.pages,.odt,.rtf,.txt,.md,.markdown,.pptx,.ppt,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation'

function humanSize(bytes: number | null) {
  if (bytes === null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * Attach / replace / download a document.
 *
 * Deliberately not the image picker: there's no preview to show, the size cap
 * is different, and the useful affordance is "open the file", not "look at it".
 */
export function FilePicker({
  url,
  name,
  kind,
  size,
  onUpload,
  onRemove,
  help,
}: {
  url: string | null
  name: string
  kind: string | null
  size: number | null
  onUpload: (file: File) => Promise<void>
  onRemove: () => Promise<void>
  help?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)

  async function accept(file: File | undefined) {
    if (!file) return
    setError('')
    if (file.size > MAX_BYTES) {
      setError(`That file is ${(file.size / 1024 / 1024).toFixed(1)}MB. The limit is 10MB.`)
      return
    }

    setBusy(true)
    try {
      await onUpload(file)
    } catch (err) {
      setError(formatApiError(err))
    } finally {
      setBusy(false)
    }
  }

  async function onPick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    await accept(file)
  }

  /** Dropping a CV onto the box is the obvious gesture, so it works whether
      there's a file attached already (drop to replace) or not. */
  function onDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault()
    setDragging(false)
    void accept(event.dataTransfer.files?.[0])
  }

  function onDragOver(event: DragEvent<HTMLElement>) {
    // Without preventDefault the browser navigates to the dropped file.
    event.preventDefault()
    setDragging(true)
  }

  async function remove() {
    setBusy(true)
    setError('')
    try {
      await onRemove()
    } catch (err) {
      setError(formatApiError(err))
    } finally {
      setBusy(false)
    }
  }

  // `name` without `url` is a file chosen before the record exists — it can be
  // shown and removed, it just isn't downloadable until it's been sent.
  const hasFile = Boolean(url || name)

  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      {hasFile ? (
        <div
          className={cx(
            'flex items-center gap-2.5 rounded-lg border bg-surface-2 p-2.5 transition-colors',
            dragging ? 'border-brand bg-brand-soft' : 'border-line',
          )}
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand-strong">
            {busy ? <Spinner /> : <Icon name="file" size={17} />}
          </span>

          <div className="min-w-0 flex-1">
            {url ? (
              <a
                href={url}
                target="_blank"
                rel="noreferrer noopener"
                className="block truncate text-[13px] font-medium text-ink hover:text-brand hover:underline"
              >
                {name || 'Attachment'}
              </a>
            ) : (
              <span className="block truncate text-[13px] font-medium text-ink">
                {name || 'Attachment'}
              </span>
            )}
            <p className="text-[11.5px] text-ink-3">
              {[kind, humanSize(size), url ? null : 'attached on save']
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>

          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            disabled={busy}
            aria-label="Replace file"
            title="Replace"
            className="shrink-0 rounded-lg p-1.5 text-ink-3 transition-colors hover:bg-surface hover:text-ink"
          >
            <Icon name="edit" size={15} />
          </button>
          <button
            type="button"
            onClick={() => void remove()}
            disabled={busy}
            aria-label="Remove file"
            title="Remove"
            className="shrink-0 rounded-lg p-1.5 text-ink-3 transition-colors hover:bg-surface hover:text-critical"
          >
            <Icon name="trash" size={15} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          disabled={busy}
          className={cx(
            'upload-zone flex w-full items-center gap-2.5 rounded-lg border border-dashed p-3 text-left transition-colors',
            'hover:border-brand hover:bg-brand-soft',
            dragging ? 'border-brand bg-brand-soft' : 'border-line-strong bg-surface-2',
          )}
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface text-ink-3">
            {busy ? <Spinner /> : <Icon name="plus" size={17} className="upload-plus" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-medium text-ink">
              {dragging ? 'Drop it here' : 'Attach a file, or drop one here'}
            </span>
            <span className="block text-[11.5px] text-ink-3">
              {help ?? 'PDF, Word, Pages, PowerPoint, Markdown, ODT, RTF or text — up to 10MB.'}
            </span>
          </span>
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={DOCUMENT_ACCEPT}
        onChange={onPick}
        className="hidden"
      />

      {error ? (
        <p role="alert" className="mt-1.5 text-[12px] text-critical">
          {error}
        </p>
      ) : null}

      {dialogOpen ? (
        <UploadDialog
          title={hasFile ? 'Replace file' : 'Attach a file'}
          accept="document"
          current={
            hasFile ? (
              <span className="grid size-20 place-items-center rounded-xl border border-line bg-surface-2 text-brand-strong">
                <Icon name="file" size={26} />
              </span>
            ) : null
          }
          saveLabel={hasFile ? 'Replace' : 'Attach'}
          onClose={() => setDialogOpen(false)}
          onSave={async (file) => {
            await onUpload(file)
          }}
        />
      ) : null}
    </div>
  )
}
