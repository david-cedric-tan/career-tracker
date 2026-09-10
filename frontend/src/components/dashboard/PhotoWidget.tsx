import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { experiences as experiencesApi } from '../../api/resources'
import type { Experience } from '../../api/types'
import { cx } from '../../lib/format'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { Modal } from '../ui/Modal'
import { EmptyState, Loading } from '../ui/States'
import { useToast } from '../ui/toast-context'

const STORAGE_KEY = 'career-tracker:pinned-photo'
/**
 * Kept well under a typical 5MB localStorage quota: a data URL is base64, which
 * inflates the file by about a third, so 2.5MB of GIF lands near 3.4MB stored.
 */
const MAX_BYTES = 2.5 * 1024 * 1024

type Pinned = { src: string; caption: string }

/**
 * Kept per browser as a data URL rather than uploaded to the account.
 *
 * A pinned photo is desk decoration — it doesn't belong to any application or
 * contact, so there's no row for it to hang off, and giving it its own model
 * and endpoint would be a lot of machinery for one square on one screen. The
 * size cap keeps it well clear of what localStorage will hold.
 */
function readPinned(): Pinned | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<Pinned>
    return typeof parsed.src === 'string' && parsed.src
      ? { src: parsed.src, caption: typeof parsed.caption === 'string' ? parsed.caption : '' }
      : null
  } catch {
    return null
  }
}

export function PhotoWidget() {
  const { notify } = useToast()
  const [pinned, setPinned] = useState<Pinned | null>(readPinned)
  const [picking, setPicking] = useState(false)

  function save(next: Pinned | null) {
    setPinned(next)
    try {
      if (next) localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      else localStorage.removeItem(STORAGE_KEY)
    } catch {
      notify("That image is too large to keep — it'll clear when you reload.", 'error')
    }
  }

  return (
    <div className="group/photo relative flex h-full flex-col gap-2">
      {pinned ? (
        <button
          type="button"
          onClick={() => setPicking(true)}
          title={pinned.caption || 'Change the pinned photo'}
          className="relative min-h-24 flex-1 overflow-hidden rounded-lg ring-1 ring-line"
        >
          <img src={pinned.src} alt={pinned.caption} className="size-full object-cover" />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setPicking(true)}
          className={cx(
            'grid min-h-24 flex-1 place-items-center gap-1 rounded-lg text-ink-3',
            'ring-1 ring-line transition-colors hover:text-brand hover:ring-brand-ring',
          )}
          style={{
            backgroundImage:
              'linear-gradient(135deg, var(--color-brand-soft), var(--color-surface-2))',
          }}
        >
          <Icon name="plus" size={18} />
          <span className="text-[11.5px] font-medium">Pin a photo</span>
        </button>
      )}

      {/* No caption line: the photo is the whole point of the widget, and a
          filename under it just ate a row of the tile. The remove button
          floats over the image instead, on hover. */}
      {pinned ? (
        <button
          type="button"
          onClick={() => save(null)}
          aria-label="Remove the pinned photo"
          className="absolute right-1.5 top-1.5 grid size-6 place-items-center rounded-full bg-slate-950/55 text-white opacity-0 transition-opacity hover:bg-critical focus:opacity-100 group-hover/photo:opacity-100"
        >
          <Icon name="trash" size={12} />
        </button>
      ) : null}

      {picking ? (
        <PhotoPicker
          onClose={() => setPicking(false)}
          onPick={(next) => {
            save(next)
            setPicking(false)
          }}
        />
      ) : null}
    </div>
  )
}

function PhotoPicker({
  onClose,
  onPick,
}: {
  onClose: () => void
  onPick: (pinned: Pinned) => void
}) {
  const { notify } = useToast()
  const inputRef = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<Experience[] | null>(null)

  useEffect(() => {
    experiencesApi
      .list()
      .then(setRows)
      .catch(() => setRows([]))
  }, [])

  // Every photo already in the app, so pinning one doesn't mean finding the
  // original file again.
  const gallery = (rows ?? []).flatMap((experience) =>
    experience.photos.map((photo) => ({
      id: photo.id,
      src: photo.image,
      caption: photo.caption || experience.title,
    })),
  )

  function onUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    if (file.size > MAX_BYTES) {
      notify(
        `That image is ${(file.size / 1024 / 1024).toFixed(1)}MB. The limit is 2.5MB — ` +
          'animated GIFs run large, so a shorter or smaller one will fit.',
        'error',
      )
      return
    }

    // Read to a data URL rather than re-encoding through a canvas: a canvas
    // would flatten an animated GIF to its first frame. Stored as-is, so the
    // animation survives — and it means no upload endpoint or server-side row.
    const reader = new FileReader()
    reader.onerror = () => notify("That image couldn't be read.", 'error')
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        onPick({ src: reader.result, caption: file.name.replace(/\.[^.]+$/, '') })
      }
    }
    reader.readAsDataURL(file)
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Pin a photo"
      description="Upload an image or GIF, or reuse a photo already in your galleries."
      footer={
        <>
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={() => inputRef.current?.click()}
            icon={<Icon name="plus" size={14} />}
          >
            Upload
          </Button>
        </>
      }
    >
      <input
        ref={inputRef}
        type="file"
        // GIFs included — the data URL keeps them animated.
        accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
        onChange={onUpload}
        className="hidden"
      />

      {rows === null ? (
        <Loading />
      ) : gallery.length === 0 ? (
        <EmptyState
          icon="file"
          title="No photos in the app yet"
          description="Add photos to an experience gallery, or upload one here."
          className="py-6"
        />
      ) : (
        <ul className="grid max-h-80 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
          {gallery.map((photo) => (
            <li key={photo.id}>
              <button
                type="button"
                onClick={() => onPick({ src: photo.src, caption: photo.caption })}
                title={photo.caption}
                className="block aspect-square w-full overflow-hidden rounded-lg ring-1 ring-line transition-all hover:ring-2 hover:ring-brand"
              >
                <img
                  src={photo.src}
                  alt={photo.caption}
                  loading="lazy"
                  className="size-full object-cover"
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
