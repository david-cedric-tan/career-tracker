import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from 'react'
import { formatApiError } from '../../api/client'
import { cx } from '../../lib/format'
import { DocumentThumbnail } from '../applications/DocumentThumbnail'
import { Button } from './Button'
import { Input } from './Field'
import { Icon } from './Icon'
import { Modal } from './Modal'

export type UploadAccept = 'image' | 'document' | 'any'

const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/avif'
export const DOCUMENT_ACCEPT =
  '.pdf,.docx,.doc,.pages,.odt,.rtf,.txt,.md,.markdown,.pptx,.ppt,' +
  'application/pdf,application/msword,' +
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document,' +
  'application/vnd.apple.pages,application/vnd.oasis.opendocument.text,' +
  'application/rtf,text/plain,text/markdown,' +
  'application/vnd.ms-powerpoint,' +
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'

const ACCEPT: Record<UploadAccept, string> = {
  image: IMAGE_ACCEPT,
  document: DOCUMENT_ACCEPT,
  any: `${IMAGE_ACCEPT},${DOCUMENT_ACCEPT}`,
}

const LIMIT_MB: Record<UploadAccept, number> = { image: 5, document: 10, any: 10 }

const HINT: Record<UploadAccept, string> = {
  image: 'PNG, JPG, WEBP, GIF or AVIF · up to 5MB',
  document: 'PDF, Word, Pages, PowerPoint, Markdown, ODT, RTF or text · up to 10MB',
  any: 'A photo or a document — PDF, Word, images and more · up to 10MB',
}

/**
 * The one way files get into the app: pick → preview → save.
 *
 * Every attach button (a resume, a cover letter, a school transcript, a work
 * photo, a company logo) opens this same dialog, so the gesture is the same
 * wherever you are. `accept` decides the drop-zone's look: a photo frame, a
 * document sheet, or — for places that take either — the two fused into one
 * mark rather than two competing boxes.
 */
export function UploadDialog({
  title,
  accept,
  current,
  shape = 'square',
  caption: withCaption = false,
  saveLabel = 'Save',
  onClose,
  onSave,
}: {
  title: string
  accept: UploadAccept
  /** What's there now — an image URL for photos/logos, or a node. */
  current?: string | ReactNode | null
  /** Crop hint for image previews. */
  shape?: 'circle' | 'square'
  /** Ask for a caption alongside the file. */
  caption?: boolean
  saveLabel?: string
  onClose: () => void
  onSave: (file: File, caption: string) => Promise<void>
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [captionText, setCaptionText] = useState('')
  const [dragging, setDragging] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const objectUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file])
  useEffect(() => {
    if (!objectUrl) return
    return () => URL.revokeObjectURL(objectUrl)
  }, [objectUrl])

  const isImage = Boolean(file?.type.startsWith('image/'))

  function choose(candidate: File | undefined) {
    if (!candidate) return
    setError('')
    const image = candidate.type.startsWith('image/')
    if (accept === 'image' && !image) {
      setError('Pick an image file.')
      return
    }
    if (accept === 'document' && image) {
      setError('Pick a document, not an image.')
      return
    }
    const limit = LIMIT_MB[accept] * 1024 * 1024
    if (candidate.size > limit) {
      setError(
        `That file is ${(candidate.size / 1024 / 1024).toFixed(1)}MB. The limit is ${LIMIT_MB[accept]}MB.`,
      )
      return
    }
    setFile(candidate)
  }

  function onPick(event: ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0]
    event.target.value = ''
    choose(picked)
  }

  function onDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault()
    setDragging(false)
    choose(event.dataTransfer.files?.[0])
  }

  async function save() {
    if (!file) return
    setSaving(true)
    setError('')
    try {
      await onSave(file, captionText.trim())
      onClose()
    } catch (err) {
      setError(formatApiError(err))
    } finally {
      setSaving(false)
    }
  }

  const rounded = shape === 'circle' ? 'rounded-full' : 'rounded-xl'

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button type="button" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={!file} loading={saving}>
            {saveLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error ? (
          <p
            role="alert"
            className="rounded-lg border border-critical/25 bg-critical/10 px-3 py-2 text-[13px] text-ink"
          >
            {error}
          </p>
        ) : null}

        {/* Current → new. Without a "current" there's just the new one, big. */}
        <div className="flex items-center justify-center gap-5 py-2">
          {current ? (
            <>
              <figure className="flex flex-col items-center gap-1.5">
                {typeof current === 'string' ? (
                  <span className={cx('block size-20 overflow-hidden border border-line bg-surface-2', rounded)}>
                    <img src={current} alt="" className={cx('size-full', shape === 'circle' ? 'object-cover' : 'object-contain p-1')} />
                  </span>
                ) : (
                  current
                )}
                <figcaption className="text-[11px] font-medium uppercase tracking-wide text-ink-3">
                  Current
                </figcaption>
              </figure>
              <Icon name="arrowRight" size={18} className="text-ink-3" />
            </>
          ) : null}
          <figure className="flex flex-col items-center gap-1.5">
            <NewPreview file={file} url={objectUrl} isImage={isImage} accept={accept} shape={shape} />
            <figcaption className="text-[11px] font-medium uppercase tracking-wide text-ink-3">
              {file ? 'New' : 'Nothing chosen'}
            </figcaption>
          </figure>
        </div>

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cx(
            'upload-zone flex w-full flex-col items-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-5 text-center transition-colors',
            dragging
              ? 'border-brand bg-brand-soft'
              : 'border-line bg-surface-2 hover:border-line-strong hover:bg-surface',
          )}
        >
          <UploadMark accept={accept} />
          <span className="text-[13px] font-medium text-ink">
            {file ? file.name : dragging ? 'Drop it here' : 'Drop it here, or click to choose'}
          </span>
          <span className="text-[11.5px] text-ink-3">
            {HINT[accept]}
            {accept !== 'document' && shape === 'circle' ? ' · photos are cropped to a square' : ''}
          </span>
        </button>

        {withCaption ? (
          <Input
            label="Caption"
            value={captionText}
            onChange={(event) => setCaptionText(event.target.value)}
            placeholder="Optional — what this is"
          />
        ) : null}

        <input ref={inputRef} type="file" accept={ACCEPT[accept]} onChange={onPick} className="hidden" />
      </div>
    </Modal>
  )
}

