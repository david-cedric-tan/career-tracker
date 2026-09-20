import { useEffect, useState } from 'react'
import { consoleApi, type ConsoleTicket } from '../api/console'
import { useResource } from '../hooks/useResource'
import { Icon } from '../components/ui/Icon'
import { formatStamp } from './format'

const STATUSES = ['', 'open', 'testing', 'awaiting_validation', 'done']

/** F4 — every account's tickets with their full thread and history. */
export function RefinementsScreen() {
  const [status, setStatus] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const list = useResource(() => consoleApi.refinements(status ? { status } : undefined), [status])
  const detail = useResource(
    () => (selectedId ? consoleApi.refinement(selectedId) : Promise.resolve(null)),
    [selectedId],
  )
  const rows = list.data ?? []

  // A new ticket, or a reply on the open one, should show up on its own —
  // an operator reading the thread shouldn't have to bail out and back in.
  const reloadList = list.reload
  const reloadDetail = detail.reload
  useEffect(() => {
    const timer = window.setInterval(() => {
      reloadList()
      if (selectedId) reloadDetail()
    }, 10_000)
    return () => window.clearInterval(timer)
  }, [reloadList, reloadDetail, selectedId])

  return (
    <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'minmax(0, 3fr) minmax(320px, 2fr)' }}>
      <section className="bios-panel" style={{ minWidth: 0 }}>
        <h2 className="bios-panel-title">
          Tickets ({rows.length})
          <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select className="bios-select" style={{ width: 'auto', padding: '3px 8px' }} value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUSES.map((value) => (
                <option key={value} value={value}>
                  {value ? value.replace('_', ' ') : 'all statuses'}
                </option>
              ))}
            </select>
            <button type="button" className="bios-btn ghost small" onClick={list.reload}>
              <Icon name="refresh" size={12} strokeWidth={2.2} />
              Refresh
            </button>
          </span>
        </h2>
        <div className="bios-panel-body tight" style={{ overflowX: 'auto' }}>
          {list.error ? <p className="bios-note danger">{list.error}</p> : null}
          <table className="bios-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Account</th>
                <th>Kind</th>
                <th>Status</th>
                <th>Summary</th>
                <th className="bios-num">Msgs</th>
                <th>Raised</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} aria-selected={row.id === selectedId} onClick={() => setSelectedId(row.id)} style={{ cursor: 'pointer' }}>
                  <td className="bios-num">{row.id}</td>
                  <td>{row.user}</td>
                  <td>
                    <span className={`bios-badge ${row.kind === 'bug' ? 'danger' : row.kind === 'complaint' ? 'warn' : 'accent'}`}>{row.kind}</span>
                  </td>
                  <td>
                    <StatusBadge status={row.status} />
                  </td>
                  <td style={{ maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.body}</td>
                  <td className="bios-num">{row.message_count}</td>
                  <td style={{ whiteSpace: 'nowrap', color: 'var(--bios-text-dim)' }}>{formatStamp(row.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bios-panel">
        <h2 className="bios-panel-title">{selectedId ? `Ticket #${selectedId}` : 'Ticket'}</h2>
        <div className="bios-panel-body" style={{ display: 'grid', gap: 12 }}>
          {!selectedId ? (
            <p style={{ color: 'var(--bios-text-dim)' }}>Select a ticket to read its thread and history.</p>
          ) : detail.error ? (
            <p className="bios-note danger">{detail.error}</p>
          ) : !detail.data ? (
            <p>
              Loading<span className="bios-blink">_</span>
            </p>
          ) : (
            <TicketDetail ticket={detail.data} />
          )}
        </div>
      </section>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const tone = status === 'done' ? 'ok' : status === 'open' ? 'warn' : 'accent'
  return <span className={`bios-badge ${tone}`}>{status.replace('_', ' ')}</span>
}

function TicketDetail({ ticket }: { ticket: ConsoleTicket }) {
  return (
    <>
      <dl className="bios-kv">
        <dt>Account</dt>
        <dd>{ticket.user}</dd>
        <dt>Kind</dt>
        <dd>{ticket.kind}</dd>
        <dt>Status</dt>
        <dd>
          <StatusBadge status={ticket.status} />
        </dd>
        <dt>Page</dt>
        <dd>{ticket.page || '—'}</dd>
        <dt>Screens</dt>
        <dd>{ticket.screens.join(', ') || '—'}</dd>
        <dt>Raised</dt>
        <dd>{formatStamp(ticket.created_at)}</dd>
        {ticket.resolved_at ? (
          <>
            <dt>Resolved</dt>
            <dd>
              {formatStamp(ticket.resolved_at)} by {ticket.resolved_by ?? '?'}
            </dd>
          </>
        ) : null}
      </dl>
      <div className="bios-panel">
        <h3 className="bios-panel-title">Body</h3>
        <pre className="bios-log" style={{ color: 'var(--bios-text)' }}>
          {ticket.body}
        </pre>
      </div>
      {ticket.resolution ? (
        <div className="bios-panel">
          <h3 className="bios-panel-title">Resolution</h3>
          <pre className="bios-log" style={{ color: 'var(--bios-text)' }}>
            {ticket.resolution}
          </pre>
        </div>
      ) : null}
      <div className="bios-panel">
        <h3 className="bios-panel-title">Thread ({ticket.messages?.length ?? 0})</h3>
        <pre className="bios-log">
          {ticket.messages?.length
            ? ticket.messages.map((m) => (
                <div key={m.id}>
                  <span className="t">{formatStamp(m.created_at)}</span> <span className="u">{m.author ?? '?'}</span>:{' '}
                  {m.body || '[image]'}
                  {m.image ? (
                    <>
                      {' '}
                      <a href={m.image} target="_blank" rel="noreferrer" style={{ color: 'var(--bios-accent)' }}>
                        [image]
                      </a>
                    </>
                  ) : null}
                </div>
              ))
            : 'No messages.'}
        </pre>
      </div>
      <div className="bios-panel">
        <h3 className="bios-panel-title">History ({ticket.events?.length ?? 0})</h3>
        <pre className="bios-log">
          {ticket.events?.length
            ? ticket.events.map((e) => (
                <div key={e.id}>
                  <span className="t">{formatStamp(e.created_at)}</span> <span className="u">{e.event_type}</span>
                  {e.actor ? ` (${e.actor})` : ''}
                  {e.detail ? ` — ${e.detail}` : ''}
                </div>
              ))
            : 'No history.'}
        </pre>
      </div>
    </>
  )
}
