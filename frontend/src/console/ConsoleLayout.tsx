import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/context'
import { consoleApi, type ConsoleOverview } from '../api/console'
import { useResource } from '../hooks/useResource'
import { Icon } from '../components/ui/Icon'
import { CONSOLE_TABS } from './tabs'
import { formatBytes, formatUptime } from './format'
import { readConsoleTheme, persistConsoleTheme, type ConsoleTheme } from './theme'
import './console.css'

function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

/**
 * The firmware-setup frame: header strip, F-key tabs, body, key legend.
 * The operator never sees the tracker itself — an admin runs the machine,
 * they don't track a job hunt in it (see ProtectedRoute).
 */
export function ConsoleLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const overview = useResource(() => consoleApi.overview(), [])
  const [clock, setClock] = useState(() => new Date())
  const [theme, setTheme] = useState<ConsoleTheme>(readConsoleTheme)

  useEffect(() => {
    const id = window.setInterval(() => setClock(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])

  // The footer's counts (accounts, applications, open tickets) and the
  // reload every screen shares via context should track what's actually
  // happening in the tracker, not just what it looked like on page load.
  const reloadOverview = overview.reload
  useEffect(() => {
    const id = window.setInterval(() => reloadOverview(), 15_000)
    return () => window.clearInterval(id)
  }, [reloadOverview])

  function toggleTheme() {
    const next: ConsoleTheme = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    persistConsoleTheme(next)
  }

  // F1–F4 switch screens, F10 signs out — the keys a setup screen would use.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (isEditable(event.target)) return
      const tab = CONSOLE_TABS.find((t) => t.key === event.key)
      if (tab) {
        event.preventDefault()
        navigate(tab.path)
        return
      }
      if (event.key === 'F10') {
        event.preventDefault()
        if (window.confirm('Sign out of the console?')) void logout()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate, logout])

  const data = overview.data

  return (
    <div className="bios" data-console-screen={location.pathname} data-theme={theme}>
      <header className="bios-header">
        <div className="bios-brand">
          <span className="bios-brand-mark" aria-hidden>
            <Icon name="dashboard" size={16} strokeWidth={2.2} />
          </span>
          <span>
            Career Tracker <small>· System Console</small>
          </span>
        </div>
        <div className="bios-meta">
          <span>
            HOST <b>{data?.hostname ?? '…'}</b>
          </span>
          <span>
            REV <b>{data?.revision ?? '—'}</b>
          </span>
          <span>
            DB <b>{data ? data.database.engine : '…'}</b>
          </span>
          <span>
            UPTIME <b>{data ? formatUptime(data.uptime_seconds) : '…'}</b>
          </span>
          <span>
            OPERATOR <b>{user?.username}</b>
          </span>
          <span>
            <b>{clock.toLocaleTimeString(undefined, { hour12: false })}</b>
          </span>
          <button
            type="button"
            className="bios-theme-toggle"
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={15} strokeWidth={2} />
          </button>
        </div>
      </header>

      <nav className="bios-tabs" aria-label="Console screens">
        {CONSOLE_TABS.map((tab) => (
          // NavLink stamps aria-current="page" on the active one, which is
          // what the stylesheet lights up.
          <NavLink key={tab.path} to={tab.path} end={tab.end} className="bios-tab">
            <Icon name={tab.icon} size={15} strokeWidth={2} />
            <span>{tab.label}</span>
            <kbd>{tab.key}</kbd>
          </NavLink>
        ))}
      </nav>

      <main className="bios-body">
        <Outlet context={{ overview: data, reloadOverview: overview.reload } satisfies ConsoleOutlet} />
      </main>

      <footer className="bios-footer">
        <span>
          <kbd>F1–F4</kbd>Screen <kbd>Tab</kbd>Next item <kbd>Enter</kbd>Select <kbd>F10</kbd>Sign out
        </span>
        <span>
          {data ? (
            <>
              {data.totals.accounts} accounts · {data.totals.applications} applications ·{' '}
              {data.totals.open_tickets} open tickets ·{' '}
              {data.totals.password_resets ? `${data.totals.password_resets} reset requests · ` : ''}media{' '}
              {formatBytes(data.media.bytes)}
            </>
          ) : overview.error ? (
            <span style={{ color: 'var(--bios-danger)' }}>{overview.error}</span>
          ) : (
            'Reading system…'
          )}
        </span>
        <button type="button" className="bios-btn ghost small" onClick={() => void logout()}>
          <Icon name="logout" size={13} strokeWidth={2.2} />
          Sign out
        </button>
      </footer>
    </div>
  )
}

export type ConsoleOutlet = {
  overview: ConsoleOverview | null
  reloadOverview: () => void
}
