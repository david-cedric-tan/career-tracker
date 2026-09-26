import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { formatApiError } from '../api/client'
import { googleTasks, type GoogleTasksStatus } from '../api/resources'
import { relativeTime } from '../lib/format'
import { Button, Spinner } from './ui/Button'
import { Card, CardHeader } from './ui/Card'
import { Input } from './ui/Field'
import { Icon } from './ui/Icon'
import { InfoHint } from './ui/InfoHint'
import { useToast } from './ui/toast-context'

/**
 * Google only sends the browser back to a registered address or to
 * http://localhost — and the app's other addresses (LAN IP, a tunnel whose
 * name changes every run) can't be registered. So on the server's own machine
 * Google returns straight to this page; anywhere else it lands on a localhost
 * page that fails to load, and the user pastes that page's address here.
 */
function sameMachineRedirect(): string | null {
  const { protocol, hostname, origin } = window.location
  if (protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(hostname)) return null
  return `${origin}/settings`
}

/** Module-level, not a ref: StrictMode's double effect must not spend the
    one-time code twice (the second attempt would fail and show an error). */
let consumedCode: string | null = null

export function GoogleTasksCard() {
  const { notify } = useToast()
  const [params, setParams] = useSearchParams()
  const [status, setStatus] = useState<GoogleTasksStatus | null>(null)
  const [busy, setBusy] = useState<'connect' | 'complete' | 'resync' | 'disconnect' | null>(null)
  const [awaitingPaste, setAwaitingPaste] = useState(false)
  const [pasted, setPasted] = useState('')
  const [pasteError, setPasteError] = useState('')

  useEffect(() => {
    googleTasks.status().then(setStatus).catch(() => setStatus(null))
  }, [])

  // Back from Google on the same machine: ?code=…&state=… on this page.
  const returnedCode = params.get('code')
  useEffect(() => {
    if (!returnedCode || !params.get('state') || consumedCode === returnedCode) return
    consumedCode = returnedCode
    const url = window.location.href
    const next = new URLSearchParams(params)
    for (const key of ['code', 'state', 'scope', 'error']) next.delete(key)
    setParams(next, { replace: true })
    void finish(url)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returnedCode])

  async function finish(url: string) {
    setBusy('complete')
    setPasteError('')
    try {
      const next = await googleTasks.complete(url)
      setStatus(next)
      setAwaitingPaste(false)
      setPasted('')
      notify('Google Tasks connected — your todos are syncing now.', 'success')
    } catch (error) {
      setPasteError(formatApiError(error))
    } finally {
      setBusy(null)
    }
  }

  async function connect() {
    setBusy('connect')
    const redirect = sameMachineRedirect()
    try {
      const { auth_url } = await googleTasks.start(redirect ?? undefined)
      if (redirect) {
        window.location.assign(auth_url)
        return
      }
      window.open(auth_url, '_blank', 'noopener')
      setAwaitingPaste(true)
    } catch (error) {
      notify(formatApiError(error), 'error')
    }
    setBusy(null)
  }

  async function resync() {
    setBusy('resync')
    try {
      const next = await googleTasks.resync()
      setStatus(next)
      notify(`Sending ${next.queued} todo${next.queued === 1 ? '' : 's'} to Google Tasks.`, 'success')
    } catch (error) {
      notify(formatApiError(error), 'error')
    } finally {
      setBusy(null)
    }
  }

  async function disconnect() {
    setBusy('disconnect')
    try {
      setStatus(await googleTasks.disconnect())
      notify('Google Tasks disconnected. Tasks already in Google were left there.', 'info')
    } catch (error) {
      notify(formatApiError(error), 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-1.5">
            Google Tasks
            <InfoHint label="Copies your todos into a “Career Tracker” list in Google Tasks, so they show up in Google Calendar and on your phone. One way only: edit todos here, not in Google. Timed todos carry their time as a “Time:” line in the task's notes, since Google Tasks keeps dates only." />
          </span>
        }
        subtitle="Mirror your todos to Google Tasks."
      />

      {status === null ? (
        <div className="mt-4 flex justify-center">
          <Spinner />
        </div>
      ) : !status.configured ? (
        <p className="mt-3 text-[13px] text-ink-3">
          Not set up on this server yet. Add a Google OAuth client to{' '}
          <code>backend/.env</code> — see <code>documentation/google-tasks.md</code>.
        </p>
      ) : status.connected ? (
        <>
          <dl className="mt-3 flex flex-col gap-2 text-[13.5px]">
            <div className="flex justify-between gap-3">
              <dt className="text-ink-3">Todos in Google</dt>
              <dd className="text-ink">{status.synced_count}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-3">Last sync</dt>
              <dd className="text-ink">
                {status.last_synced_at ? relativeTime(status.last_synced_at) : '—'}
              </dd>
            </div>
          </dl>
          {status.last_error ? (
            <p className="mt-3 flex gap-1.5 text-[12.5px] text-critical">
              <Icon name="alert" size={14} className="mt-0.5 shrink-0" />
              <span className="min-w-0 break-words">{status.last_error}</span>
            </p>
          ) : null}
          <div className="mt-4 flex gap-2">
            <Button
              className="flex-1"
              onClick={() => void resync()}
              loading={busy === 'resync'}
              icon={<Icon name="refresh" size={15} />}
            >
              Resync all
            </Button>
            <Button
              variant="ghost"
              className="flex-1"
              onClick={() => void disconnect()}
              loading={busy === 'disconnect'}
            >
              Disconnect
            </Button>
          </div>
        </>
      ) : (
        <>
          <Button
            variant="primary"
            className="mt-4 w-full"
            onClick={() => void connect()}
            loading={busy === 'connect'}
            icon={<Icon name="link" size={15} />}
          >
            Connect Google Tasks
          </Button>
          {awaitingPaste ? (
            <form
              className="mt-4 flex flex-col gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                if (pasted.trim()) void finish(pasted)
              }}
            >
              <p className="text-[12.5px] text-ink-3">
                After you allow access, Google opens a page that won't load
                (it starts with <code>http://localhost</code>). That's expected — copy that
                page's full address and paste it here.
              </p>
              <Input
                value={pasted}
                onChange={(event) => setPasted(event.target.value)}
                placeholder="http://localhost/google-tasks?state=…&code=…"
                error={pasteError}
                aria-label="Address from Google's page"
              />
              <Button type="submit" loading={busy === 'complete'} disabled={!pasted.trim()}>
                Finish connecting
              </Button>
            </form>
          ) : pasteError ? (
            <p className="mt-3 text-[12.5px] text-critical">{pasteError}</p>
          ) : null}
        </>
      )}
    </Card>
  )
}
