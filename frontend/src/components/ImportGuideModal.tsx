import { useRef, useState, type DragEvent } from 'react'
import { formatApiError } from '../api/client'
import { backup, type AiImportSummary } from '../api/resources'
import { IMPORT_GUIDE_PROMPT } from '../lib/importGuide'
import { cx } from '../lib/format'
import { Button } from './ui/Button'
import { Icon } from './ui/Icon'
import { Modal } from './ui/Modal'
import { useToast } from './ui/toast-context'

/**
 * Bring Your Own AI — copy the prompt, hand an existing tracker to any AI,
 * then paste / drop / upload the JSON it returns. The server merges into the
 * account (it does not replace Backup & Restore).
 */
export function ImportGuideModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { notify } = useToast()
  const [copied, setCopied] = useState(false)
  const [pasted, setPasted] = useState('')
  const [error, setError] = useState('')
  const [importing, setImporting] = useState(false)
  const [summary, setSummary] = useState<AiImportSummary | null>(null)
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const [lastOpen, setLastOpen] = useState(open)
  if (open !== lastOpen) {
    setLastOpen(open)
    if (open) {
      setPasted('')
      setError('')
      setSummary(null)
      setDragging(false)
    }
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(IMPORT_GUIDE_PROMPT)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Prompt stays selectable in the textarea.
    }
  }

  function sanitizeSmartQuotes(text: string): string {
    return text.replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
  }

  function escapeNewlinesInStrings(text: string): string {
    return text.replace(/"(?:[^"\\]|\\.)*"/gs, (match) =>
      match.replace(/\r\n|\r|\n/g, '\\n'),
    )
  }

  function stripFences(text: string): string {
    const trimmed = text.trim()
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
    return fenced ? fenced[1].trim() : trimmed
  }

  function payloadFromText(text: string): Record<string, unknown> {
    const cleaned = stripFences(text)
    if (!cleaned) {
      throw new Error('Nothing to import — paste the AI’s reply or drop a .json file first.')
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(cleaned)
    } catch {
      try {
        parsed = JSON.parse(sanitizeSmartQuotes(cleaned))
      } catch {
        try {
          parsed = JSON.parse(escapeNewlinesInStrings(sanitizeSmartQuotes(cleaned)))
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err)
          const hints: string[] = []
          if (/^\s*[^[{]/.test(cleaned)) {
            hints.push(
              'it doesn’t start with { — the AI may have added a sentence or ``` fences around the JSON',
            )
          }
          if (cleaned.includes('\u201c') || cleaned.includes('\u201d')) {
            hints.push('it still contains curly quotes that couldn’t be repaired')
          }
          throw new Error(
            `That isn’t valid JSON: ${reason}.` +
              (hints.length ? ` Looks like ${hints.join(', and ')}.` : ''),
            { cause: err },
          )
        }
      }
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Expected a JSON object like {"applications": [...], "people": [...], ...}.')
    }
    return parsed as Record<string, unknown>
  }

  async function submit(text: string) {
    setError('')
    let payload: Record<string, unknown>
    try {
      payload = payloadFromText(text)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return
    }

    setImporting(true)
    try {
      const result = await backup.importFromAi(payload)
      setSummary(result)
      const added = totalAdded(result)
      if (added > 0) {
        notify(
          `Imported ${added} item${added === 1 ? '' : 's'} into your account.`,
        )
      } else if (result.errors.length === 0) {
        notify('Nothing new to add — those rows were already in your account.')
      }
    } catch (err) {
      setError(formatApiError(err))
    } finally {
      setImporting(false)
    }
  }

  function onFileChosen(file: File | undefined) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result ?? '')
      setPasted(text)
      void submit(text)
    }
    reader.onerror = () => setError('Couldn’t read that file.')
    reader.readAsText(file)
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    const file = event.dataTransfer.files?.[0]
    if (file) onFileChosen(file)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Import from another tracker"
      description="Copy the prompt into any AI with your spreadsheet or notes. Paste or drop the JSON it returns here — we’ll add it to your account without wiping what you already have."
      size="lg"
      footer={
        summary ? (
          <Button
            variant="primary"
            onClick={() => {
              onClose()
              window.location.reload()
            }}
          >
            Done
          </Button>
        ) : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button
              onClick={() => fileRef.current?.click()}
              disabled={importing}
              icon={<Icon name="file" size={15} />}
            >
              Choose file…
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json,text/plain"
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                onFileChosen(file)
              }}
              className="hidden"
            />
            <Button
              variant="primary"
              loading={importing}
              disabled={!pasted.trim()}
              onClick={() => void submit(pasted)}
              icon={<Icon name="sparkles" size={15} />}
            >
              Import
            </Button>
          </>
        )
      }
    >
      {summary ? (
        <ImportSummaryView summary={summary} />
      ) : (
        <div className="flex flex-col gap-4">
          <div>
            <p className="mb-2 text-[13px] font-medium text-ink">1. Copy this prompt</p>
            <textarea
              readOnly
              value={IMPORT_GUIDE_PROMPT}
              onFocus={(event) => event.target.select()}
              rows={7}
              className="scrollbar-thin w-full resize-none rounded-t-lg border border-b-0 border-line bg-surface-2 p-3 font-mono text-[12px] leading-relaxed text-ink-2"
            />
            <button
              type="button"
              onClick={() => void copyPrompt()}
              className="flex w-full items-center justify-center gap-1.5 rounded-b-lg border border-line bg-surface py-1.5 text-[12.5px] font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <Icon name={copied ? 'check' : 'file'} size={13} />
              {copied ? 'Copied' : 'Copy prompt'}
            </button>
          </div>

          <div className="border-t border-line pt-4">
            <p className="mb-2 text-[13px] font-medium text-ink">
              2. Paste what the AI gave you back
            </p>
            <div
              onDragEnter={(event) => {
                event.preventDefault()
                setDragging(true)
              }}
              onDragOver={(event) => {
                event.preventDefault()
                setDragging(true)
              }}
              onDragLeave={(event) => {
                event.preventDefault()
                if (event.currentTarget.contains(event.relatedTarget as Node)) return
                setDragging(false)
              }}
              onDrop={onDrop}
              className={cx(
                'rounded-lg border border-dashed transition-colors',
                dragging ? 'border-brand bg-brand-soft/40' : 'border-line',
              )}
            >
              <textarea
                value={pasted}
                onChange={(event) => setPasted(event.target.value)}
                placeholder='{"applications": [{ "company": "...", "role": "..." }], "people": [ ... ]}'
                rows={7}
                className="scrollbar-thin w-full resize-none rounded-lg border-0 bg-transparent p-3 font-mono text-[12px] leading-relaxed text-ink outline-none"
              />
              <p className="border-t border-line/70 px-3 py-2 text-[12px] text-ink-3">
                Or drag a <span className="font-medium text-ink-2">.json</span> file onto this
                box, or use <span className="font-medium text-ink-2">Choose file…</span> below.
              </p>
            </div>
            {error ? (
              <p role="alert" className="mt-2 text-[12.5px] text-critical">
                {error}
              </p>
            ) : null}
          </div>
        </div>
      )}
    </Modal>
  )
}

