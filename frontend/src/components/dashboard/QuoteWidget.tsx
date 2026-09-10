import { useEffect, useMemo, useState } from 'react'
import { cx } from '../../lib/format'
import { Button } from '../ui/Button'
import { Input, Textarea } from '../ui/Field'
import { Icon } from '../ui/Icon'
import { Modal } from '../ui/Modal'
import { useToast } from '../ui/toast-context'

type Quote = { text: string; source: string }

const STORAGE_KEY = 'career-tracker:quotes'

/** Used until you supply your own, so the widget is never blank. */
const FALLBACK: Quote[] = [
  { text: 'Rejection is redirection. Log it and move.', source: 'Careers desk' },
  {
    text: 'The best time to network was a year ago. The second best is today.',
    source: 'Old proverb, adapted',
  },
  { text: 'You miss 100% of the applications you don’t submit.', source: 'Also a proverb' },
  { text: 'Momentum beats motivation. Send one more.', source: 'Anon' },
  { text: 'A follow-up is not a nuisance. Silence is.', source: 'Every recruiter, quietly' },
]

/** Pasteable into any assistant to produce a file this widget accepts. */
const AI_PROMPT = `Give me 20 short quotes that would motivate someone job hunting.
Return ONLY valid JSON — no commentary, no markdown fences — as an array of
objects with exactly two string keys, "text" and "source":

[
  { "text": "The quote itself.", "source": "Who said it" }
]

Keep each quote under 140 characters. Use "Unknown" as the source if you
aren't certain who said it — don't invent an attribution.`

function readQuotes(): Quote[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = parseQuotes(raw)
    return parsed.length ? parsed : null
  } catch {
    return null
  }
}

/**
 * Pull quotes out of whatever was pasted.
 *
 * Deliberately forgiving about the wrapper — assistants like to answer with
 * ```json fences, or nest the array under a key — but strict about each entry,
 * since a quote with no text is just a blank card.
 */
function parseQuotes(raw: string): Quote[] {
  const cleaned = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '')
  const parsed: unknown = JSON.parse(cleaned)

  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { quotes?: unknown })?.quotes)
      ? (parsed as { quotes: unknown[] }).quotes
      : []

  return list
    .map((entry) => {
      if (typeof entry === 'string') return { text: entry.trim(), source: 'Unknown' }
      const row = entry as { text?: unknown; source?: unknown; author?: unknown }
      const text = typeof row.text === 'string' ? row.text.trim() : ''
      const source =
        typeof row.source === 'string'
          ? row.source.trim()
          : typeof row.author === 'string'
            ? row.author.trim()
            : ''
      return { text, source: source || 'Unknown' }
    })
    .filter((quote) => quote.text.length > 0)
}

/**
 * A quote a day, from your own collection.
 *
 * Stored per browser rather than on the account: it's a bit of desk
 * decoration, and pushing it through the API would mean a migration and an
 * endpoint for something that never leaves this widget.
 */
export function QuoteWidget() {
  const { notify } = useToast()
  const [quotes, setQuotes] = useState<Quote[] | null>(readQuotes)
  const [editing, setEditing] = useState(false)

  const pool = quotes?.length ? quotes : FALLBACK
  // Indexed by the day, so it holds steady through re-renders and changes
  // once tomorrow — reading the clock during render would make it flicker.
  const [today] = useState(() => Math.floor(Date.now() / 86_400_000))
  const quote = pool[today % pool.length]

  function save(next: Quote[]) {
    setQuotes(next.length ? next : null)
    try {
      if (next.length) localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      else localStorage.removeItem(STORAGE_KEY)
    } catch {
      notify('Saved for this session only — storage is blocked.', 'error')
    }
  }

  return (
    <div className="group/quote relative flex h-full flex-col justify-between gap-3">
      <p className="text-[15px] font-medium leading-snug text-ink">“{quote.text}”</p>
      <div className="flex items-end justify-between gap-2">
        <p className="text-[12px] text-ink-3">
          — {quote.source}
          {quotes?.length ? (
            <span className="ml-1.5 text-ink-3 opacity-70">· {quotes.length} saved</span>
          ) : null}
        </p>
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label="Manage your quotes"
          title="Manage quotes"
          className="shrink-0 rounded-lg p-1 text-ink-3 opacity-0 transition-opacity hover:text-brand focus:opacity-100 group-hover/quote:opacity-100"
        >
          <Icon name="edit" size={13} />
        </button>
      </div>

      {editing ? (
        <QuoteManager
          quotes={quotes ?? []}
          onClose={() => setEditing(false)}
          onSave={save}
        />
      ) : null}
    </div>
  )
}

type Mode = 'manual' | 'json'

