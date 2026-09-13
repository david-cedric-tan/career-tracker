import { useEffect, useRef, useState } from 'react'
import { formatApiError } from '../../api/client'
import { refinements } from '../../api/resources'
import type { RefinementEventLog, RefinementNote, TicketMessage } from '../../api/types'
import { cx, formatDateTime, relativeTime } from '../../lib/format'
import { RichText } from '../../lib/richText'
import { Avatar } from '../ui/Avatar'
import { Icon } from '../ui/Icon'
import { Spinner } from '../ui/Button'
import { useToast } from '../ui/toast-context'
import { TicketComposer } from './TicketComposer'

/** Matches the server's own image limit, so an oversized file is refused here
    rather than after a slow upload. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

/** How long the server holds a watch request for a newer message. */
const WATCH_SECS = 20

type FeedItem =
  | { kind: 'event'; key: string; at: string; event: RefinementEventLog }
  | { kind: 'message'; key: string; at: string; message: TicketMessage }

function isAbort(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

function sameThread(current: TicketMessage[] | null, next: TicketMessage[]) {
  if (!current || current.length !== next.length) return false
  return current.every(
    (row, index) =>
      row.id === next[index].id &&
      row.body === next[index].body &&
      row.image === next[index].image,
  )
}

function eventTitle(event: RefinementEventLog, note: RefinementNote) {
  const who =
    event.actor_name == null
      ? null
      : event.actor_name === note.author && note.is_mine
        ? 'you'
        : event.actor_name

  switch (event.event_type) {
    case 'raised':
      return `Ticket #${note.id} raised`
    case 'fixed':
      return who ? `Marked fixed by ${who}` : 'Marked fixed'
    case 'reopened':
      return who ? `Reopened by ${who}` : 'Reopened'
    case 'closed':
      return who ? `Closed by ${who}` : 'Closed'
    case 'edited': {
      const edit = parseTicketEdit(event.detail)
      const bodyChanged = Boolean(edit?.body)
      const screensChanged = Boolean(edit?.screens)
      let what = 'Ticket updated'
      if (bodyChanged && screensChanged) what = 'Description & screens updated'
      else if (bodyChanged) what = 'Description updated'
      else if (screensChanged) what = 'Screens updated'
      return who ? `${what} by ${who}` : what
    }
    case 'testing':
      return who ? `Moved to Testing by ${who}` : 'Moved to Testing'
    case 'awaiting_validation':
      return who ? `Awaiting validation — set by ${who}` : 'Awaiting validation'
    default:
      return event.event_type_display
  }
}

/**
 * Activity tab: composer on top, then a single timeline of status events and
 * chat messages — newest first, with a Start marker at the bottom.
 */
export function TicketActivity({
  note,
  onRead,
  className,
}: {
  note: RefinementNote
  onRead?: () => void
  className?: string
}) {
  const { notify } = useToast()
  const [messages, setMessages] = useState<TicketMessage[] | null>(null)
  const [image, setImage] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const readRef = useRef(onRead)
  readRef.current = onRead
  const lastIdRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    let markedRead = false
    const abort = new AbortController()

    function absorb(rows: TicketMessage[], mode: 'replace' | 'append') {
      setMessages((current) => {
        if (mode === 'replace' || !current) return rows
        const byId = new Map<number, TicketMessage>()
        for (const row of current) byId.set(row.id, row)
        for (const row of rows) byId.set(row.id, row)
        const next = [...byId.values()].sort((a, b) => a.id - b.id)
        return sameThread(current, next) ? current : next
      })
      if (rows.length) {
        lastIdRef.current = Math.max(lastIdRef.current, ...rows.map((row) => row.id))
      }
      if (!markedRead) {
        markedRead = true
        readRef.current?.()
      }
    }

    async function watch() {
      try {
        const initial = await refinements.messages(note.id, { signal: abort.signal })
        if (cancelled) return
        lastIdRef.current = initial.reduce((max, row) => Math.max(max, row.id), 0)
        absorb(initial, 'replace')
      } catch (error) {
        if (cancelled || isAbort(error)) return
      }

      while (!cancelled) {
        try {
          const newer = await refinements.messages(note.id, {
            after: lastIdRef.current,
            wait: WATCH_SECS,
            signal: abort.signal,
          })
          if (cancelled) return
          if (newer.length) absorb(newer, 'append')
        } catch (error) {
          if (cancelled || isAbort(error)) return
          await new Promise((resolve) => window.setTimeout(resolve, 750))
        }
      }
    }

    void watch()
    return () => {
      cancelled = true
      abort.abort()
    }
  }, [note.id])

  useEffect(() => {
    if (!image) {
      setPreview(null)
      return
    }
    const url = URL.createObjectURL(image)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [image])

  function pick(file: File | undefined) {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      notify('Attach a picture — a screenshot, a photo of the screen.', 'error')
      return
    }
    if (file.size > MAX_IMAGE_BYTES) {
      notify(`That picture is ${Math.round(file.size / 1024 / 1024)}MB. The limit is 5MB.`, 'error')
      return
    }
    setImage(file)
  }

  async function send(body: string) {
    if (sending || (!body.trim() && !image)) return
    setSending(true)
    try {
      const saved = await refinements.sendMessage(note.id, { body: body.trim(), image })
      lastIdRef.current = Math.max(lastIdRef.current, saved.id)
      setMessages((current) => [...(current ?? []), saved])
      setImage(null)
      if (fileRef.current) fileRef.current.value = ''
    } catch (err) {
      notify(formatApiError(err), 'error')
      throw err
    } finally {
      setSending(false)
    }
  }

  const feed: FeedItem[] = [
    ...(note.event_logs ?? []).map((event) => ({
      kind: 'event' as const,
      key: `event-${event.id}`,
      at: event.created_at,
      event,
    })),
    ...(messages ?? []).map((message) => ({
      kind: 'message' as const,
      key: `message-${message.id}`,
      at: message.created_at,
      message,
    })),
  ].sort((a, b) => b.at.localeCompare(a.at) || b.key.localeCompare(a.key))

  return (
    <div className={cx('flex min-h-0 flex-col', className)}>
      <div className="shrink-0 pb-2">
        {preview ? (
          <div className="mb-2 flex items-center gap-2 rounded-lg border border-line/80 bg-surface-2/50 px-2 py-1.5">
            <img src={preview} alt="" className="size-9 rounded object-cover" />
            <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-2">{image?.name}</span>
            <button
              type="button"
              onClick={() => {
                setImage(null)
                if (fileRef.current) fileRef.current.value = ''
              }}
              aria-label="Remove attachment"
              className="rounded p-1 text-ink-3 transition-colors hover:text-critical"
            >
              <Icon name="close" size={12} />
            </button>
          </div>
        ) : null}

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(event) => pick(event.target.files?.[0])}
        />

        <TicketComposer
          sending={sending}
          hasAttachment={Boolean(image)}
          onSend={send}
          fileSlot={
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              aria-label="Attach a picture"
              title="Attach a picture"
              className="grid size-8 shrink-0 place-items-center rounded-lg text-ink-3 transition-colors hover:bg-surface/60 hover:text-ink"
            >
              <Icon name="paperclip" size={15} />
            </button>
          }
          sendSlot={({ disabled }) => (
            <button
              type="submit"
              disabled={disabled}
              className="rounded-lg bg-brand px-2.5 py-1.5 text-[12px] font-medium text-white transition-opacity disabled:opacity-40"
            >
              {sending ? 'Sending…' : 'Send'}
            </button>
          )}
        />
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-line/60 pt-3">
        {messages === null ? (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        ) : feed.length === 0 ? (
          <p className="py-4 text-center text-[12.5px] text-ink-3">Nothing on the timeline yet.</p>
        ) : (
          <ol className="flex flex-col gap-3 pb-2">
            {feed.map((item) =>
              item.kind === 'message' ? (
                <MessageCard key={item.key} message={item.message} />
              ) : (
                <EventCard key={item.key} note={note} event={item.event} />
              ),
            )}
            <li className="flex items-center gap-2 pt-1">
              <span className="size-2.5 rounded-full bg-brand" />
              <p className="text-[11.5px] font-medium uppercase tracking-wide text-ink-3">Start</p>
            </li>
          </ol>
        )}
      </div>
    </div>
  )
}

