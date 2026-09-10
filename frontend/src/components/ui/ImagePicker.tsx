import { useRef, useState, type ChangeEvent } from 'react'
import { formatApiError } from '../../api/client'
import { cx } from '../../lib/format'
import { Avatar } from './Avatar'
import { Button, Spinner } from './Button'
import { Icon } from './Icon'

const MAX_BYTES = 5 * 1024 * 1024
const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif'

/**
 * Pick / replace / remove a picture.
 *
 * `onUpload` may be null while the record doesn't exist yet (a new contact) —
 * in that case the parent holds the File and uploads it after the create, and
 * we show a local object-URL preview so the choice is still visible.
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
  helpText?: string
  className?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function onPick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // Let the same file be re-picked after a failure.
    event.target.value = ''
    if (!file) return

    setError('')
    if (!file.type.startsWith('image/')) {
      setError('Pick an image file.')
      return
    }
    if (file.size > MAX_BYTES) {
      setError(`That image is ${(file.size / 1024 / 1024).toFixed(1)}MB. The limit is 5MB.`)
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
          onClick={() => inputRef.current?.click()}
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
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              icon={<Icon name="plus" size={14} />}
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
          <p className="text-[11.5px] text-ink-3">
            {helpText ?? 'PNG, JPG, WEBP or GIF, up to 5MB. Cropped to a square.'}
          </p>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        onChange={onPick}
        className="hidden"
      />

      {error ? (
        <p role="alert" className="mt-2 text-[12px] text-critical">
          {error}
        </p>
      ) : null}
    </div>
  )
}
