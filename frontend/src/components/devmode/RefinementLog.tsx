import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useLocation } from 'react-router-dom'
import { formatApiError } from '../../api/client'
import { refinements } from '../../api/resources'
import type { RefinementNote } from '../../api/types'
import { cx, formatDateTime } from '../../lib/format'
import { Icon } from '../ui/Icon'
import { Spinner } from '../ui/Button'
import { useToast } from '../ui/toast-context'

const KINDS = [
  { value: 'improvement', label: 'Improvement', icon: 'sparkles' },
  { value: 'bug', label: 'Bug', icon: 'alert' },
  { value: 'complaint', label: 'Complaint', icon: 'coffee' },
] as const

type Kind = (typeof KINDS)[number]['value']

/**
 * Developer mode's refinement log — a docked panel for jotting down "this
 * annoyed me" the moment it happens, without leaving the page it happened on.
 *
 * Shaped like a chat rather than a form because the point is to lower the cost
 * of writing one down: type, hit enter, keep working. Each note records the
 * route it was written on, so a note like "this is confusing" is still
 * actionable a fortnight later.
 */
export function RefinementLog({ onClose }: { onClose: () => void }) {
  const { notify } = useToast()
  const location = useLocation()
  const [notes, setNotes] = useState<RefinementNote[] | null>(null)
  const [body, setBody] = useState('')
  const [kind, setKind] = useState<Kind>('improvement')
  const [sending, setSending] = useState(false)
  const [showDone, setShowDone] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    refinements
      .list()
      .then(setNotes)
      .catch((err) => notify(formatApiError(err), 'error'))
  }, [notify])

  // Newest note sits at the bottom, so the log reads like a conversation.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [notes])

  const visible = (notes ?? []).filter((note) => showDone || note.status === 'open')
  const openCount = (notes ?? []).filter((note) => note.status === 'open').length

  async function send(event: FormEvent) {
    event.preventDefault()
    if (!body.trim() || sending) return
    setSending(true)
    try {
      const saved = await refinements.create({
        body: body.trim(),
        kind,
        page: location.pathname + location.search,
      })
      setNotes((current) => [...(current ?? []), saved])
      setBody('')
    } catch (err) {
      notify(formatApiError(err), 'error')
    } finally {
      setSending(false)
    }
  }

  async function toggle(note: RefinementNote) {
    const next = note.status === 'done' ? 'open' : 'done'
    try {
      const saved = await refinements.update(note.id, { status: next })
      setNotes((current) => (current ?? []).map((row) => (row.id === note.id ? saved : row)))
    } catch (err) {
      notify(formatApiError(err), 'error')
    }
  }

  async function remove(note: RefinementNote) {
    try {
      await refinements.remove(note.id)
      setNotes((current) => (current ?? []).filter((row) => row.id !== note.id))
    } catch (err) {
      notify(formatApiError(err), 'error')
    }
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 flex h-[26rem] w-[21rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-card border border-line bg-surface shadow-xl">
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="grid size-6 place-items-center rounded-md bg-brand-soft text-brand-strong">
          <Icon name="checklist" size={13} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-ink">Refinement log</p>
          <p className="truncate text-[11px] text-ink-3">
            {openCount} open {openCount === 1 ? 'item' : 'items'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowDone((value) => !value)}
          aria-pressed={showDone}
          title={showDone ? 'Hide resolved' : 'Show resolved'}
          className={cx(
            'rounded-lg p-1.5 transition-colors hover:bg-surface-2',
            showDone ? 'text-brand' : 'text-ink-3',
          )}
        >
          <Icon name="check" size={14} />
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close refinement log"
          className="rounded-lg p-1.5 text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <Icon name="close" size={14} />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-3 py-2.5">
        {notes === null ? (
          <div className="grid h-full place-items-center">
            <Spinner className="size-4" />
          </div>
        ) : visible.length === 0 ? (
          <p className="py-8 text-center text-[12.5px] text-ink-3">
            Nothing logged yet. Jot down anything that felt off and come back to it later.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {visible.map((note) => (
              <li
                key={note.id}
                className={cx(
                  'group/note rounded-lg border border-line bg-surface-2 px-2.5 py-2',
                  note.status === 'done' && 'opacity-60',
                )}
              >
                <div className="flex items-start gap-2">
                  <button
                    type="button"
                    onClick={() => void toggle(note)}
                    aria-label={note.status === 'done' ? 'Reopen' : 'Mark as done'}
                    className={cx(
                      'mt-0.5 grid size-4 shrink-0 place-items-center rounded border transition-colors',
                      note.status === 'done'
                        ? 'border-good bg-good text-white'
                        : 'border-line-strong text-transparent hover:border-brand',
                    )}
                  >
                    <Icon name="check" size={10} />
                  </button>
                  <p
                    className={cx(
                      'min-w-0 flex-1 whitespace-pre-wrap break-words text-[12.5px] text-ink',
                      note.status === 'done' && 'line-through',
                    )}
                  >
                    {note.body}
                  </p>
                  <button
                    type="button"
                    onClick={() => void remove(note)}
                    aria-label="Delete note"
                    className="shrink-0 rounded p-1 text-ink-3 opacity-0 transition-opacity hover:text-critical focus:opacity-100 group-hover/note:opacity-100"
                  >
                    <Icon name="trash" size={12} />
                  </button>
                </div>
                <p className="mt-1 flex items-center gap-1.5 pl-6 text-[10.5px] text-ink-3">
                  <span className="rounded-full bg-surface px-1.5 py-0.5 font-medium">
                    {note.kind_display}
                  </span>
                  {note.page ? <span className="truncate">{note.page}</span> : null}
                  <span className="ml-auto shrink-0">{formatDateTime(note.created_at)}</span>
                </p>
              </li>
            ))}
          </ul>
        )}
        <div ref={endRef} />
      </div>

      <form onSubmit={send} className="border-t border-line p-2.5">
        <div className="mb-1.5 flex gap-1">
          {KINDS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setKind(option.value)}
              aria-pressed={kind === option.value}
              className={cx(
                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors',
                kind === option.value
                  ? 'bg-brand-soft text-brand-strong'
                  : 'text-ink-3 hover:text-ink',
              )}
            >
              <Icon name={option.icon} size={11} />
              {option.label}
            </button>
          ))}
        </div>
        <div className="flex items-end gap-2">
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            onKeyDown={(event) => {
              // Enter sends, shift+enter breaks the line — the log is for
              // one-liners, and reaching for a button each time adds friction.
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void send(event)
              }
            }}
            rows={2}
            placeholder="What should be better?"
            aria-label="Refinement note"
            className="flex-1 resize-none rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-[12.5px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-brand"
          />
          <button
            type="submit"
            disabled={!body.trim() || sending}
            aria-label="Log it"
            className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand text-white transition-opacity disabled:opacity-40"
          >
            {sending ? <Spinner className="size-3.5" /> : <Icon name="arrowRight" size={14} />}
          </button>
        </div>
      </form>
    </div>
  )
}