/** The chosen file, as it'll look: an image cover, or a real document thumbnail. */
function NewPreview({
  file,
  url,
  isImage,
  accept,
  shape,
}: {
  file: File | null
  url: string | null
  isImage: boolean
  accept: UploadAccept
  shape: 'circle' | 'square'
}) {
  const rounded = shape === 'circle' && accept === 'image' ? 'rounded-full' : 'rounded-xl'
  if (!file || !url) {
    return (
      <span
        className={cx(
          'grid size-20 place-items-center border-2 border-dashed border-line text-ink-3',
          rounded,
        )}
      >
        <Icon name={accept === 'image' ? 'image' : accept === 'document' ? 'file' : 'paperclip'} size={22} />
      </span>
    )
  }
  return (
    <span className={cx('block size-20 overflow-hidden border border-line bg-surface-2', rounded)}>
      <DocumentThumbnail
        document={{
          file: url,
          title: file.name,
          original_name: file.name,
          kind: isImage ? 'image' : 'document',
        }}
        className={cx('size-full', isImage && shape === 'circle' ? 'object-cover' : '')}
      />
    </span>
  )
}

/**
 * The drop-zone's mark. For zones that take either kind, the photo frame and
 * the document sheet are drawn as one overlapping pair with a single plus —
 * one thing to aim at, not a fork in the road.
 */
function UploadMark({ accept }: { accept: UploadAccept }) {
  if (accept === 'any') {
    return (
      <span className="relative mb-1 grid h-12 w-16 place-items-center">
        <span className="absolute left-1 top-1 grid size-9 -rotate-6 place-items-center rounded-lg border border-line bg-surface text-ink-3 shadow-sm">
          <Icon name="image" size={16} />
        </span>
        <span className="absolute right-1 top-0 grid size-9 rotate-6 place-items-center rounded-lg border border-line bg-surface text-ink-3 shadow-sm">
          <Icon name="file" size={16} />
        </span>
        <span className="absolute -bottom-0.5 left-1/2 grid size-7 -translate-x-1/2 place-items-center rounded-full border-2 border-surface bg-brand text-white shadow-md">
          <Icon name="plus" size={14} className="upload-plus" strokeWidth={2.4} />
        </span>
      </span>
    )
  }
  return (
    <span className="mb-1 grid size-10 place-items-center rounded-full bg-brand-soft text-brand-strong">
      <Icon name="plus" size={20} className="upload-plus" />
    </span>
  )
}
