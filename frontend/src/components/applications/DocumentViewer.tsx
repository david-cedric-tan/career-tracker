import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  documentExtension,
  documentPreviewMode,
  readDocumentFormatMode,
  writeDocumentFormatMode,
  type DocumentFormatMode,
  type PreviewSource,
} from '../../lib/documentPreview'
import { convertDocxToHtml } from '../../lib/docxPreview'
import { RichText } from '../../lib/richText'
import { cx, formatDate } from '../../lib/format'
import { formatApiError } from '../../api/client'
import { downloadName, saveFileAs } from '../../lib/download'
import { Button } from '../ui/Button'
import { MentionTextarea } from '../ui/Mention'
import { Icon } from '../ui/Icon'
import { Switch } from '../ui/Switch'
import { fetchDocumentText } from './DocumentThumbnail'

type PaperSize = 'fit' | 'a4' | 'letter'

const PAPER_SIZES: { id: PaperSize; label: string; hint: string }[] = [
  { id: 'fit', label: 'Fit', hint: 'Fill the viewer' },
  { id: 'a4', label: 'A4', hint: '210 × 297 mm' },
  { id: 'letter', label: 'Letter', hint: '8.5 × 11 in' },
]

const PAPER_SIZE_KEY = 'career-tracker:document-paper-size'

/** The chip text for one format in the switcher: the extension when the
    name carries one ("PDF", "DOCX"), else the API's kind label ("Word"). */
function formatLabel(source: PreviewSource): string {
  const extension = documentExtension(source)
  if (extension) return extension.toUpperCase()
  return source.file_kind || 'File'
}

function readPaperSize(): PaperSize {
  try {
    const raw = localStorage.getItem(PAPER_SIZE_KEY)
    if (raw === 'a4' || raw === 'letter' || raw === 'fit') return raw
  } catch {
    /* ignore */
  }
  return 'a4'
}

/**
 * In-app document viewer — blur backdrop, paper sizes, Read vs Original
 * formatting, and in-browser reading for PDFs, images, text, and Word (.docx).
 */
export type ViewerComments = {
  value: string
  /** Persists the notes; the viewer shows the saved text once it resolves. */
  onSave: (text: string) => Promise<void>
}

