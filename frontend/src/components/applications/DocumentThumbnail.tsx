import { useEffect, useState } from 'react'
import {
  documentExtension,
  documentPreviewMode,
  type DocumentPreviewMode,
  type PreviewSource,
} from '../../lib/documentPreview'
import { convertDocxToHtml } from '../../lib/docxPreview'
import { renderPdfThumbnail } from '../../lib/pdfPreview'
import { peekThumbnail } from '../../lib/thumbnailCache'
import { cx } from '../../lib/format'
import { Icon } from '../ui/Icon'

const TEXT_SNIPPET_BYTES = 1200

/**
 * Visual preview for a document card — image cover, PDF first page, text
 * snippet, Word HTML preview, or a labelled file-type tile.
 */
export function DocumentThumbnail({
  document,
  className,
}: {
  document: PreviewSource
  className?: string
}) {
  const mode = documentPreviewMode(document)

  if (mode === 'image') {
    return (
      <img
        src={document.file}
        alt=""
        loading="lazy"
        className={cx('size-full object-cover transition-transform group-hover/doc:scale-105', className)}
      />
    )
  }

  if (mode === 'pdf') {
    return <PdfThumbnail url={document.file} className={className} />
  }

  if (mode === 'text') {
    return <TextThumbnail url={document.file} className={className} />
  }

  if (mode === 'html') {
    return (
      <DocxThumbnail
        url={document.file}
        fileKind={document.file_kind ?? null}
        className={className}
      />
    )
  }

  return (
    <FileTypeTile
      fileKind={document.file_kind ?? null}
      extension={documentExtension(document)}
      mode={mode}
      className={className}
    />
  )
}

function PdfThumbnail({ url, className }: { url: string; className?: string }) {
  // Synchronous cache hit paints on the first frame — no fetch, no flash.
  const [src, setSrc] = useState<string | null>(() => peekThumbnail(url))
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (peekThumbnail(url)) return
    let cancelled = false
    renderPdfThumbnail(url)
      .then((dataUrl) => {
        if (!cancelled) setSrc(dataUrl)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [url])

  if (failed) {
    return <FileTypeTile fileKind="PDF" extension="pdf" mode="pdf" className={className} />
  }

  if (!src) {
    return (
      <div className={cx('size-full animate-pulse bg-surface-2', className)} aria-hidden />
    )
  }

  return (
    <img
      src={src}
      alt=""
      className={cx('size-full bg-white object-cover object-top', className)}
      aria-hidden
    />
  )
}

function TextThumbnail({ url, className }: { url: string; className?: string }) {
  const [snippet, setSnippet] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error('fetch failed')
        return response.text()
      })
      .then((text) => {
        if (cancelled) return
        const trimmed = text.replace(/\s+/g, ' ').trim()
        setSnippet(trimmed.slice(0, 240) || '(empty file)')
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })

    return () => {
      cancelled = true
    }
  }, [url])

  if (failed) {
    return <FileTypeTile fileKind="Text" extension="txt" mode="text" className={className} />
  }

  if (!snippet) {
    return (
      <div
        className={cx(
          'grid size-full place-items-center bg-surface text-[11px] text-ink-3',
          className,
        )}
      >
        Loading…
      </div>
    )
  }

  return (
    <div
      className={cx(
        'size-full overflow-hidden bg-white p-2 text-left text-[8px] leading-snug text-ink-2',
        className,
      )}
      aria-hidden
    >
      <p className="line-clamp-[7] whitespace-pre-wrap font-mono">{snippet}</p>
    </div>
  )
}

/** Actual Word content preview with a grey type badge overlaid on top. */
function DocxThumbnail({
  url,
  fileKind,
  className,
}: {
  url: string
  fileKind: string | null
  className?: string
}) {
  const [html, setHtml] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    convertDocxToHtml(url)
      .then((content) => {
        if (!cancelled) setHtml(content)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [url])

  if (failed) {
    return <FileTypeTile fileKind="Word" extension="docx" mode="html" className={className} />
  }

  if (!html) {
    return (
      <div
        className={cx(
          'relative grid size-full place-items-center bg-white text-[11px] text-ink-3',
          className,
        )}
      >
        Loading…
        <TypeBadge label={fileKind || 'Word'} />
      </div>
    )
  }

  return (
    <div className={cx('relative size-full overflow-hidden bg-[#f4f4f5]', className)} aria-hidden>
      <div className="document-thumb-html origin-top-left scale-[0.28] p-3 text-[12px] leading-snug text-ink">
        <div dangerouslySetInnerHTML={{ __html: html }} />
      </div>
      <TypeBadge label={fileKind || 'Word'} />
    </div>
  )
}

function TypeBadge({ label }: { label: string }) {
  return (
    <span className="pointer-events-none absolute left-1.5 top-1.5 rounded bg-ink-3/90 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white shadow-sm">
      {label}
    </span>
  )
}

function FileTypeTile({
  fileKind,
  extension,
  mode,
  className,
}: {
  fileKind: string | null
  extension: string
  mode: DocumentPreviewMode
  className?: string
}) {
  const label = fileKind || extension.toUpperCase() || 'Document'
  const tone =
    mode === 'html'
      ? 'from-zinc-400/20 to-zinc-500/5 text-ink-2'
      : mode === 'pdf'
        ? 'from-red-500/15 to-red-600/5 text-red-700'
        : extension === 'pptx' || extension === 'ppt'
          ? 'from-orange-500/15 to-orange-600/5 text-orange-700'
          : extension === 'pages'
            ? 'from-amber-500/15 to-amber-600/5 text-amber-800'
            : 'from-brand/15 to-brand/5 text-brand'

  return (
    <div
      className={cx(
        'relative grid size-full place-items-center bg-gradient-to-br',
        tone,
        className,
      )}
      aria-hidden
    >
      <div className="flex flex-col items-center gap-1.5">
        <Icon name="file" size={28} />
        <span className="max-w-[90%] truncate text-[11px] font-semibold uppercase tracking-wide">
          {label}
        </span>
      </div>
      {mode === 'html' || extension === 'pages' || extension === 'pptx' || extension === 'ppt' ? (
        <TypeBadge label={label} />
      ) : null}
    </div>
  )
}

/** Fetch full text for the viewer (txt/rtf/md). */
export async function fetchDocumentText(url: string): Promise<string> {
  const response = await fetch(url)
  if (!response.ok) throw new Error('Could not load document')
  const text = await response.text()
  if (text.length > TEXT_SNIPPET_BYTES * 40) {
    return text.slice(0, TEXT_SNIPPET_BYTES * 40)
  }
  return text
}
