import { useRef, useState, type ChangeEvent } from 'react'
import { formatApiError } from '../api/client'
import { backup, type BackupCounts, type BackupFormat } from '../api/resources'
import { useAuth } from '../auth/context'
import { cx } from '../lib/format'
import { downloadFile } from '../lib/download'
import { Button, Spinner } from './ui/Button'
import { Card, CardHeader } from './ui/Card'
import { InfoHint } from './ui/InfoHint'
import { Icon } from './ui/Icon'
import { Modal } from './ui/Modal'
import { useResource } from '../hooks/useResource'
import { useToast } from './ui/toast-context'

const SHEET_LABELS: Record<string, string> = {
  stages: 'Pipeline stages',
  companies: 'Companies',
  company_notes: 'Company notes',
  roles: 'Roles',
  locations: 'Locations',
  resumes: 'Resumes',
  job_listings: 'Job listings',
  applications: 'Applications',
  application_events: 'History entries',
  people: 'Contacts',
  person_companies: 'Contact roles',
  contact_methods: 'Contact channels',
  catchups: 'Catch-ups',
  todos: 'Todos',
  calendar_events: 'Calendar events',
  library_documents: 'Application documents',
  experiences: 'Experience',
  education: 'Education',
  certifications: 'Certifications',
  extracurriculars: 'Extra-curriculars',
  profile_links: 'Profile links',
  profile_addresses: 'Addresses',
  refinement_notes: 'Refinement tickets',
  refinement_messages: 'Refinement messages',
  refinement_events: 'Refinement history',
}

