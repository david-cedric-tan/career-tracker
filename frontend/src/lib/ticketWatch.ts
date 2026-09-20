import type { RefinementNote } from '../api/types'

/**
 * What a ticket looked like the last time this browser saw it — enough to
 * tell, on the next poll, whether anything worth an alert happened: a new
 * message, a status move, a fix, a fresh filing.
 */
export type TicketSignature = {
  messages: number
  lastEvent: number
  status: string
}

export type TicketChange = {
  note: RefinementNote
  kind: 'new' | 'message' | 'event'
  title: string
  subtitle: string
  /** Something unique per change, so the same one never alerts twice. */
  key: string
}

function storageKey(userId: number | undefined) {
  return `ticketWatch:${userId ?? 'anon'}`
}

export function readSignatures(userId: number | undefined): Record<number, TicketSignature> | null {
  try {
    const raw = localStorage.getItem(storageKey(userId))
    return raw ? (JSON.parse(raw) as Record<number, TicketSignature>) : null
  } catch {
    return null
  }
}

export function writeSignatures(userId: number | undefined, notes: RefinementNote[]): void {
  const next: Record<number, TicketSignature> = {}
  for (const note of notes) next[note.id] = signatureOf(note)
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(next))
  } catch {
    /* best effort */
  }
}

export function signatureOf(note: RefinementNote): TicketSignature {
  const lastEvent = note.event_logs.length ? Math.max(...note.event_logs.map((log) => log.id)) : 0
  return { messages: note.message_count, lastEvent, status: note.status }
}

function snippet(note: RefinementNote): string {
  return note.body.trim().replace(/\s+/g, ' ').slice(0, 48) || `Ticket #${note.id}`
}

/**
 * Diff the current tickets against what was last seen. Changes *you* made
 * yourself are skipped — your own message shouldn't ring at you.
 */
export function diffTickets(
  notes: RefinementNote[],
  previous: Record<number, TicketSignature>,
  self: { isDeveloper: boolean; names: string[] },
): TicketChange[] {
  const changes: TicketChange[] = []
  const mine = (actor: string | null | undefined) =>
    Boolean(actor && self.names.some((name) => name && name.toLowerCase() === actor.toLowerCase()))

  for (const note of notes) {
    const before = previous[note.id]
    const now = signatureOf(note)

    if (!before) {
      // A ticket this browser has never seen: only the developer is told
      // about other people's filings — your own new ticket isn't news.
      if (self.isDeveloper && !note.is_mine) {
        changes.push({
          note,
          kind: 'new',
          key: `ticket-new-${note.id}`,
          title: `New ticket · ${note.author}`,
          subtitle: `${note.kind_display} · ${snippet(note)}`,
        })
      }
      continue
    }

    if (now.messages > before.messages && note.last_message && !note.last_message.is_mine) {
      changes.push({
        note,
        kind: 'message',
        key: `ticket-msg-${note.id}-${now.messages}`,
        title: `${note.last_message.author} · ${snippet(note)}`,
        subtitle: note.last_message.preview.trim().replace(/\s+/g, ' ').slice(0, 80) || 'New message',
      })
    }

    if (now.lastEvent > before.lastEvent) {
      const fresh = note.event_logs
        .filter((log) => log.id > before.lastEvent && !mine(log.actor_name))
        .sort((a, b) => a.id - b.id)
      for (const log of fresh) {
        if (log.event_type === 'raised') continue
        changes.push({
          note,
          kind: 'event',
          key: `ticket-event-${log.id}`,
          title: `${log.event_type_display} · ${snippet(note)}`,
          subtitle: log.detail?.trim() || `${log.actor_name ?? 'Someone'} updated this ticket`,
        })
      }
    }
  }
  return changes
}
