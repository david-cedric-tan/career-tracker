import { useEffect, useState, type FormEvent } from 'react'
import { useOutletContext } from 'react-router-dom'
import { formatApiError } from '../api/client'
import { consoleApi, type ConsoleAccount } from '../api/console'
import { useAuth } from '../auth/context'
import { useResource } from '../hooks/useResource'
import { Icon } from '../components/ui/Icon'
import { formatStamp } from './format'
import type { ConsoleOutlet } from './ConsoleLayout'

const FLAGS: { key: 'is_active' | 'is_developer' | 'is_staff' | 'is_superuser'; label: string; hint: string }[] = [
  { key: 'is_active', label: 'Active', hint: 'Off = can’t sign in; data kept.' },
  { key: 'is_developer', label: 'Developer', hint: 'Reads and replies to every account’s tickets.' },
  { key: 'is_staff', label: 'Staff', hint: 'Django admin site access.' },
  { key: 'is_superuser', label: 'Superuser', hint: 'This console. Never sees the tracker UI.' },
]

/** F2 — every account: flags, counts, password reset, create, delete. */
export function AccountsScreen() {
  const { user: me } = useAuth()
  const { reloadOverview } = useOutletContext<ConsoleOutlet>()
  const accounts = useResource(() => consoleApi.accounts(), [])
  // The "forgot my password" queue — polled, since someone asking while
  // the operator is looking at this screen is exactly the moment to see it.
  const resets = useResource(() => consoleApi.passwordResets(), [])
  const reloadResets = resets.reload
  const reloadAccounts = accounts.reload
  useEffect(() => {
    const timer = window.setInterval(() => {
      reloadResets()
      reloadAccounts()
    }, 10_000)
    return () => window.clearInterval(timer)
  }, [reloadResets, reloadAccounts])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [creating, setCreating] = useState(false)

  const rows = accounts.data ?? []
  const selected = rows.find((row) => row.id === selectedId) ?? null

  async function patch(account: ConsoleAccount, body: Parameters<typeof consoleApi.updateAccount>[1]) {
    setBusy(true)
    setError('')
    try {
      const updated = await consoleApi.updateAccount(account.id, body)
      accounts.setData(rows.map((row) => (row.id === updated.id ? updated : row)))
      reloadOverview()
      resets.reload()
    } catch (err) {
      setError(formatApiError(err))
    } finally {
      setBusy(false)
    }
  }

  async function resetPassword(account: ConsoleAccount) {
    const password = window.prompt(`New password for ${account.username} (8+ characters):`)
    if (!password) return
    await patch(account, { password })
    if (!error) window.alert(`Password for ${account.username} updated. Their old sign-in token was revoked.`)
  }

  async function remove(account: ConsoleAccount) {
    const confirm = window.prompt(
      `This deletes ${account.username} and everything they own. Type the username to confirm:`,
    )
    if (confirm == null) return
    setBusy(true)
    setError('')
    try {
      await consoleApi.deleteAccount(account.id, confirm)
      accounts.setData(rows.filter((row) => row.id !== account.id))
      setSelectedId(null)
      reloadOverview()
    } catch (err) {
      setError(formatApiError(err))
    } finally {
      setBusy(false)
    }
  }

  const queue = resets.data ?? []

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {queue.length ? (
        <section className="bios-panel">
          <h2 className="bios-panel-title">
            <span className="bios-panel-title-label">
              <Icon name="alert" size={13} strokeWidth={2.2} />
              Password resets requested ({queue.length})
            </span>
          </h2>
          <div className="bios-panel-body tight">
            <table className="bios-table">
              <thead>
                <tr>
                  <th>Username</th>
                  <th>Email</th>
                  <th>Note</th>
                  <th>Asked</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {queue.map((row) => {
                  const account = rows.find((entry) => entry.id === row.user_id)
                  return (
                    <tr key={row.id}>
                      <td>{row.username}</td>
                      <td style={{ color: 'var(--bios-text-dim)' }}>{row.email || '—'}</td>
                      <td style={{ color: 'var(--bios-text-dim)' }}>{row.message || '—'}</td>
                      <td style={{ whiteSpace: 'nowrap', color: 'var(--bios-text-dim)' }}>{formatStamp(row.created_at)}</td>
                      <td className="bios-num">
                        <button
                          type="button"
                          className="bios-btn small"
                          disabled={busy || !account}
                          onClick={() => {
                            if (!account) return
                            setSelectedId(account.id)
                            void resetPassword(account)
                          }}
                        >
                          <Icon name="edit" size={12} strokeWidth={2.2} />
                          Set new password
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <p className="bios-note" style={{ margin: 12 }}>
              Setting a password clears the request. Pass the new password on to them yourself —
              nothing is emailed.
            </p>
          </div>
        </section>
      ) : null}

    <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'minmax(0, 2fr) minmax(280px, 1fr)' }}>
      <section className="bios-panel" style={{ minWidth: 0 }}>
        <h2 className="bios-panel-title">
          Accounts ({rows.length})
          <span style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="bios-btn ghost small" onClick={accounts.reload}>
              <Icon name="refresh" size={12} strokeWidth={2.2} />
              Refresh
            </button>
            <button type="button" className="bios-btn small" onClick={() => setCreating(true)}>
              <Icon name="plus" size={12} strokeWidth={2.4} />
              New account
            </button>
          </span>
        </h2>
        <div className="bios-panel-body tight" style={{ overflowX: 'auto' }}>
          {accounts.error ? <p className="bios-note danger">{accounts.error}</p> : null}
          <table className="bios-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Username</th>
                <th>Name / email</th>
                <th>Flags</th>
                <th className="bios-num">Apps</th>
                <th className="bios-num">People</th>
                <th className="bios-num">Todos</th>
                <th className="bios-num">Tickets</th>
                <th>Last login</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  aria-selected={row.id === selectedId}
                  onClick={() => setSelectedId(row.id)}
                  style={{ cursor: 'pointer' }}
                >
                  <td className="bios-num">{row.id}</td>
                  <td>
                    {row.username}
                    {row.id === me?.id ? <span className="bios-badge accent" style={{ marginLeft: 6 }}>you</span> : null}
                  </td>
                  <td style={{ color: 'var(--bios-text-dim)' }}>
                    {[row.first_name, row.last_name].filter(Boolean).join(' ') || '—'}
                    <div>{row.email || '—'}</div>
                  </td>
                  <td>
                    <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {row.password_reset_requested_at ? (
                        <span className="bios-badge warn" title={`Asked ${formatStamp(row.password_reset_requested_at)}`}>
                          reset asked
                        </span>
                      ) : null}
                      {!row.is_active ? <span className="bios-badge danger">inactive</span> : null}
                      {row.is_superuser ? <span className="bios-badge warn">superuser</span> : null}
                      {row.is_developer ? <span className="bios-badge accent">dev</span> : null}
                      {row.is_staff && !row.is_superuser ? <span className="bios-badge dim">staff</span> : null}
                      {row.is_active && !row.is_superuser && !row.is_developer && !row.is_staff ? (
                        <span className="bios-badge ok">user</span>
                      ) : null}
                    </span>
                  </td>
                  <td className="bios-num">{row.counts.applications}</td>
                  <td className="bios-num">{row.counts.people}</td>
                  <td className="bios-num">{row.counts.todos}</td>
                  <td className="bios-num">{row.counts.tickets}</td>
                  <td style={{ color: 'var(--bios-text-dim)', whiteSpace: 'nowrap' }}>{formatStamp(row.last_login)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bios-panel">
        <h2 className="bios-panel-title">{selected ? `Account · ${selected.username}` : 'Account'}</h2>
        <div className="bios-panel-body" style={{ display: 'grid', gap: 12 }}>
          {error ? <p className="bios-note danger">{error}</p> : null}
          {!selected ? (
            <p style={{ color: 'var(--bios-text-dim)' }}>Select a row to inspect and edit it.</p>
          ) : (
            <>
              <dl className="bios-kv">
                <dt>Joined</dt>
                <dd>{formatStamp(selected.date_joined)}</dd>
                <dt>Last login</dt>
                <dd>{formatStamp(selected.last_login)}</dd>
                <dt>Onboarded</dt>
                <dd>{selected.onboarding_completed ? 'yes' : 'no'}</dd>
                {Object.entries(selected.counts).map(([key, value]) => (
                  <RowKv key={key} name={key} value={value} />
                ))}
              </dl>

              <div style={{ border: '1px solid var(--bios-line-soft)' }}>
                {FLAGS.map((flag) => {
                  const on = selected[flag.key]
                  const lockedSelf = selected.id === me?.id && on && flag.key !== 'is_developer'
                  return (
                    <button
                      key={flag.key}
                      type="button"
                      className="bios-toggle"
                      disabled={busy || lockedSelf}
                      title={lockedSelf ? 'You can’t remove this from your own account.' : undefined}
                      onClick={() => void patch(selected, { [flag.key]: !on })}
                    >
                      <span className={`bios-toggle-box ${on ? '' : 'off'}`}>
                        {on ? <Icon name="check" size={14} strokeWidth={2.6} /> : null}
                      </span>
                      <span className="bios-toggle-main">
                        <b>{flag.label}</b>
                        <span>{flag.hint}</span>
                      </span>
                    </button>
                  )
                })}
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className="bios-btn small" disabled={busy} onClick={() => void resetPassword(selected)}>
                  <Icon name="edit" size={12} strokeWidth={2.2} />
                  Reset password
                </button>
                <button
                  type="button"
                  className="bios-btn danger small"
                  disabled={busy || selected.id === me?.id}
                  onClick={() => void remove(selected)}
                >
                  <Icon name="trash" size={12} strokeWidth={2.2} />
                  Delete account
                </button>
              </div>
            </>
          )}
        </div>
      </section>

      {creating ? (
        <CreateAccountModal
          onClose={() => setCreating(false)}
          onCreated={(account) => {
            accounts.setData([...rows, account])
            setSelectedId(account.id)
            setCreating(false)
            reloadOverview()
          }}
        />
      ) : null}
    </div>
    </div>
  )
}

function RowKv({ name, value }: { name: string; value: number }) {
  return (
    <>
      <dt style={{ textTransform: 'capitalize' }}>{name}</dt>
      <dd>{value}</dd>
    </>
  )
}

function CreateAccountModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (account: ConsoleAccount) => void
}) {
  const [form, setForm] = useState({
    username: '',
    password: '',
    email: '',
    first_name: '',
    last_name: '',
    is_developer: false,
    is_superuser: false,
  })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      onCreated(await consoleApi.createAccount(form))
    } catch (err) {
      setError(formatApiError(err))
      setBusy(false)
    }
  }

  return (
    <div className="bios-modal-backdrop" onClick={onClose}>
      <form className="bios-modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2 className="bios-panel-title">New account</h2>
        <div className="bios-panel-body" style={{ display: 'grid', gap: 10 }}>
          {error ? <p className="bios-note danger">{error}</p> : null}
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: '1fr 1fr' }}>
            <label>
              <span className="bios-label">Username</span>
              <input className="bios-input" required autoFocus value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
            </label>
            <label>
              <span className="bios-label">Password (8+)</span>
              <input className="bios-input" type="password" required minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </label>
            <label>
              <span className="bios-label">First name</span>
              <input className="bios-input" value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
            </label>
            <label>
              <span className="bios-label">Last name</span>
              <input className="bios-input" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
            </label>
            <label style={{ gridColumn: '1 / -1' }}>
              <span className="bios-label">Email</span>
              <input className="bios-input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </label>
          </div>
          <div style={{ border: '1px solid var(--bios-line-soft)' }}>
            <button type="button" className="bios-toggle" onClick={() => setForm({ ...form, is_developer: !form.is_developer })}>
              <span className={`bios-toggle-box ${form.is_developer ? '' : 'off'}`}>
                {form.is_developer ? <Icon name="check" size={14} strokeWidth={2.6} /> : null}
              </span>
              <span className="bios-toggle-main">
                <b>Developer</b>
                <span>Sees and answers every account’s refinement tickets.</span>
              </span>
            </button>
            <button type="button" className="bios-toggle" onClick={() => setForm({ ...form, is_superuser: !form.is_superuser })}>
              <span className={`bios-toggle-box ${form.is_superuser ? '' : 'off'}`}>
                {form.is_superuser ? <Icon name="check" size={14} strokeWidth={2.6} /> : null}
              </span>
              <span className="bios-toggle-main">
                <b>Superuser (console operator)</b>
                <span>Lands in this console instead of the tracker.</span>
              </span>
            </button>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="bios-btn ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="bios-btn primary" disabled={busy}>
              Create
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
