import { useMemo, useRef, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { formatApiError } from '../api/client'
import { consoleApi, type ConsoleAccount, type ConsoleSection, type MigrationPreview } from '../api/console'
import { useAuth } from '../auth/context'
import { useResource } from '../hooks/useResource'
import { Icon } from '../components/ui/Icon'
import { downloadFile } from '../lib/download'
import { formatStamp } from './format'
import type { ConsoleOutlet } from './ConsoleLayout'

function ToggleBox({ on }: { on: boolean }) {
  return (
    <span className={`bios-toggle-box ${on ? '' : 'off'}`}>
      {on ? <Icon name="check" size={14} strokeWidth={2.6} /> : null}
    </span>
  )
}

/**
 * F3 — move data between installations.
 *
 * Export: tick the sections and accounts to carry, choose whether uploaded
 * files ride along, download one zip. Import: upload a zip, read the
 * preview, type REPLACE. Only the tables in the archive are touched, so a
 * partial export restores partially.
 */
export function MigrationScreen() {
  const { logout } = useAuth()
  const { reloadOverview } = useOutletContext<ConsoleOutlet>()
  const accounts = useResource(() => consoleApi.accounts(), [])
  const [allUsers, setAllUsers] = useState(true)
  const [userIds, setUserIds] = useState<Set<number>>(new Set())
  const [enabled, setEnabled] = useState<Set<string> | null>(null)
  const [media, setMedia] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')

  const userFilter = allUsers ? null : Array.from(userIds)
  const sections = useResource(
    () => consoleApi.sections(userFilter),
    [allUsers, Array.from(userIds).sort().join(',')],
  )
  const sectionRows = useMemo(() => sections.data?.sections ?? [], [sections.data])

  // Until the operator touches a toggle, everything is on.
  const chosen = useMemo(
    () => enabled ?? new Set(sectionRows.map((s) => s.key)),
    [enabled, sectionRows],
  )
  const everything = sectionRows.length > 0 && sectionRows.every((s) => chosen.has(s.key))
  const totalRows = sectionRows.filter((s) => chosen.has(s.key)).reduce((sum, s) => sum + s.rows, 0)
  const totalFiles = media
    ? sectionRows.filter((s) => chosen.has(s.key)).reduce((sum, s) => sum + s.files, 0)
    : 0

  function toggleSection(key: string) {
    const next = new Set(chosen)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setEnabled(next)
  }

  function toggleUser(id: number) {
    const next = new Set(userIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setUserIds(next)
  }

  async function runExport() {
    setExporting(true)
    setError('')
    try {
      const url = consoleApi.exportUrl({
        sections: everything ? null : Array.from(chosen),
        users: userFilter,
        media,
      })
      await downloadFile(url, 'career-tracker-migration.zip')
    } catch (err) {
      setError(formatApiError(err))
    } finally {
      setExporting(false)
    }
  }

  const scopeNote = allUsers
    ? 'every account'
    : userIds.size === 0
      ? 'no accounts selected'
      : `${userIds.size} selected account${userIds.size === 1 ? '' : 's'}`

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div className="bios-grid" style={{ gridTemplateColumns: 'minmax(0, 3fr) minmax(280px, 2fr)' }}>
        <section className="bios-panel">
          <h2 className="bios-panel-title">
            Export · sections
            <span style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="bios-btn ghost small" onClick={() => setEnabled(new Set(sectionRows.map((s) => s.key)))}>
                All on
              </button>
              <button type="button" className="bios-btn ghost small" onClick={() => setEnabled(new Set())}>
                All off
              </button>
            </span>
          </h2>
          <div className="bios-panel-body tight">
            {sections.error ? <p className="bios-note danger">{sections.error}</p> : null}
            {sectionRows.map((section) => (
              <SectionToggle
                key={section.key}
                section={section}
                on={chosen.has(section.key)}
                onToggle={() => toggleSection(section.key)}
              />
            ))}
            <button type="button" className="bios-toggle" onClick={() => setMedia(!media)}>
              <ToggleBox on={media} />
              <span className="bios-toggle-main">
                <b>Uploaded files</b>
                <span>Resumes, documents, photos, logos, icons and attachments referenced by the rows above.</span>
              </span>
              <span className="bios-toggle-count">
                {sectionRows.filter((s) => chosen.has(s.key)).reduce((sum, s) => sum + s.files, 0)} files
              </span>
            </button>
          </div>
        </section>

        <div style={{ display: 'grid', gap: 14, alignContent: 'start' }}>
          <section className="bios-panel">
            <h2 className="bios-panel-title">Export · accounts</h2>
            <div className="bios-panel-body tight" style={{ maxHeight: 320, overflow: 'auto' }}>
              <button type="button" className="bios-toggle" onClick={() => setAllUsers(!allUsers)}>
                <ToggleBox on={allUsers} />
                <span className="bios-toggle-main">
                  <b>Every account</b>
                  <span>Shared catalogs and companies are always carried whole.</span>
                </span>
              </button>
              {(accounts.data ?? []).map((account) => (
                <AccountToggle
                  key={account.id}
                  account={account}
                  on={allUsers || userIds.has(account.id)}
                  disabled={allUsers}
                  onToggle={() => toggleUser(account.id)}
                />
              ))}
            </div>
          </section>

          <section className="bios-panel">
            <h2 className="bios-panel-title">Export · summary</h2>
            <div className="bios-panel-body" style={{ display: 'grid', gap: 10 }}>
              <dl className="bios-kv">
                <dt>Sections</dt>
                <dd>
                  {chosen.size}/{sectionRows.length} {everything ? '(everything)' : ''}
                </dd>
                <dt>Accounts</dt>
                <dd>{scopeNote}</dd>
                <dt>Rows</dt>
                <dd>{sections.loading ? '…' : totalRows}</dd>
                <dt>Files</dt>
                <dd>{media ? totalFiles : 'not included'}</dd>
              </dl>
              {error ? <p className="bios-note danger">{error}</p> : null}
              <button
                type="button"
                className="bios-btn primary"
                disabled={exporting || chosen.size === 0 || (!allUsers && userIds.size === 0)}
                onClick={() => void runExport()}
              >
                <Icon name="download" size={13} strokeWidth={2.2} />
                {exporting ? 'Building archive…' : 'Download migration .zip'}
              </button>
              <p style={{ color: 'var(--bios-text-dim)', fontSize: 11.5, margin: 0 }}>
                Restore on the other machine here (Import below) or with{' '}
                <code>python manage.py restore_full_backup &lt;file&gt;</code>.
              </p>
            </div>
          </section>
        </div>
      </div>

      <ImportPanel
        onDone={(result) => {
          reloadOverview()
          sections.reload()
          accounts.reload()
          if (result.signed_out) {
            window.alert('Accounts were replaced by the archive. Sign in again with the restored credentials.')
            void logout()
          }
        }}
      />
    </div>
  )
}

function SectionToggle({ section, on, onToggle }: { section: ConsoleSection; on: boolean; onToggle: () => void }) {
  return (
    <button type="button" className="bios-toggle" onClick={onToggle} title={section.tables.map((t) => `${t.name}: ${t.rows}`).join('\n')}>
      <ToggleBox on={on} />
      <span className="bios-toggle-main">
        <b>{section.label}</b>
        <span>{section.description}</span>
      </span>
      <span className="bios-toggle-count">
        {section.rows} rows
        <br />
        {section.files} files
      </span>
    </button>
  )
}

function AccountToggle({ account, on, disabled, onToggle }: { account: ConsoleAccount; on: boolean; disabled: boolean; onToggle: () => void }) {
  return (
    <button type="button" className="bios-toggle" disabled={disabled} onClick={onToggle}>
      <ToggleBox on={on} />
      <span className="bios-toggle-main">
        <b>
          {account.username}
          {account.is_superuser ? ' · superuser' : account.is_developer ? ' · dev' : ''}
        </b>
        <span>
          {account.counts.applications} apps · {account.counts.people} people · {account.counts.tickets} tickets
        </span>
      </span>
    </button>
  )
}

function ImportPanel({ onDone }: { onDone: (result: MigrationPreview) => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<MigrationPreview | null>(null)
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<MigrationPreview | null>(null)

  async function pick(next: File | null) {
    setFile(next)
    setPreview(null)
    setResult(null)
    setConfirm('')
    setError('')
    if (!next) return
    setBusy(true)
    try {
      setPreview(await consoleApi.importArchive(next, { dryRun: true }))
    } catch (err) {
      setError(formatApiError(err))
    } finally {
      setBusy(false)
    }
  }

  async function apply() {
    if (!file) return
    setBusy(true)
    setError('')
    try {
      const done = await consoleApi.importArchive(file, { dryRun: false, confirm })
      setResult(done)
      setPreview(null)
      setConfirm('')
      onDone(done)
    } catch (err) {
      setError(formatApiError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="bios-panel">
      <h2 className="bios-panel-title">Import · restore from a migration .zip</h2>
      <div className="bios-panel-body" style={{ display: 'grid', gap: 12 }}>
        <p className="bios-note">
          Replaces the tables carried by the archive with its rows — the rest of the database is left
          alone. Uploaded files in the archive overwrite same-named files. Rolled back as a whole if
          the fixture fails to load.
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            ref={fileRef}
            type="file"
            accept=".zip,application/zip"
            hidden
            onChange={(e) => void pick(e.target.files?.[0] ?? null)}
          />
          <button type="button" className="bios-btn" disabled={busy} onClick={() => fileRef.current?.click()}>
            <Icon name="paperclip" size={13} strokeWidth={2.2} />
            Choose archive
          </button>
          <span style={{ color: 'var(--bios-text-dim)' }}>
            {file ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB` : 'No file chosen'}
          </span>
          {busy ? <span className="bios-blink">working…</span> : null}
        </div>
        {error ? <p className="bios-note danger">{error}</p> : null}

        {preview ? (
          <div className="bios-grid" style={{ gridTemplateColumns: 'minmax(0, 3fr) minmax(260px, 2fr)' }}>
            <div className="bios-panel">
              <h3 className="bios-panel-title">Archive contents</h3>
              <div className="bios-panel-body tight" style={{ maxHeight: 280, overflow: 'auto' }}>
                <table className="bios-table">
                  <thead>
                    <tr>
                      <th>Table</th>
                      <th className="bios-num">Rows</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.models.map((model) => (
                      <tr key={model}>
                        <td>{model}</td>
                        <td className="bios-num">{preview.counts[model] ?? 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="bios-panel">
              <h3 className="bios-panel-title">Confirm</h3>
              <div className="bios-panel-body" style={{ display: 'grid', gap: 10 }}>
                <dl className="bios-kv">
                  <dt>Made</dt>
                  <dd>{formatStamp(preview.created_at)}</dd>
                  <dt>Sections</dt>
                  <dd>{preview.sections.join(', ')}</dd>
                  <dt>Accounts</dt>
                  <dd>{preview.users === 'all' ? 'all' : `ids ${preview.users.join(', ')}`}</dd>
                  <dt>Objects</dt>
                  <dd>{preview.object_count}</dd>
                  <dt>Files</dt>
                  <dd>{preview.file_count}</dd>
                </dl>
                {preview.models.includes('auth.user') ? (
                  <p className="bios-note danger">
                    This archive carries accounts. Your own login will be replaced by the archive’s —
                    you will be signed out afterwards.
                  </p>
                ) : null}
                <label>
                  <span className="bios-label">Type REPLACE to confirm</span>
                  <input className="bios-input" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
                </label>
                <button type="button" className="bios-btn danger" disabled={busy || confirm !== 'REPLACE'} onClick={() => void apply()}>
                  Replace {preview.models.length} table{preview.models.length === 1 ? '' : 's'}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {result ? (
          <p className="bios-note ok">
            Restored {result.object_count} objects across {result.models.length} tables
            {result.files_copied != null ? ` and copied ${result.files_copied} files` : ''}.
          </p>
        ) : null}
      </div>
    </section>
  )
}
