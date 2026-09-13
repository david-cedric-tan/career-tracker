import { useState } from 'react'
import { formatApiError } from '../../api/client'
import { cx } from '../../lib/format'
import { Avatar } from './Avatar'
import { Button, Spinner } from './Button'
import { Icon } from './Icon'
import { UploadDialog } from './UploadDialog'

/**
 * Pick / replace / remove a picture.
 *
 * Inline it's only the picture and a "Change" button — the format rules and
 * the preview live in the popup, where you're actually choosing a file. A
 * pick isn't saved until you confirm it there, so a wrong file costs nothing.
 *
 * `onUpload` runs on save; for a record that doesn't exist yet (a new
 * contact) the parent just holds the File and shows the object-URL it sets.
 */
export function ImagePicker({
  name,
  src,
  onUpload,
  onRemove,
  label = 'photo',
  size = 'xl',
  shape = 'circle',
  helpText,
  className,
}: {
  name: string
  src: string | null
  onUpload: (file: File) => Promise<void>
  onRemove?: () => Promise<void>
  label?: string
  size?: 'lg' | 'xl'
  shape?: 'circle' | 'square'
  /** Extra line under the picker — only when something is worth saying. */
  helpText?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function remove() {
    if (!onRemove) return
    setError('')
    setBusy(true)
    try {
      await onRemove()
    } catch (err) {
      setError(formatApiError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={className}>
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={busy}
          aria-label={src ? `Change ${label}` : `Upload a ${label}`}
          className={cx(
            'group relative focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
            shape === 'circle' ? 'rounded-full' : 'rounded-lg',
          )}
        >
          <Avatar name={name} src={src} size={size} shape={shape} />
          <span
            className={cx(
              'absolute inset-0 grid place-items-center bg-slate-950/55 text-white transition-opacity',
              shape === 'circle' ? 'rounded-full' : 'rounded-lg',
              busy ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
            )}
          >
            {busy ? <Spinner /> : <Icon name="edit" size={16} />}
          </span>
        </button>

        <div className="flex min-w-0 flex-col items-start gap-1.5">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => setOpen(true)}
              disabled={busy}
              icon={<Icon name="edit" size={14} />}
            >
              {src ? 'Change' : 'Upload'}
            </Button>
            {src && onRemove ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => void remove()}
                disabled={busy}
                icon={<Icon name="trash" size={14} />}
              >
                Remove
              </Button>
            ) : null}
          </div>
          {helpText ? <p className="text-[11.5px] text-ink-3">{helpText}</p> : null}
        </div>
      </div>

      {error ? (
        <p role="alert" className="mt-2 text-[12px] text-critical">
          {error}
        </p>
      ) : null}

      {open ? (
        <UploadDialog
          title={src ? `Change ${label}` : `Upload a ${label}`}
          accept="image"
          current={src}
          shape={shape}
          saveLabel={`Save ${label}`}
          onClose={() => setOpen(false)}
          onSave={async (file) => {
            await onUpload(file)
          }}
        />
      ) : null}
    </div>
  )
}