function QuoteManager({
  quotes,
  onClose,
  onSave,
}: {
  quotes: Quote[]
  onClose: () => void
  onSave: (quotes: Quote[]) => void
}) {
  const { notify } = useToast()
  const [mode, setMode] = useState<Mode>(quotes.length > 3 ? 'json' : 'manual')
  const [rows, setRows] = useState<Quote[]>(
    quotes.length ? quotes : [{ text: '', source: '' }],
  )
  const [raw, setRaw] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1500)
    return () => window.clearTimeout(timer)
  }, [copied])

  const preview = useMemo(() => {
    if (mode !== 'json' || !raw.trim()) return null
    try {
      return { quotes: parseQuotes(raw), error: '' }
    } catch {
      return { quotes: [], error: "That isn't valid JSON." }
    }
  }, [mode, raw])

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(AI_PROMPT)
      setCopied(true)
    } catch {
      notify('Could not copy the prompt.', 'error')
    }
  }

  function commit() {
    if (mode === 'json') {
      if (!preview?.quotes.length) {
        notify(preview?.error || 'No quotes found in that JSON.', 'error')
        return
      }
      onSave(preview.quotes)
      notify(`Saved ${preview.quotes.length} quotes.`)
    } else {
      const cleaned = rows
        .map((row) => ({ text: row.text.trim(), source: row.source.trim() || 'Unknown' }))
        .filter((row) => row.text)
      onSave(cleaned)
      notify(cleaned.length ? `Saved ${cleaned.length} quotes.` : 'Back to the built-in quotes.')
    }
    onClose()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Your quotes"
      description="One is shown each day, picked from your collection."
      footer={
        <>
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={commit}>
            Save
          </Button>
        </>
      }
    >
      <div className="mb-4 inline-flex rounded-lg border border-line bg-surface p-0.5">
        {(['manual', 'json'] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setMode(option)}
            aria-pressed={mode === option}
            className={cx(
              'rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors',
              mode === option ? 'bg-brand-soft text-brand-strong' : 'text-ink-2 hover:text-ink',
            )}
          >
            {option === 'manual' ? 'Type them' : 'Paste JSON'}
          </button>
        ))}
      </div>

      {mode === 'manual' ? (
        <div className="flex flex-col gap-2">
          {rows.map((row, index) => (
            <div key={index} className="flex items-start gap-2">
              <Input
                aria-label={`Quote ${index + 1}`}
                placeholder="The quote"
                value={row.text}
                wrapperClassName="flex-1"
                onChange={(event) =>
                  setRows((prev) =>
                    prev.map((r, i) => (i === index ? { ...r, text: event.target.value } : r)),
                  )
                }
              />
              <Input
                aria-label={`Source ${index + 1}`}
                placeholder="Who said it"
                value={row.source}
                wrapperClassName="w-40"
                onChange={(event) =>
                  setRows((prev) =>
                    prev.map((r, i) => (i === index ? { ...r, source: event.target.value } : r)),
                  )
                }
              />
              <button
                type="button"
                onClick={() => setRows((prev) => prev.filter((_, i) => i !== index))}
                aria-label="Remove this quote"
                className="mt-2 shrink-0 rounded p-1 text-ink-3 transition-colors hover:text-critical"
              >
                <Icon name="trash" size={14} />
              </button>
            </div>
          ))}
          <Button
            type="button"
            size="sm"
            className="self-start"
            onClick={() => setRows((prev) => [...prev, { text: '', source: '' }])}
            icon={<Icon name="plus" size={14} />}
          >
            Add another
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="rounded-lg border border-line bg-surface-2 p-3">
            <div className="flex items-start justify-between gap-2">
              <p className="text-[12.5px] font-medium text-ink">
                Don&rsquo;t have a list? Ask an assistant.
              </p>
              <Button type="button" size="sm" onClick={() => void copyPrompt()}>
                <Icon name={copied ? 'check' : 'copy'} size={13} />
                {copied ? 'Copied' : 'Copy prompt'}
              </Button>
            </div>
            <pre className="scrollbar-thin mt-2 max-h-28 overflow-auto whitespace-pre-wrap text-[11px] leading-relaxed text-ink-3">
              {AI_PROMPT}
            </pre>
          </div>

          <Textarea
            label="Paste the JSON here"
            rows={7}
            placeholder='[{ "text": "…", "source": "…" }]'
            value={raw}
            onChange={(event) => setRaw(event.target.value)}
            error={preview?.error}
          />
          {preview && !preview.error ? (
            <p className="text-[12px] text-ink-2">
              Found <strong className="text-ink">{preview.quotes.length}</strong> quote
              {preview.quotes.length === 1 ? '' : 's'}.
            </p>
          ) : null}
        </div>
      )}
    </Modal>
  )
}
