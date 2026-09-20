import { useEffect, useState } from 'react'
import { useAuth } from '../auth/context'
import {
  LOCATION_EVENT,
  enableLocation,
  skipLocationPromptThisSession,
  shouldPromptForLocation,
} from '../lib/location'
import { Button } from './ui/Button'
import { Modal } from './ui/Modal'

/**
 * Once per account until the *browser* permission is answered. Allow runs
 * `getCurrentPosition` in the same click so the OS prompt actually appears.
 * Not now only skips this visit.
 */
export function LocationPrompt() {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [working, setWorking] = useState(false)

  useEffect(() => {
    if (!user) {
      setOpen(false)
      return
    }
    let cancelled = false
    const userId = user.id

    async function sync() {
      const should = await shouldPromptForLocation(userId)
      if (!cancelled) setOpen(should)
    }

    void sync()
    const onChange = () => {
      void sync()
    }
    window.addEventListener(LOCATION_EVENT, onChange)
    return () => {
      cancelled = true
      window.removeEventListener(LOCATION_EVENT, onChange)
    }
  }, [user])

  if (!user) return null
  const userId = user.id
  // Browsers only hand out coordinates on a secure origin. Over plain HTTP on
  // the LAN (http://192.168.x.x) the OS prompt never appears and the request
  // just fails — say so, rather than looking like a broken "Allow" button.
  const insecure = typeof window !== 'undefined' && !window.isSecureContext

  function decline() {
    skipLocationPromptThisSession(userId)
    setOpen(false)
  }

  function allow() {
    // Start the geolocation request in this click, before any re-render, so
    // the browser still treats it as a user gesture and shows the OS prompt.
    const pending = enableLocation(userId)
    setWorking(true)
    void pending.finally(() => {
      setWorking(false)
      setOpen(false)
    })
  }

  return (
    <Modal
      open={open}
      onClose={decline}
      title="Location"
      description="For local weather and sunrise/sunset in the header clock."
      footer={
        <>
          <Button variant="ghost" onClick={decline} disabled={working}>
            Not now
          </Button>
          {insecure ? null : (
            <Button variant="primary" onClick={allow} loading={working}>
              Allow
            </Button>
          )}
        </>
      }
    >
      {insecure ? (
        <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-[13px] text-ink">
          <p className="font-medium">Location needs HTTPS.</p>
          <p className="mt-1 text-ink-2">
            Browsers only share your location on a secure address, and this page is open over
            plain HTTP. On the host machine start the app with{' '}
            <code className="rounded bg-surface-2 px-1 py-0.5 text-[12px]">./run.sh lan --https</code>{' '}
            and open the https:// address it prints.
          </p>
        </div>
      ) : (
        <p className="text-[13.5px] text-ink-2">
          Career Tracker will ask this browser for your location, then use it for the header
          clock's sunrise/sunset and local weather. You can change this later in Settings.
        </p>
      )}
    </Modal>
  )
}