export function DocumentViewer({
  item: initialItem,
  alternates,
  onClose,
  comments,
}: {
  item: PreviewSource
  /** Other formats of the same document (a resume's .docx beside its .pdf).
      When given, the header grows a toggle to switch between them; `item`
      is whichever one opens first. */
  alternates?: PreviewSource[]
  onClose: () => void
  /** Notes on the document, editable from the comment button in the header. */
  comments?: ViewerComments
}) {
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  // Every format, primary first, de-duplicated by URL so a caller that
  // passes `item` inside `alternates` too doesn't get it twice.
  const formats = [initialItem, ...(alternates ?? [])].filter(
    (entry, index, all) => all.findIndex((other) => other.file === entry.file) === index,
  )
  const [activeFile, setActiveFile] = useState(initialItem.file)
  // Callers keep this mounted and swap `item` to open the next document, so
  // a stale pick from the previous one has to be dropped here.
  useEffect(() => {
    setActiveFile(initialItem.file)
  }, [initialItem.file])
  const item = formats.find((entry) => entry.file === activeFile) ?? initialItem
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [draft, setDraft] = useState(comments?.value ?? '')
  const [savingComments, setSavingComments] = useState(false)
  const [commentsError, setCommentsError] = useState('')
  const commentsDirty = Boolean(comments) && draft !== (comments?.value ?? '')

  async function saveComments() {
    if (!comments) return
    setSavingComments(true)
    setCommentsError('')
    try {
      await comments.onSave(draft)
      setCommentsOpen(false)
    } catch (err) {
      setCommentsError(formatApiError(err))
    } finally {
      setSavingComments(false)
    }
  }
  const [paperSize, setPaperSize] = useState<PaperSize>(readPaperSize)
  const [formatMode, setFormatMode] = useState<DocumentFormatMode>(readDocumentFormatMode)
  const [sizeMenuOpen, setSizeMenuOpen] = useState(false)
  const sizeMenuRef = useRef<HTMLDivElement>(null)

  const mode = documentPreviewMode(item)
  const supportsPaper = mode === 'html' || mode === 'text'
  // PDFs and images render as-is — the browser's PDF viewer keeps links
  // clickable, and a greyscale "read" filter only hid them.
  const supportsFormatToggle = mode === 'html' || mode === 'text'

  useEffect(() => {
    const previous = window.document.body.style.overflow
    window.document.body.style.overflow = 'hidden'
    return () => {
      window.document.body.style.overflow = previous
    }
  }, [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        if (sizeMenuOpen) {
          setSizeMenuOpen(false)
          return
        }
        closeRef.current()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [sizeMenuOpen])

  useEffect(() => {
    if (!sizeMenuOpen) return
    function onPointerDown(event: MouseEvent) {
      if (!sizeMenuRef.current?.contains(event.target as Node)) {
        setSizeMenuOpen(false)
      }
    }
    window.addEventListener('mousedown', onPointerDown)
    return () => window.removeEventListener('mousedown', onPointerDown)
  }, [sizeMenuOpen])

  function choosePaperSize(next: PaperSize) {
    setPaperSize(next)
    setSizeMenuOpen(false)
    try {
      localStorage.setItem(PAPER_SIZE_KEY, next)
    } catch {
      /* ignore */
    }
  }

  function chooseFormatMode(original: boolean) {
    const next: DocumentFormatMode = original ? 'original' : 'read'
    setFormatMode(next)
    writeDocumentFormatMode(next)
  }

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 sm:p-6">
      <button
        type="button"
        aria-label="Close document viewer"
        className="absolute inset-0 bg-slate-950/45 backdrop-blur-md"
        onClick={onClose}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="document-viewer-title"
        className="glass-panel relative flex max-h-[92dvh] w-full max-w-5xl flex-col overflow-hidden border border-line bg-surface shadow-2xl intern:backdrop-blur-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 id="document-viewer-title" className="truncate text-[15px] font-semibold text-ink">
              {item.title}
            </h2>
            <p className="mt-0.5 text-[12px] text-ink-3">
              {item.file_kind ? `${item.file_kind} · ` : ''}
              {item.created_at ? formatDate(item.created_at.slice(0, 10)) : null}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {formats.length > 1 ? (
              <div
                role="radiogroup"
                aria-label="Document format"
                className="inline-flex rounded-lg border border-line bg-surface-2/80 p-0.5"
              >
                {formats.map((entry) => {
                  const kind = formatLabel(entry)
                  const active = entry.file === item.file
                  return (
                    <button
                      key={entry.file}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setActiveFile(entry.file)}
                      title={entry.original_name || entry.file_name || kind}
                      className={cx(
                        'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold uppercase tracking-wide transition-colors',
                        active ? 'bg-surface text-brand shadow-sm' : 'text-ink-3 hover:text-ink',
                      )}
                    >
                      <Icon name="file" size={12} />
                      {kind}
                    </button>
                  )
                })}
              </div>
            ) : null}
            {supportsFormatToggle ? (
              <label className="flex items-center gap-2 rounded-lg border border-line bg-surface-2/80 px-2.5 py-1">
                <span
                  className={cx(
                    'text-[11.5px] font-medium transition-colors',
                    formatMode === 'read' ? 'text-ink' : 'text-ink-3',
                  )}
                >
                  Read
                </span>
                <Switch
                  checked={formatMode === 'original'}
                  onChange={chooseFormatMode}
                  label="Original formatting"
                />
                <span
                  className={cx(
                    'text-[11.5px] font-medium transition-colors',
                    formatMode === 'original' ? 'text-ink' : 'text-ink-3',
                  )}
                >
                  Original
                </span>
              </label>
            ) : null}
            {supportsPaper ? (
              <div ref={sizeMenuRef} className="relative">
                <button
                  type="button"
                  onClick={() => setSizeMenuOpen((open) => !open)}
                  aria-label={`Page size: ${paperSize.toUpperCase()}`}
                  aria-expanded={sizeMenuOpen}
                  title="Page size"
                  className={cx(
                    'inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink',
                    sizeMenuOpen && 'bg-surface-2 text-ink',
                  )}
                >
                  <Icon name="page" size={15} />
                  <span className="text-[11px] font-semibold uppercase tracking-wide">
                    {paperSize === 'fit' ? 'Fit' : paperSize.toUpperCase()}
                  </span>
                </button>
                {sizeMenuOpen ? (
                  <div
                    role="menu"
                    className="absolute right-0 top-full z-10 mt-1 min-w-[9.5rem] overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-lg"
                  >
                    {PAPER_SIZES.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        role="menuitemradio"
                        aria-checked={paperSize === option.id}
                        onClick={() => choosePaperSize(option.id)}
                        className={cx(
                          'flex w-full flex-col items-start px-3 py-1.5 text-left transition-colors hover:bg-surface-2',
                          paperSize === option.id ? 'text-brand' : 'text-ink',
                        )}
                      >
                        <span className="text-[12.5px] font-medium">{option.label}</span>
                        <span className="text-[10.5px] text-ink-3">{option.hint}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
            {comments ? (
              <button
                type="button"
                onClick={() => setCommentsOpen((open) => !open)}
                aria-pressed={commentsOpen}
                aria-label="Comments"
                title="Comments"
                className={cx(
                  'relative rounded-lg p-2 transition-colors hover:bg-surface-2',
                  commentsOpen ? 'bg-brand-soft text-brand-strong' : 'text-ink-3 hover:text-brand',
                )}
              >
                <Icon name="comment" size={16} />
                {comments.value.trim() ? (
                  <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-brand" />
                ) : null}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() =>
                void saveFileAs(
                  item.file,
                  downloadName(item.title, item.original_name || item.file_name || item.file),
                ).catch(() => window.open(item.file, '_blank', 'noopener'))
              }
              aria-label={`Download ${item.title}`}
              title="Download"
              className="rounded-lg p-2 text-ink-3 transition-colors hover:bg-surface-2 hover:text-brand"
            >
              <Icon name="download" size={16} />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-lg p-2 text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        </header>

        <div
          className={cx(
            'min-h-0 flex-1 overflow-auto',
            supportsPaper && paperSize !== 'fit' ? 'bg-zinc-400/35 dark:bg-zinc-800/60' : 'bg-surface-2/50',
          )}
        >
          <DocumentViewerBody
            item={item}
            mode={mode}
            paperSize={paperSize}
            formatMode={formatMode}
          />
        </div>

        {comments && commentsOpen ? (
          <footer className="shrink-0 border-t border-line bg-surface px-4 py-3 sm:px-5">
            <MentionTextarea
              label="Comments"
              rows={4}
              value={draft}
              onChange={setDraft}
              placeholder="Notes on this document — what changed in this version, what to fix next time… (@ to tag)"
            />
            {commentsError ? (
              <p role="alert" className="mt-1.5 text-[12px] text-critical">
                {commentsError}
              </p>
            ) : null}
            <div className="mt-2 flex items-center justify-end gap-2">
              <Button
                size="sm"
                onClick={() => {
                  setDraft(comments.value)
                  setCommentsOpen(false)
                }}
                disabled={savingComments}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                variant="primary"
                onClick={() => void saveComments()}
                disabled={!commentsDirty}
                loading={savingComments}
              >
                Save comments
              </Button>
            </div>
          </footer>
        ) : comments?.value.trim() ? (
          <footer className="shrink-0 border-t border-line px-4 py-2.5 sm:px-5">
            <RichText text={comments.value} className="text-[12px] text-ink-2" />
          </footer>
        ) : item.description ? (
          <footer className="shrink-0 border-t border-line px-4 py-2.5 sm:px-5">
            <RichText text={item.description} className="text-[12px] text-ink-2" />
          </footer>
        ) : null}
      </div>
    </div>,
    window.document.body,
  )
}

function DocumentViewerBody({
  item,
  mode,
  paperSize,
  formatMode,
}: {
  item: PreviewSource
  mode: ReturnType<typeof documentPreviewMode>
  paperSize: PaperSize
  formatMode: DocumentFormatMode
}) {
  if (mode === 'image') {
    return (
      <div className="flex min-h-[50dvh] items-center justify-center p-4 sm:p-6">
        <img
          src={item.file}
          alt={item.title}
          className="max-h-[75dvh] max-w-full rounded-lg object-contain shadow-md"
        />
      </div>
    )
  }

  if (mode === 'pdf') {
    return (
      <iframe
        src={`${item.file}#view=FitH`}
        title={item.title}
        className="h-[min(75dvh,900px)] w-full border-0 bg-white"
      />
    )
  }

  if (mode === 'text') {
    return (
      <PaperFrame paperSize={paperSize}>
        <TextViewer url={item.file} formatMode={formatMode} />
      </PaperFrame>
    )
  }

  if (mode === 'html') {
    return (
      <PaperFrame paperSize={paperSize}>
        <DocxViewer url={item.file} title={item.title} formatMode={formatMode} />
      </PaperFrame>
    )
  }

  return <UnsupportedPreview item={item} />
}

/** Centres content on a paper sheet (A4 / Letter) or stretches to fill. */
function PaperFrame({
  paperSize,
  children,
}: {
  paperSize: PaperSize
  children: ReactNode
}) {
  if (paperSize === 'fit') {
    return <div className="min-h-full bg-white">{children}</div>
  }

  return (
    <div className="flex justify-center p-4 sm:p-6">
      <div
        className={cx(
          'document-paper-sheet w-full bg-white text-ink shadow-[0_8px_30px_rgba(0,0,0,0.18)]',
          paperSize === 'a4' && 'document-paper-a4',
          paperSize === 'letter' && 'document-paper-letter',
        )}
      >
        {children}
      </div>
    </div>
  )
}

function TextViewer({
  url,
  formatMode,
}: {
  url: string
  formatMode: DocumentFormatMode
}) {
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchDocumentText(url)
      .then((content) => {
        if (!cancelled) setText(content)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
    return () => {
      cancelled = true
    }
  }, [url])

  if (error) return <LoadError url={url} />
  if (!text) return <LoadingPreview />

  return (
    <pre
      className={cx(
        'whitespace-pre-wrap p-6 text-[13px] leading-relaxed sm:p-10',
        formatMode === 'read'
          ? 'font-mono text-ink document-preview-read'
          : 'font-sans text-zinc-900 document-preview-original',
      )}
    >
      {text}
    </pre>
  )
}

function DocxViewer({
  url,
  title,
  formatMode,
}: {
  url: string
  title: string
  formatMode: DocumentFormatMode
}) {
  const [html, setHtml] = useState<string | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    setHtml(null)
    setError(false)
    convertDocxToHtml(url, { preserveFormatting: formatMode === 'original' })
      .then((content) => {
        if (!cancelled) setHtml(content)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })

    return () => {
      cancelled = true
    }
  }, [url, formatMode])

  if (error) return <LoadError url={url} />
  if (!html) return <LoadingPreview />

  return (
    <article
      className={cx(
        'document-preview-html p-6 text-[14px] leading-relaxed sm:p-10',
        formatMode === 'read' ? 'document-preview-read text-ink' : 'document-preview-original',
      )}
      dangerouslySetInnerHTML={{ __html: html }}
      aria-label={title}
    />
  )
}

function UnsupportedPreview({ item }: { item: PreviewSource }) {
  return (
    <div className="flex min-h-[40dvh] flex-col items-center justify-center gap-3 p-8 text-center">
      <Icon name="file" size={36} className="text-brand" />
      <p className="max-w-sm text-[14px] text-ink-2">
        In-browser preview isn&apos;t available for{' '}
        {item.file_kind ?? 'this file type'}. Open it in a new tab to view
        with your system app.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button
          variant="primary"
          size="sm"
          icon={<Icon name="download" size={14} />}
          onClick={() => {
            const link = window.document.createElement('a')
            link.href = item.file
            link.download = item.original_name || item.title
            link.target = '_blank'
            link.rel = 'noreferrer noopener'
            link.click()
          }}
        >
          Download
        </Button>
        <Button
          size="sm"
          icon={<Icon name="link" size={14} />}
          onClick={() => window.open(item.file, '_blank', 'noopener,noreferrer')}
        >
          Open in new tab
        </Button>
      </div>
    </div>
  )
}

function LoadingPreview() {
  return (
    <div className="grid min-h-[40dvh] place-items-center text-[13px] text-ink-3">
      Loading preview…
    </div>
  )
}

function LoadError({ url }: { url: string }) {
  return (
    <div className="flex min-h-[40dvh] flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="text-[14px] text-ink-2">Couldn&apos;t load a preview for this file.</p>
      <Button
        variant="primary"
        size="sm"
        icon={<Icon name="link" size={14} />}
        onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
      >
        Open in new tab
      </Button>
    </div>
  )
}
