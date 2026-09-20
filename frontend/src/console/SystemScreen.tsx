import { useEffect } from 'react'
import { useOutletContext } from 'react-router-dom'
import { consoleApi } from '../api/console'
import { useResource } from '../hooks/useResource'
import { Icon } from '../components/ui/Icon'
import { formatBytes, formatStamp, formatUptime } from './format'
import type { ConsoleOutlet } from './ConsoleLayout'

/** F1 — what this installation is: versions, storage, settings, totals. */
export function SystemScreen() {
  const { overview } = useOutletContext<ConsoleOutlet>()
  const activity = useResource(() => consoleApi.activity(30), [])

  // Tickets/events land here the moment they're raised elsewhere in the app —
  // an operator watching this tail shouldn't have to hit Refresh to see one.
  const reloadActivity = activity.reload
  useEffect(() => {
    const timer = window.setInterval(() => reloadActivity(), 10_000)
    return () => window.clearInterval(timer)
  }, [reloadActivity])

  if (!overview) {
    return (
      <p>
        Reading system<span className="bios-blink">_</span>
      </p>
    )
  }

  const totals = overview.totals
  const stats: [string, number][] = [
    ['Accounts', totals.accounts],
    ['Active', totals.active_accounts],
    ['Developers', totals.developers],
    ['Superusers', totals.superusers],
    ['Companies', totals.companies],
    ['Applications', totals.applications],
    ['Contacts', totals.people],
    ['Todos', totals.todos],
    ['Events', totals.events],
    ['Tickets', totals.tickets],
    ['Open tickets', totals.open_tickets],
    ['Reset requests', totals.password_resets],
  ]

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div
        style={{
          display: 'grid',
          gap: 10,
          gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
        }}
      >
        {stats.map(([label, value]) => (
          <div key={label} className="bios-stat">
            <b>{value}</b>
            <span>{label}</span>
          </div>
        ))}
      </div>

      <div className="bios-grid">
        <section className="bios-panel">
          <h2 className="bios-panel-title">
            <span className="bios-panel-title-label">
              <Icon name="clock" size={13} strokeWidth={2.2} />
              Runtime
            </span>
          </h2>
          <div className="bios-panel-body">
            <dl className="bios-kv">
              <dt>Revision</dt>
              <dd>{overview.revision ?? '—'}</dd>
              <dt>Host</dt>
              <dd>{overview.hostname}</dd>
              <dt>Platform</dt>
              <dd>{overview.platform}</dd>
              <dt>Python</dt>
              <dd>{overview.python}</dd>
              <dt>Django</dt>
              <dd>{overview.django}</dd>
              <dt>Process</dt>
              <dd>PID {overview.pid} · up {formatUptime(overview.uptime_seconds)}</dd>
              <dt>Server time</dt>
              <dd>{formatStamp(overview.server_time)}</dd>
            </dl>
          </div>
        </section>

        <section className="bios-panel">
          <h2 className="bios-panel-title">
            <span className="bios-panel-title-label">
              <Icon name="library" size={13} strokeWidth={2.2} />
              Storage
            </span>
          </h2>
          <div className="bios-panel-body">
            <dl className="bios-kv">
              <dt>Database</dt>
              <dd>
                {overview.database.engine}
                {overview.database.host ? ` @ ${overview.database.host}` : ''}
              </dd>
              <dt>Name</dt>
              <dd>{overview.database.name}</dd>
              <dt>DB size</dt>
              <dd>{formatBytes(overview.database.bytes)}</dd>
              <dt>Media path</dt>
              <dd>{overview.media.path}</dd>
              <dt>Media</dt>
              <dd>
                {overview.media.files} files · {formatBytes(overview.media.bytes)}
              </dd>
            </dl>
          </div>
        </section>

        <section className="bios-panel">
          <h2 className="bios-panel-title">
            <span className="bios-panel-title-label">
              <Icon name="settings" size={13} strokeWidth={2.2} />
              Settings
            </span>
          </h2>
          <div className="bios-panel-body">
            <dl className="bios-kv">
              {Object.entries(overview.settings).map(([key, value]) => (
                <SettingRow key={key} name={key} value={value} />
              ))}
            </dl>
          </div>
        </section>

        <section className="bios-panel">
          <h2 className="bios-panel-title">
            <span className="bios-panel-title-label">
              <Icon name="table" size={13} strokeWidth={2.2} />
              Tables by section
            </span>
          </h2>
          <div className="bios-panel-body tight">
            <table className="bios-table">
              <thead>
                <tr>
                  <th>Section</th>
                  <th className="bios-num">Rows</th>
                  <th className="bios-num">Files</th>
                </tr>
              </thead>
              <tbody>
                {overview.sections.map((section) => (
                  <tr key={section.key}>
                    <td>
                      {section.label}
                      <div style={{ color: 'var(--bios-text-dim)', fontSize: 11 }}>
                        {section.tables.map((t) => `${t.name} ${t.rows}`).join(' · ')}
                      </div>
                    </td>
                    <td className="bios-num">{section.rows}</td>
                    <td className="bios-num">{section.files}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="bios-panel">
        <h2 className="bios-panel-title">
          <span className="bios-panel-title-label">
            <Icon name="inbox" size={13} strokeWidth={2.2} />
            Activity tail
          </span>
          <button type="button" className="bios-btn ghost small" onClick={activity.reload}>
            <Icon name="refresh" size={12} strokeWidth={2.2} />
            Refresh
          </button>
        </h2>
        <pre className="bios-log">
          {activity.data?.length === 0
            ? 'No refinement activity yet.'
            : (activity.data ?? []).map((row) => (
                <div key={`${row.type}-${row.ticket}-${row.created_at}`}>
                  <span className="t">{formatStamp(row.created_at)}</span>{' '}
                  <span className="u">#{row.ticket}</span> {row.user} ·{' '}
                  {row.type === 'event'
                    ? `${row.event_type}${row.detail ? ` — ${row.detail}` : ''}${row.actor ? ` (${row.actor})` : ''}`
                    : `${row.author ?? '?'}: ${row.body || '[image]'}`}
                </div>
              ))}
        </pre>
      </section>
    </div>
  )
}

function SettingRow({ name, value }: { name: string; value: string | boolean | string[] }) {
  const text = Array.isArray(value)
    ? value.length
      ? value.join(', ')
      : '(none)'
    : typeof value === 'boolean'
      ? value
        ? 'ON'
        : 'OFF'
      : value
  return (
    <>
      <dt>{name}</dt>
      <dd>
        {typeof value === 'boolean' ? (
          <span className={`bios-badge ${value ? 'warn' : 'ok'}`}>{text}</span>
        ) : (
          text
        )}
      </dd>
    </>
  )
}