function MessageCard({ message }: { message: TicketMessage }) {
  return (
    <li className={cx('flex gap-2.5', message.is_mine && 'flex-row-reverse')}>
      <Avatar
        name={message.author}
        src={message.author_avatar}
        size="xs"
        className="mt-0.5 shrink-0"
      />
      <div className={cx('min-w-0 max-w-[85%]', message.is_mine && 'text-right')}>
        <div className="mb-1 flex items-baseline gap-2">
          <p className="text-[12px] font-semibold text-ink">
            {message.is_mine ? 'You' : message.author}
          </p>
          <p className="text-[10.5px] text-ink-3" title={formatDateTime(message.created_at)}>
            {relativeTime(message.created_at)}
          </p>
        </div>
        <div
          className={cx(
            'rounded-2xl border px-3 py-2 text-left text-[12.5px]',
            message.is_mine
              ? 'border-brand/30 bg-brand text-white'
              : 'border-line/70 bg-surface-2/80 text-ink',
          )}
        >
          {message.image ? (
            <a href={message.image} target="_blank" rel="noreferrer" className="mb-1.5 block">
              <img
                src={message.image}
                alt="Attachment"
                className="max-h-40 rounded-lg object-contain"
              />
            </a>
          ) : null}
          {message.body ? (
            <RichText
              text={message.body}
              className={cx(
                'break-break-word text-[12.5px] leading-relaxed',
                message.is_mine &&
                  '[&_em]:text-white [&_s]:text-white/90 [&_strong]:text-white [&_u]:text-white',
              )}
            />
          ) : null}
        </div>
      </div>
    </li>
  )
}

