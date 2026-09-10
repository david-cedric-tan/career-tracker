import { useRef, useState, type ChangeEvent } from 'react'
import { formatApiError } from '../api/client'
import { backup, type BackupCounts, type BackupFormat } from '../api/resources'
import { cx } from '../lib/format'
import { downloadFile } from '../lib/download'
import { Button, Spinner } from './ui/Button'
import { Card, CardHeader } from './ui/Card'
import { Icon } from './ui/Icon'
import { Modal } from './ui/Modal'
import { useResource } from '../hooks/useResource'
import { useToast } from './ui/toast-context'

const SHEET_LABELS: Record<string, string> = {
  companies: 'Companies',
  roles: 'Roles',
  locations: 'Locations',
  resumes: 'Resumes',
  job_listings: 'Job listings',
  applications: 'Applications',
  application_events: 'History entries',
  people: 'Contacts',
  contact_methods: 'Contact channels',
  catchups: 'Catch-ups',
  todos: 'Todos',
  experiences: 'Experience',
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
  const { notify } = useToast()
  const inputRef = useRef<HTMLInputElement>(null)
  const summary = useResource(() => backup.summary(), [])

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
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
        subtitle="Export everything, or rebuild this account from a file."
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
                {summary.data.file_count === 1 ? '' : 's'} (resumes, photos, logos) —
                only the "Full Data + Resources" backup includes those.
              </p>
            ) : null}
          </>
        ) : null}
      </div>

      {/* Two even rows rather than a ragged wrap: the full export and the
          restore that reads it sit together on top, the two data-only
          formats pair off underneath. */}
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
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
          variant="ghost"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          icon={busy ? undefined : <Icon name="logout" size={14} className="rotate-180" />}
          loading={busy}
        >
          Restore…
        </Button>
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
      </div>

      <p className="mt-2 text-[11.5px] text-ink-3">
        All three import back into this app. The .zip is the complete
        disaster-recovery copy — data plus every resume, photo and logo it
        references; the .xlsx/.json are data only, with just each file's name
        so you know what to re-attach.
      </p>

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
                  (resumes, photos, logos).
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
      </Modal>
    </Card>
  )
}
