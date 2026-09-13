import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { removePinnedPhoto, uploadPinnedPhoto } from '../../api/auth'
import { formatApiError } from '../../api/client'
import { experiences as experiencesApi } from '../../api/resources'
import type { Experience } from '../../api/types'
import { useAuth } from '../../auth/context'
import { cx } from '../../lib/format'
import {
  clearLocalPinnedPhotos,
  takeLocalPinnedPhoto,
  MAX_BYTES,
} from '../../lib/pinnedPhoto'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { Modal } from '../ui/Modal'
import { EmptyState, Loading } from '../ui/States'
import { useToast } from '../ui/toast-context'

/**
 * Desk photo on the dashboard. Stored on the account so it follows the user
 * to another device — and so two people on one machine never share a pin.
 */
export function PhotoWidget() {
  const { user, setUser } = useAuth()
  const { notify } = useToast()
  const [picking, setPicking] = useState(false)
  const [working, setWorking] = useState(false)
  const migratedFor = useRef<number | null>(null)

  const src = user?.pinned_photo ?? null
  const caption = user?.pinned_photo_caption ?? ''

  // One-time: a photo that only lived in this browser is uploaded to the
  // account, then the local copy is dropped.
  useEffect(() => {
    if (!user || user.pinned_photo || migratedFor.current === user.id) return
    migratedFor.current = user.id
    let cancelled = false

    void (async () => {
      const local = await takeLocalPinnedPhoto(user.id)
      if (!local || cancelled) return
      try {
        let file: Blob | null = local.blob ?? null
        if (!file && local.url) {
          const response = await fetch(local.url)
          if (response.ok) file = await response.blob()
        }
        if (!file || cancelled) return
        const next = await uploadPinnedPhoto(file, local.caption)
        if (!cancelled) {
          setUser(next)
          await clearLocalPinnedPhotos(user.id)
        }
      } catch {
        // Leave the local copy; they can re-pin from the picker.
      }
    })()

    return () => {
      cancelled = true
    }
  }, [user, setUser])

  async function save(file: Blob, nextCaption: string) {
    setWorking(true)
    try {
      const next = await uploadPinnedPhoto(file, nextCaption)
      setUser(next)
      if (user) await clearLocalPinnedPhotos(user.id)
    } catch (error) {
      notify(formatApiError(error), 'error')
    } finally {
      setWorking(false)
    }
  }

  async function clear() {
    setWorking(true)
    try {
      const next = await removePinnedPhoto()
      setUser(next)
      if (user) await clearLocalPinnedPhotos(user.id)
    } catch (error) {
      notify(formatApiError(error), 'error')
    } finally {
      setWorking(false)
    }
  }

  return (
    <div className="group/photo relative flex h-full flex-col gap-2">
      {src ? (
        <button
          type="button"
          onClick={() => setPicking(true)}
          title={caption || 'Change the pinned photo'}
          className="relative min-h-24 flex-1 overflow-hidden rounded-lg ring-1 ring-line"
        >
          <img src={src} alt={caption} className="size-full object-cover" />
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

      {src ? (
        <button
          type="button"
          onClick={() => void clear()}
          disabled={working}
          aria-label="Remove the pinned photo"
          className="absolute right-1.5 top-1.5 grid size-6 place-items-center rounded-full bg-slate-950/55 text-white opacity-0 transition-opacity hover:bg-critical focus:opacity-100 group-hover/photo:opacity-100 disabled:opacity-40"
        >
          <Icon name="trash" size={12} />
        </button>
      ) : null}

      {picking ? (
        <PhotoPicker
          busy={working}
          onClose={() => setPicking(false)}
          onPick={(file, nextCaption) => {
            void save(file, nextCaption).then(() => setPicking(false))
          }}
        />
      ) : null}
    </div>
  )
}

function PhotoPicker({
  onClose,
  onPick,
  busy,
}: {
  onClose: () => void
  onPick: (file: Blob, caption: string) => void
  busy: boolean
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
        `That image is ${(file.size / 1024 / 1024).toFixed(1)}MB. The limit is ` +
          `${Math.round(MAX_BYTES / 1024 / 1024)}MB.`,
        'error',
      )
      return
    }

    onPick(file, file.name.replace(/\.[^.]+$/, ''))
  }

  async function pickGallery(src: string, nextCaption: string) {
    try {
      const response = await fetch(src)
      if (!response.ok) throw new Error('fetch failed')
      onPick(await response.blob(), nextCaption)
    } catch {
      notify("That gallery photo couldn't be loaded.", 'error')
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Pin a photo"
      description="Upload an image or GIF, or reuse a photo already in your galleries. Saved to your account."
      footer={
        <>
          <Button type="button" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            loading={busy}
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
                disabled={busy}
                onClick={() => void pickGallery(photo.src, photo.caption)}
                title={photo.caption}
                className="block aspect-square w-full overflow-hidden rounded-lg ring-1 ring-line transition-all hover:ring-2 hover:ring-brand disabled:opacity-50"
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
