import { useRef, useState, type ChangeEvent } from 'react'
import { formatApiError } from '../../api/client'
import { cx } from '../../lib/format'
import { Spinner } from './Button'
import { Icon } from './Icon'

const MAX_BYTES = 10 * 1024 * 1024
export const DOCUMENT_ACCEPT =
  '.pdf,.docx,.doc,.pages,.odt,.rtf,.txt,application/pdf,application/msword'

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

  async function onPick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
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

  return (
    <div>
      {url ? (
        <div className="flex items-center gap-2.5 rounded-lg border border-line bg-surface-2 p-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand-strong">
            {busy ? <Spinner /> : <Icon name="file" size={17} />}
          </span>

          <div className="min-w-0 flex-1">
            <a
              href={url}
              target="_blank"
              rel="noreferrer noopener"
              className="block truncate text-[13px] font-medium text-ink hover:text-brand hover:underline"
            >
              {name || 'Attachment'}
            </a>
            <p className="text-[11.5px] text-ink-3">
              {[kind, humanSize(size)].filter(Boolean).join(' · ')}
            </p>
          </div>

          <button
            type="button"
            onClick={() => inputRef.current?.click()}
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
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className={cx(
            'flex w-full items-center gap-2.5 rounded-lg border border-dashed border-line-strong',
            'bg-surface-2 p-3 text-left transition-colors hover:border-brand hover:bg-brand-soft',
          )}
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface text-ink-3">
            {busy ? <Spinner /> : <Icon name="plus" size={17} />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-medium text-ink">Attach a file</span>
            <span className="block text-[11.5px] text-ink-3">
              {help ?? 'PDF, Word, Pages, ODT, RTF or text — up to 10MB.'}
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
    </div>
  )
}
