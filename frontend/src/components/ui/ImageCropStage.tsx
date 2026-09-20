import { useEffect, useMemo, useRef, useState } from 'react'
import { cx } from '../../lib/format'
import { Icon } from './Icon'

const MAX_ZOOM = 3
const OUTPUT_MAX = 800

type Offset = { x: number; y: number }

function clampOffset(offset: Offset, dispW: number, dispH: number, frameW: number, frameH: number): Offset {
  const minX = Math.min(0, frameW - dispW)
  const minY = Math.min(0, frameH - dispH)
  return {
    x: Math.min(0, Math.max(minX, offset.x)),
    y: Math.min(0, Math.max(minY, offset.y)),
  }
}

/**
 * Pick which part of a photo becomes the upload, instead of the server
 * blindly centre-cropping it (avatars/contact photos) or shrinking whatever
 * whitespace came with it (logos/experience photos).
 *
 * Two frame shapes, not one, because the two crops mean different things:
 * `mask="circle"` forces a 1:1 square — the eventual output really is
 * square (`config/images.square_thumbnail`), so the frame has to be too, and
 * a circular cutout previews it as the round avatar it'll become. `mask
 * ="square"` keeps the *photo's own* aspect ratio as the frame — the server
 * side here is `contain_thumbnail`, which never crops a wordmark's corners
 * off, so "zoom" only ever trims margins within that same shape rather than
 * forcing a square nothing here asked for.
 */
export function ImageCropStage({
  file,
  mask,
  onCropped,
}: {
  file: File
  mask: 'circle' | 'square'
  /** Fires with the current crop any time it changes, so Save always has the latest. */
  onCropped: (blob: Blob) => void
}) {
  // Created *and* revoked inside the same effect run, not a memo tied only to
  // `file` — under StrictMode's dev-only mount/cleanup/remount simulation, a
  // memoized URL survives the simulated unmount but the cleanup effect still
  // revokes it, leaving the <img> pointed at a dead blob. Owning both in one
  // effect means the remount mints a fresh URL instead of reusing a revoked one.
  const [objectUrl, setObjectUrl] = useState<string | null>(null)
  useEffect(() => {
    const url = URL.createObjectURL(file)
    setObjectUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const imgRef = useRef<HTMLImageElement>(null)
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 })
  const dragRef = useRef<{ startX: number; startY: number; origin: Offset } | null>(null)

  // Reset to a centred, unzoomed crop whenever a new file comes in.
  useEffect(() => {
    setNatural(null)
    setZoom(1)
    setOffset({ x: 0, y: 0 })
  }, [file])

  const frame = useMemo(() => {
    if (!natural) return null
    if (mask === 'circle') return { w: 260, h: 260 }
    const maxW = 320
    const maxH = 260
    const ratio = natural.w / natural.h
    return ratio > maxW / maxH ? { w: maxW, h: maxW / ratio } : { w: maxH * ratio, h: maxH }
  }, [natural, mask])

  const baseScale = useMemo(() => {
    if (!natural || !frame) return 1
    // 'square' frames already share the photo's aspect, so base scale is
    // exact — zoom 1 shows the whole image with nothing trimmed.
    return Math.max(frame.w / natural.w, frame.h / natural.h)
  }, [natural, frame])

  const scale = baseScale * zoom
  const dispW = natural ? natural.w * scale : 0
  const dispH = natural ? natural.h * scale : 0

  // Centre the image the first time its size is known.
  useEffect(() => {
    if (!natural || !frame) return
    setOffset({ x: (frame.w - natural.w * baseScale) / 2, y: (frame.h - natural.h * baseScale) / 2 })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on first measurement
  }, [natural, frame])

  // Re-clamp (never re-centre) whenever zoom moves the edges past the frame.
  useEffect(() => {
    if (!natural || !frame) return
    setOffset((current) => clampOffset(current, dispW, dispH, frame.w, frame.h))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- clamp only, not a recentre
  }, [zoom, frame?.w, frame?.h])

  function crop() {
    const img = imgRef.current
    if (!img || !natural || !frame || !img.complete) return
    const sx = -offset.x / scale
    const sy = -offset.y / scale
    const sw = frame.w / scale
    const sh = frame.h / scale
    const outW = frame.w >= frame.h ? OUTPUT_MAX : (OUTPUT_MAX * frame.w) / frame.h
    const outH = frame.w >= frame.h ? (OUTPUT_MAX * frame.h) / frame.w : OUTPUT_MAX
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(outW)
    canvas.height = Math.round(outH)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
    const keepsAlpha = file.type === 'image/png' || file.type === 'image/gif'
    canvas.toBlob(
      (blob) => {
        if (blob) onCropped(blob)
      },
      keepsAlpha ? 'image/png' : 'image/jpeg',
      0.92,
    )
  }

  // Any settled state (measured, moved, zoomed) re-exports the crop.
  useEffect(() => {
    if (!natural || !frame) return
    crop()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- crop() closes over everything it needs
  }, [natural, frame, zoom, offset])

  function onPointerDown(event: React.PointerEvent) {
    if (!natural) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { startX: event.clientX, startY: event.clientY, origin: offset }
  }
  function onPointerMove(event: React.PointerEvent) {
    const drag = dragRef.current
    if (!drag || !frame) return
    const next = {
      x: drag.origin.x + (event.clientX - drag.startX),
      y: drag.origin.y + (event.clientY - drag.startY),
    }
    setOffset(clampOffset(next, dispW, dispH, frame.w, frame.h))
  }
  function onPointerUp(event: React.PointerEvent) {
    dragRef.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className={cx(
          'relative touch-none select-none overflow-hidden border border-line bg-surface-2',
          mask === 'circle' ? 'rounded-full' : 'rounded-xl',
        )}
        style={{ width: frame?.w ?? 260, height: frame?.h ?? 260, cursor: natural ? 'grab' : 'default' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {objectUrl ? (
          <img
            ref={imgRef}
            src={objectUrl}
            alt=""
            draggable={false}
            onLoad={(event) => {
              const el = event.currentTarget
              setNatural({ w: el.naturalWidth, h: el.naturalHeight })
            }}
            className="pointer-events-none absolute left-0 top-0 max-w-none origin-top-left"
            style={{ width: dispW || 'auto', height: dispH || 'auto', transform: `translate(${offset.x}px, ${offset.y}px)` }}
          />
        ) : null}
      </div>

      <div className="flex w-full max-w-[260px] items-center gap-2">
        <Icon name="search" size={13} className="shrink-0 text-ink-3" />
        <input
          type="range"
          min={1}
          max={MAX_ZOOM}
          step={0.01}
          value={zoom}
          disabled={!natural}
          onChange={(event) => setZoom(Number(event.target.value))}
          aria-label="Zoom"
          className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-line accent-brand disabled:cursor-not-allowed disabled:opacity-40"
        />
      </div>
      <p className="text-[11px] text-ink-3">Drag to reposition, use the slider to zoom.</p>
    </div>
  )
}
