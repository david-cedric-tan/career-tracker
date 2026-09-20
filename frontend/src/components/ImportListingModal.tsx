import { useRef, useState } from 'react'
import { formatApiError } from '../api/client'
import { jobListings } from '../api/resources'
import type { JobListingImportResult, JobListingImportRow } from '../api/types'
import { JOB_IMPORT_PROMPT } from '../lib/jobImportGuide'
import { Button } from './ui/Button'
import { Icon } from './ui/Icon'
import { Modal } from './ui/Modal'
import { useToast } from './ui/toast-context'


/**
 * "Bring your own AI" for job listings — paste one ad's text into any AI
 * with the copy prompt below and it comes back split into this app's fields
 * (description vs. skills vs. deadline) instead of one pasted blob. Or, with
 * an AI that can actually search/browse live (Grok, say), hand it criteria
 * instead of an ad and it can return several real postings at once — the
 * prompt asks for the same "listings" array either way, and the backend
 * (`applications.imports.import_listings`) already accepts any number of
 * rows, importing each independently so one bad row doesn't sink the batch.
 *
 * Two steps in one modal rather than two dialogs: the prompt is a means to
 * an end, so reopening this after the round trip to the AI should land on
 * the same screen, ready to paste the result underneath.
 */
export function ImportListingModal({ open, onClose, onImported }: {
  open: boolean
  onClose: () => void
  onImported: () => void
}) {
  const { notify } = useToast()
  const [copied, setCopied] = useState(false)
  const [pasted, setPasted] = useState('')
  const [error, setError] = useState('')
  const [importing, setImporting] = useState(false)
  const [results, setResults] = useState<JobListingImportResult[] | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const [lastOpen, setLastOpen] = useState(open)
  if (open !== lastOpen) {
    setLastOpen(open)
    if (open) {
      setPasted('')
      setError('')
      setResults(null)
    }
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(JOB_IMPORT_PROMPT)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API blocked — the prompt is still selectable by hand.
    }
  }

  /** "Smart quotes" from a phone keyboard or a chat app's autocorrect turn
      a straight `"` into a curly “/” before it ever reaches this box — that
      text isn't valid JSON at all (the very first `{` is fine, but the
      first *key* is quoted with the wrong character). Tried only as a
      fallback, never on text that already parses, so it can't mangle a
      quote mark someone actually meant literally. */
  function sanitizeSmartQuotes(text: string): string {
    return text.replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
  }

  /** A pasted multi-line description often carries real newline characters
      where the JSON needs an escaped `\n` — valid *between* tokens (that's
      just formatting), invalid *inside* a string literal. Only the latter
      needs fixing, so this walks string spans specifically rather than
      replacing every newline in the file. */
  function escapeNewlinesInStrings(text: string): string {
    return text.replace(/"(?:[^"\\]|\\.)*"/gs, (match) =>
      match.replace(/\r\n|\r|\n/g, '\\n'),
    )
  }

  function rowsFromText(text: string): JobListingImportRow[] {
    if (!text.trim()) {
      throw new Error('Nothing to import — paste the AI\u2019s reply into the box above first.')
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      try {
        parsed = JSON.parse(sanitizeSmartQuotes(text))
      } catch {
        try {
          parsed = JSON.parse(escapeNewlinesInStrings(sanitizeSmartQuotes(text)))
        } catch (err) {
          // Every repair attempt failed, so report what actually broke rather
          // than one catch-all sentence — the parser's own message points at
          // the offending spot, and the usual culprits are worth naming.
          const reason = err instanceof Error ? err.message : String(err)
          const hints: string[] = []
          if (/^\s*[^[{]/.test(text)) {
            hints.push(
              'it doesn\u2019t start with { or [ — the AI may have added a sentence or ``` fences around the JSON',
            )
          }
          if (text.includes('\u201c') || text.includes('\u201d')) {
            hints.push('it still contains curly quotes that couldn\u2019t be repaired')
          }
          throw new Error(
            `That isn\u2019t valid JSON: ${reason}.` +
              (hints.length ? ` Looks like ${hints.join(', and ')}.` : ''),
            { cause: err },
          )
        }
      }
    }

    const listings = Array.isArray(parsed)
      ? parsed
      : (parsed as { listings?: unknown })?.listings
    if (listings === undefined) {
      throw new Error(
        'That JSON parsed, but there\u2019s no "listings" key in it. The prompt asks for {"listings": [ ... ]}.',
      )
    }
    if (!Array.isArray(listings)) {
      throw new Error('"listings" needs to be an array of job listings, not a single value.')
    }
    if (listings.length === 0) {
      throw new Error('The "listings" array is empty — there\u2019s nothing to import.')
    }
    return listings as JobListingImportRow[]
  }

  async function submit(text: string) {
    setError('')
    let rows: JobListingImportRow[]
    try {
      rows = rowsFromText(text)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return
    }
    setImporting(true)
    try {
      const response = await jobListings.import(rows)
      setResults(response.results)
      const created = response.results.filter((r) => r.ok && r.created).length
      const updated = response.results.filter((r) => r.ok && !r.created).length
      if (created || updated) {
        onImported()
        notify(
          [
            created ? `${created} listing${created === 1 ? '' : 's'} added` : null,
            updated ? `${updated} updated` : null,
          ]
            .filter(Boolean)
            .join(', ') + '.',
        )
      }
    } catch (err) {
      setError(formatApiError(err))
    } finally {
      setImporting(false)
    }
  }

  function onFileChosen(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => void submit(String(reader.result ?? ''))
    reader.readAsText(file)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Import job listings"
      description="Paste a real job ad into any AI with this prompt — or, with an AI that can search the live web (like Grok), ask it to find several matching postings instead. Either way it comes back as the same JSON, split into a description, a skills list and a deadline rather than one pasted wall of text."
      size="lg"
      footer={
        results ? (
          <Button variant="primary" onClick={onClose}>
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
              Import file…
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              onChange={onFileChosen}
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
      {results ? (
        <ImportResults results={results} />
      ) : (
        <div className="flex flex-col gap-4">
          <div>
            <textarea
              readOnly
              value={JOB_IMPORT_PROMPT}
              onFocus={(event) => event.target.select()}
              rows={8}
              className="scrollbar-thin w-full resize-none rounded-t-lg border border-b-0 border-line bg-surface-2 p-3 font-mono text-[12px] leading-relaxed text-ink-2"
            />
            {/* Directly under the thing it copies, not off in the footer with
                the actions that come after the round trip to the AI. */}
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
              Paste what the AI gave you back
            </p>
            <textarea
              value={pasted}
              onChange={(event) => setPasted(event.target.value)}
              placeholder='{"listings": [{ "company": "...", "role": "...", ... }]}'
              rows={6}
              className="scrollbar-thin w-full resize-none rounded-lg border border-line bg-surface p-3 font-mono text-[12px] leading-relaxed text-ink"
            />
            {error ? (
              <p role="alert" className="mt-2 text-[12.5px] text-critical">
                {error}
              </p>
            ) : null}
            <p className="mt-2 text-[12px] text-ink-3">
              Or use <strong className="font-medium text-ink-2">Import file…</strong> below if
              you saved the AI's reply as a .json file instead.
            </p>
          </div>
        </div>
      )}
    </Modal>
  )
}

function ImportResults({ results }: { results: JobListingImportResult[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {results.map((result) => (
        <li
          key={result.index}
          className="flex items-start gap-2.5 rounded-lg border border-line bg-surface-2 px-3 py-2.5"
        >
          <Icon
            name={result.ok ? 'check' : 'alert'}
            size={15}
            className={result.ok ? 'mt-0.5 shrink-0 text-good' : 'mt-0.5 shrink-0 text-critical'}
          />
          <div className="min-w-0 flex-1">
            {result.ok ? (
              <>
                <p className="text-[13px] font-medium text-ink">
                  {result.role} at {result.company}
                </p>
                <p className="text-[11.5px] text-ink-3">
                  {result.created ? 'Added' : 'Updated an existing listing'}
                </p>
                {result.warnings?.map((warning) => (
                  <p key={warning} className="mt-0.5 text-[11.5px] text-warning">
                    {warning}
                  </p>
                ))}
              </>
            ) : (
              <p className="text-[13px] text-critical">{result.error}</p>
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}