function CountGrid({ counts }: { counts: BackupCounts }) {
  const rows = Object.entries(counts).filter(([, value]) => value > 0)
  if (rows.length === 0) {
    return <p className="text-[13px] text-ink-3">Nothing to back up yet.</p>
  }
  return (
    <ul className="grid grid-cols-2 gap-x-4 gap-y-1">
      {rows.map(([key, value]) => (
        <li key={key} className="flex items-baseline justify-between gap-2 text-[12.5px]">
          <span className="truncate text-ink-2">{SHEET_LABELS[key] ?? key}</span>
          <span className="font-semibold tabular-nums text-ink">{value}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * Export and restore (FR-EXPORT-*).
 *
 * Restoring replaces the account, so it always runs a dry run first and shows
 * what the file contains before anything is written.
 */
export function BackupPanel() {
  const { user } = useAuth()
  const { notify } = useToast()
  const inputRef = useRef<HTMLInputElement>(null)
  const summary = useResource(() => backup.summary(), [])

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [adminBusy, setAdminBusy] = useState(false)
  const [pending, setPending] = useState<{
    file: File
    counts: BackupCounts
    from: string
    fileCount: number
  } | null>(null)

  async function download(format: BackupFormat) {
    setBusy(true)
    setError('')
    try {
      await downloadFile(backup.downloadUrl(format), `career-tracker.${format}`)
      notify('Backup downloaded.')
    } catch (err) {
      setError(err instanceof Error ? err.message : formatApiError(err))
    } finally {
      setBusy(false)
    }
  }

  async function downloadFullBackup() {
    setAdminBusy(true)
    setError('')
    try {
      await downloadFile(backup.fullBackupUrl(), 'career-tracker-full-backup.zip')
      notify('Full system backup downloaded.')
    } catch (err) {
      setError(err instanceof Error ? err.message : formatApiError(err))
    } finally {
      setAdminBusy(false)
    }
  }

  async function onPick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setError('')
    setBusy(true)
    try {
      // Dry run first — nothing is written until the user confirms.
      const preview = await backup.restore(file, { dryRun: true })
      setPending({
        file,
        counts: preview.counts,
        from: preview.from_username ?? '',
        fileCount: preview.file_count ?? 0,
      })
    } catch (err) {
      setError(formatApiError(err))
    } finally {
      setBusy(false)
    }
  }

  async function confirmRestore() {
    if (!pending) return
    setBusy(true)
    try {
      const result = await backup.restore(pending.file)
      setPending(null)
      summary.reload()
      notify(
        result.files_attached
          ? `Account restored — ${result.files_attached} file${result.files_attached === 1 ? '' : 's'} reattached.`
          : 'Account restored from backup.',
      )
      // Every page holds its own copy of this data, so a reload is the honest
      // way to show the restored account rather than patching state piecemeal.
      setTimeout(() => window.location.reload(), 600)
    } catch (err) {
      setError(formatApiError(err))
      setPending(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader
        title="Backup & Restore"
        subtitle={
          <span className="flex items-center gap-1.5">
            Export everything, or rebuild this account from a file.
            <InfoHint label="All three import back into this app. The .zip is the complete disaster-recovery copy — data plus every resume, photo and logo it references; the .xlsx/.json are data only, with just each file's name so you know what to re-attach." />
          </span>
        }
      />

      <div className="mt-3">
        {summary.initial ? (
          <Spinner className="text-ink-3" />
        ) : summary.data ? (
          <>
            <CountGrid counts={summary.data.counts} />
            {summary.data.file_count > 0 ? (
              <p className="mt-2 text-[12px] text-ink-3">
                Plus {summary.data.file_count} uploaded file
                {summary.data.file_count === 1 ? '' : 's'} (resumes, documents, photos,
                logos, icons, attachments) — only the "Full Data + Resources" backup
                includes those.
              </p>
            ) : null}
          </>
        ) : null}
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {/* Everyday exports first — these are what you reach for week to week.
            The full archive and the restore that reads it are the rarer, more
            consequential pair, so they sit together underneath. */}
        <Button
          size="sm"
          onClick={() => void download('xlsx')}
          disabled={busy}
          icon={<Icon name="file" size={14} />}
        >
          Data only — Excel (.xlsx)
        </Button>
        <Button
          size="sm"
          onClick={() => void download('json')}
          disabled={busy}
          icon={<Icon name="file" size={14} />}
        >
          Data only (.json)
        </Button>
        <Button
          size="sm"
          variant="primary"
          onClick={() => void download('zip')}
          disabled={busy}
          icon={<Icon name="library" size={14} />}
        >
          Full Data + Resources (.zip)
        </Button>
        <Button
          size="sm"
          variant="success"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          icon={busy ? undefined : <Icon name="logout" size={14} className="rotate-180" />}
          loading={busy}
        >
          Restore…
        </Button>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".json,.xlsx,.zip"
        onChange={onPick}
        className="hidden"
      />

      {error ? (
        <p role="alert" className="mt-2 text-[12px] text-critical">
          {error}
        </p>
      ) : null}

      {user?.is_superuser ? (
        <div className="mt-4 rounded-lg border border-ink/10 bg-ink/[0.03] p-3">
          <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink-2">
            <Icon name="settings" size={14} />
            Admin — move this app to another machine
            <InfoHint label="Every account's data and every table, not just yours — for copying this install to a new PC. Restoring it replaces the whole database, so it's a terminal command (restore_full_backup) on the destination machine, not a button here." />
          </p>
          <Button
            size="sm"
            className="mt-2"
            onClick={() => void downloadFullBackup()}
            disabled={adminBusy}
            loading={adminBusy}
            icon={adminBusy ? undefined : <Icon name="library" size={14} />}
          >
            Download everything (.zip)
          </Button>
          <p className="mt-1.5 text-[11.5px] text-ink-3">
            On the new machine: run migrations, then{' '}
            <code className="rounded bg-ink/10 px-1 py-0.5">
              python manage.py restore_full_backup &lt;file&gt;
            </code>
            .
          </p>
        </div>
      ) : null}

      <Modal
        open={pending !== null}
        onClose={() => setPending(null)}
        title="Restore this backup?"
        description="This replaces everything currently in your account."
        footer={
          <>
            <Button onClick={() => setPending(null)}>Cancel</Button>
            <Button variant="danger" loading={busy} onClick={() => void confirmRestore()}>
              Replace my data
            </Button>
          </>
        }
      >
        {pending ? (
          <div className="flex flex-col gap-4">
            <p
              className={cx(
                'flex items-start gap-2 rounded-lg border border-critical/25',
                'bg-critical/10 px-3 py-2.5 text-[13px] text-ink',
              )}
            >
              <Icon name="alert" size={15} className="mt-0.5 shrink-0 text-critical" />
              <span>
                Your current applications, contacts, catch-ups, todos, resumes and
                experience will be deleted and replaced by the contents of this
                file. This can’t be undone.
              </span>
            </p>

            <div>
              <p className="mb-1.5 truncate text-[12.5px] font-medium text-ink-2">
                {pending.file.name}
                {pending.from ? (
                  <span className="text-ink-3"> · exported by {pending.from}</span>
                ) : null}
              </p>
              <CountGrid counts={pending.counts} />
              {pending.fileCount > 0 ? (
                <p className="mt-2 text-[12px] text-ink-3">
                  Plus {pending.fileCount} file{pending.fileCount === 1 ? '' : 's'} to reattach
                  (resumes, documents, photos, logos, icons, attachments).
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
      </Modal>
    </Card>
  )
}