const SECTION_LABELS: Record<string, string> = {
  companies: 'Companies',
  applications: 'Applications',
  people: 'Contacts',
  catchups: 'Catch-ups',
  todos: 'Todos',
  calendar_events: 'Calendar events',
}

function totalAdded(summary: AiImportSummary): number {
  return Object.values(SECTION_LABELS).reduce((sum, _label, index) => {
    const key = Object.keys(SECTION_LABELS)[index]
    const bucket = summary[key as keyof AiImportSummary]
    if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) return sum
    const counts = bucket as { created?: number; updated?: number }
    return sum + (counts.created ?? 0) + (counts.updated ?? 0)
  }, 0)
}

function ImportSummaryView({ summary }: { summary: AiImportSummary }) {
  const rows = Object.entries(SECTION_LABELS)
    .map(([key, label]) => {
      const bucket = summary[key as keyof AiImportSummary] as
        | { created: number; updated: number; skipped: number }
        | undefined
      if (!bucket) return null
      const parts = [
        bucket.created ? `${bucket.created} added` : null,
        bucket.updated ? `${bucket.updated} updated` : null,
        bucket.skipped ? `${bucket.skipped} already there` : null,
      ].filter(Boolean)
      if (parts.length === 0) return null
      return { label, parts: parts.join(', ') }
    })
    .filter(Boolean) as { label: string; parts: string }[]

  return (
    <div className="flex flex-col gap-4">
      {rows.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li
              key={row.label}
              className="flex items-start gap-2.5 rounded-lg border border-line bg-surface-2 px-3 py-2.5"
            >
              <Icon name="check" size={15} className="mt-0.5 shrink-0 text-good" />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-ink">{row.label}</p>
                <p className="text-[11.5px] text-ink-3">{row.parts}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-ink-2">No new rows were added.</p>
      )}

      {summary.errors.length > 0 ? (
        <div>
          <p className="mb-1.5 text-[12.5px] font-medium text-critical">
            {summary.errors.length} row{summary.errors.length === 1 ? '' : 's'} couldn’t import
          </p>
          <ul className="flex max-h-40 flex-col gap-1.5 overflow-y-auto">
            {summary.errors.map((err) => (
              <li
                key={`${err.section}-${err.index}-${err.error}`}
                className="rounded-lg border border-critical/25 bg-critical/10 px-3 py-2 text-[12px] text-ink"
              >
                <span className="font-medium text-ink-2">
                  {SECTION_LABELS[err.section] ?? err.section} #{err.index + 1}:
                </span>{' '}
                {err.error}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {summary.warnings.length > 0 ? (
        <details className="text-[12px] text-ink-3">
          <summary className="cursor-pointer font-medium text-ink-2">
            {summary.warnings.length} note{summary.warnings.length === 1 ? '' : 's'}
          </summary>
          <ul className="mt-2 flex max-h-32 flex-col gap-1 overflow-y-auto">
            {summary.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </details>
      ) : null}

      <p className="text-[12px] text-ink-3">
        Done reloads the app so every page shows the imported data.
      </p>
    </div>
  )
}