function EventCard({ note, event }: { note: RefinementNote; event: RefinementEventLog }) {
  const icon =
    event.event_type === 'fixed' || event.event_type === 'closed'
      ? 'check'
      : event.event_type === 'reopened'
        ? 'arrowRight'
        : event.event_type === 'testing' || event.event_type === 'awaiting_validation'
          ? 'clock'
          : event.event_type === 'raised'
            ? 'plus'
            : 'edit'
  const tone =
    event.event_type === 'fixed'
      ? 'border-good/35 bg-good/10 text-good'
      : event.event_type === 'reopened'
        ? 'border-brand/35 bg-brand-soft/60 text-brand-strong'
        : event.event_type === 'testing' || event.event_type === 'awaiting_validation'
          ? 'border-warning/40 bg-warning/10 text-warning'
          : event.event_type === 'edited'
            ? 'border-good/30 bg-good/5 text-ink-2'
            : 'border-line/60 bg-surface-2/55 text-ink-2'

  const edit = event.event_type === 'edited' ? parseTicketEdit(event.detail) : null

  return (
    <li className="flex justify-center px-1">
      <div
        className={cx(
          'w-full max-w-[92%] rounded-xl border px-3 py-2 backdrop-blur-sm',
          tone,
        )}
      >
        <div className="flex items-start gap-2">
          <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-surface/70">
            <Icon name={icon} size={11} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide opacity-80">
                Status
              </p>
              <p className="shrink-0 text-[10.5px] opacity-70" title={formatDateTime(event.created_at)}>
                {relativeTime(event.created_at)}
              </p>
            </div>
            <p className="mt-0.5 text-[12.5px] font-medium text-ink">
              {eventTitle(event, note)}
            </p>
            {edit?.body ? (
              <p className="mt-1 whitespace-pre-wrap break-words text-[12px] text-ink-2">
                <HighlightedDescription before={edit.body.before} after={edit.body.after} />
              </p>
            ) : null}
            {edit?.screens ? (
              <ScreenTagDiff before={edit.screens.before} after={edit.screens.after} />
            ) : null}
            {!edit && event.detail ? (
              <p className="mt-1 whitespace-pre-wrap break-words text-[12px] text-ink-2">
                {event.detail}
              </p>
            ) : null}
            <p className="mt-1 text-[11px] text-ink-3">
              {event.actor_name ?? (note.is_mine ? 'You' : note.author)}
            </p>
          </div>
        </div>
      </div>
    </li>
  )
}

type TicketEdit = {
  body?: { before: string; after: string }
  screens?: { before: string[]; after: string[] }
}

function parseTicketEdit(detail: string): TicketEdit | null {
  if (!detail.trim()) return null
  try {
    const data = JSON.parse(detail) as {
      before?: unknown
      after?: unknown
      screens_before?: unknown
      screens_after?: unknown
    }
    const edit: TicketEdit = {}
    if (typeof data.after === 'string') {
      edit.body = {
        before: typeof data.before === 'string' ? data.before : '',
        after: data.after,
      }
    }
    if (Array.isArray(data.screens_after)) {
      edit.screens = {
        before: Array.isArray(data.screens_before)
          ? data.screens_before.filter((value): value is string => typeof value === 'string')
          : [],
        after: data.screens_after.filter((value): value is string => typeof value === 'string'),
      }
    }
    return edit.body || edit.screens ? edit : null
  } catch {
    // Older plain-text edit rows — treat the whole detail as the new body.
    return { body: { before: '', after: detail } }
  }
}

/** Keep labels in sync with backend `TICKET_SCREENS` for Activity diffs. */
const SCREEN_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  applications: 'Applications',
  network: 'Network',
  catchups: 'Catch-ups',
  todos: 'Todos',
  calendar: 'Calendar',
  resumes: 'Resumes',
  job_directory: 'Job Directory',
  refinement_log: 'Refinement Log',
  profile: 'Profile',
  settings: 'Settings',
  other: 'Somewhere else',
}

function screenLabel(slug: string) {
  return SCREEN_LABELS[slug] ?? slug
}

function ScreenTagDiff({ before, after }: { before: string[]; after: string[] }) {
  const beforeSet = new Set(before)
  const afterSet = new Set(after)
  const added = after.filter((slug) => !beforeSet.has(slug))
  const removed = before.filter((slug) => !afterSet.has(slug))
  const kept = after.filter((slug) => beforeSet.has(slug))

  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {kept.map((slug) => (
        <span
          key={`kept-${slug}`}
          className="rounded-full border border-line/70 bg-surface/60 px-1.5 py-0.5 text-[10.5px] text-ink-2"
        >
          {screenLabel(slug)}
        </span>
      ))}
      {added.map((slug) => (
        <span
          key={`add-${slug}`}
          className="rounded-full border border-good/35 bg-good/15 px-1.5 py-0.5 text-[10.5px] font-semibold text-good"
        >
          +{screenLabel(slug)}
        </span>
      ))}
      {removed.map((slug) => (
        <span
          key={`rm-${slug}`}
          className="rounded-full border border-line/60 bg-surface/40 px-1.5 py-0.5 text-[10.5px] text-ink-3 line-through"
        >
          {screenLabel(slug)}
        </span>
      ))}
      {after.length === 0 && removed.length > 0 ? (
        <span className="text-[11px] text-ink-3">All screens cleared</span>
      ) : null}
    </div>
  )
}

/** Common-prefix / common-suffix split so added or rewritten middle text
 *  lights up green in the Activity status card. */
function HighlightedDescription({ before, after }: { before: string; after: string }) {
  const mark = (text: string) => (
    <mark className="rounded-sm bg-good/20 px-0.5 font-semibold text-good not-italic">
      {text}
    </mark>
  )

  if (!before) {
    return mark(after)
  }
  if (before === after) {
    return <>{after}</>
  }

  let start = 0
  const minLen = Math.min(before.length, after.length)
  while (start < minLen && before[start] === after[start]) start += 1

  let endBefore = before.length
  let endAfter = after.length
  while (
    endBefore > start &&
    endAfter > start &&
    before[endBefore - 1] === after[endAfter - 1]
  ) {
    endBefore -= 1
    endAfter -= 1
  }

  const prefix = after.slice(0, start)
  const added = after.slice(start, endAfter)
  const suffix = after.slice(endAfter)

  return (
    <>
      {prefix}
      {added ? mark(added) : null}
      {suffix}
    </>
  )
}
