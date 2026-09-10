import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/context'
import { OnboardingTour } from '../OnboardingTour'
import { ReminderScheduler } from '../ReminderScheduler'
import { NotificationsPanel } from './NotificationsPanel'
import { QuickAccessMenu } from './QuickAccessMenu'
import { cx, displayName } from '../../lib/format'
import { Avatar } from '../ui/Avatar'
import { ClockWeather } from '../ui/ClockWeather'
import { Icon } from '../ui/Icon'
import { ThemeToggle } from '../ui/ThemeToggle'
import { Wallpaper } from './Wallpaper'

const NAV = [
  { to: '/', label: 'Dashboard', icon: 'dashboard', end: true },
  { to: '/applications', label: 'Applications', icon: 'briefcase' },
  { to: '/network', label: 'Network', icon: 'users' },
  { to: '/catchups', label: 'Catch-ups', icon: 'coffee' },
  { to: '/todos', label: 'Todos', icon: 'checklist' },
  { to: '/calendar', label: 'Calendar', icon: 'calendar' },
  { to: '/resumes', label: 'Resumes', icon: 'file' },
  { to: '/job-directory', label: 'Job Directory', icon: 'library' },
]

/**
 * Two targets, not one: the mark is the user's profile picture and opens their
 * profile, while the wordmark goes home. Splitting them keeps each link's
 * destination guessable from what you clicked.
 */
function Brand({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex items-center gap-2.5">
      <Link
        to="/profile"
        onClick={onNavigate}
        aria-label="Your profile"
        title="Your profile"
        className="group/climb shrink-0 rounded-lg transition-opacity hover:opacity-90"
      >
        {/* <span className="relative grid size-8 place-items-center overflow-hidden rounded-lg bg-brand text-white shadow-sm">
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <line x1="8" y1="1" x2="8" y2="23" />
            <line x1="16" y1="1" x2="16" y2="23" />
            <line x1="8" y1="4.5" x2="16" y2="4.5" />
            <line x1="8" y1="9" x2="16" y2="9" />
            <line x1="8" y1="13.5" x2="16" y2="13.5" />
            <line x1="8" y1="18" x2="16" y2="18" />
            <line x1="8" y1="22.5" x2="16" y2="22.5" />
          </svg>
          <svg
            viewBox="0 0 24 24"
            className="brand-climber absolute size-5"
            fill="currentColor"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <circle cx="12" cy="4.5" r="2.4" />
            <line x1="12" y1="7.5" x2="12" y2="15" />
            <line x1="12" y1="9.5" x2="8" y2="7.5" />
            <line x1="12" y1="9.5" x2="16" y2="11.5" />
            <line x1="12" y1="15" x2="8.5" y2="20" />
            <line x1="12" y1="15" x2="15.5" y2="20" />
          </svg>
        </span> */}
      <span className="relative grid size-10 place-items-center overflow-hidden rounded-lg bg-brand shadow-sm">
        <img
          src="/fuji_1.svg"
          alt=""
          className="size-9 object-contain"   /* almost as big as the box */
        />
      </span>
      </Link>

      <Link
        to="/"
        onClick={onNavigate}
        title="Dashboard"
        className="text-lg font-extrabold uppercase tracking-wide text-ink transition-colors hover:text-brand"
      >
        Career Tracker
      </Link>
    </div>
  )
}

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-0.5">
      {NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cx(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              isActive
                ? 'bg-brand-soft text-brand-strong'
                : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
            )
          }
        >
          <Icon name={item.icon} />
          {item.label}
        </NavLink>
      ))}
    </nav>
  )
}

function UserCard({ onNavigate }: { onNavigate?: () => void }) {
  const { user, logout } = useAuth()
  const name = displayName(user) || '—'

  return (
    <div className="border-t border-line pt-3">
      <div className="flex items-center gap-1">
        <NavLink
          to="/profile"
          onClick={onNavigate}
          className={({ isActive }) =>
            cx(
              'flex min-w-0 flex-1 items-center gap-2.5 rounded-lg p-2 transition-colors',
              isActive ? 'bg-brand-soft' : 'hover:bg-surface-2',
            )
          }
        >
          <Avatar name={name} src={user?.avatar} size="sm" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium text-ink">{name}</span>
            <span className="block truncate text-[11px] text-ink-3">{user?.email || '—'}</span>
          </span>
        </NavLink>
        <NotificationsPanel onNavigate={onNavigate} />
        <NavLink
          to="/settings"
          onClick={onNavigate}
          aria-label="Settings"
          title="Settings"
          className={({ isActive }) =>
            cx(
              'shrink-0 rounded-lg p-2 transition-colors',
              isActive ? 'bg-brand-soft text-brand-strong' : 'text-ink-3 hover:bg-surface-2 hover:text-ink',
            )
          }
        >
          <Icon name="settings" size={17} />
        </NavLink>
      </div>

      <button
        type="button"
        onClick={() => void logout()}
        className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-critical"
      >
        <Icon name="logout" />
        Log out
      </button>
    </div>
  )
}

export function AppLayout() {
  const { user } = useAuth()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  // Clock/weather is a dashboard-only flourish — every other page just gets
  // the plain theme toggle, so the header stays quiet on pages people work in.
  const isDashboard = location.pathname === '/'

  // FR-AUTH-07 — runs once per account until dismissed. Computed during
  // render (matching the drawer-close pattern below) rather than in an
  // effect: `checkedFor` only ever advances to the current user's id, so
  // this evaluates once per login rather than re-opening on every render.
  //
  // Lives here rather than on the page that opens it — a "Replay tutorial"
  // button on the Settings page would otherwise navigate the tour to "/" and
  // in doing so unmount Settings, killing the tour instance it just opened.
  // AppLayout wraps every page's <Outlet />, so it's never the thing that
  // unmounts. Settings signals a replay via a `?tour=1` query param instead
  // of owning the tour itself.
  const [tourOpen, setTourOpen] = useState(false)
  const [tourMode, setTourMode] = useState<'auto' | 'manual'>('auto')
  const [checkedFor, setCheckedFor] = useState<number | null>(null)
  if (user && checkedFor !== user.id) {
    setCheckedFor(user.id)
    if (!user.onboarding_completed) {
      setTourOpen(true)
      setTourMode('auto')
    }
  }

  const [lastSearch, setLastSearch] = useState(location.search)
  if (location.search !== lastSearch) {
    setLastSearch(location.search)
    if (new URLSearchParams(location.search).get('tour') === '1') {
      setTourOpen(true)
      setTourMode('manual')
    }
  }

  // Strips the `?tour=1` once consumed above — an effect, since navigate()
  // is an imperative side effect like any other router/DOM API.
  useEffect(() => {
    if (new URLSearchParams(location.search).get('tour') === '1') {
      navigate(location.pathname, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search])

  // Close the mobile drawer whenever the route changes — including on browser
  // back/forward, which no nav-item click handler would catch. Adjusting state
  // during render (rather than in an effect) avoids a flash of the open drawer.
  const [lastPath, setLastPath] = useState(location.pathname)
  if (lastPath !== location.pathname) {
    setLastPath(location.pathname)
    setDrawerOpen(false)
  }

  useEffect(() => {
    if (!drawerOpen) return
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = overflow
    }
  }, [drawerOpen])

  return (
    <>
      <Wallpaper />
      <div className="app-frame min-h-dvh lg:flex">
      {/* Desktop sidebar. `fixed inset-y-0` rather than `sticky` + `h-dvh` —
          a sticky element sized from a viewport unit can end up a hair
          shorter than the real viewport in some browsers (rounding in the
          dvh calculation), leaving a sliver of the wallpaper visible below
          it. `fixed` with both `top` and `bottom` set spans the exact visual
          viewport by definition, no unit math involved. */}
      {/* z-40 so popovers anchored inside it (the notifications panel) sit
          above <main>, which is a later sibling and would otherwise paint
          over them at the default stacking order. Still under the mobile
          drawer's z-50. */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 shrink-0 flex-col border-r border-line bg-surface px-3 py-4 intern:backdrop-blur-xl lg:flex">
        <div className="px-2 pb-5">
          <Brand />
        </div>
        <div className="flex-1 overflow-y-auto">
          <NavItems />
        </div>
        <UserCard />
      </aside>
      {/* Reserves the sidebar's width in the flex flow, since `fixed` takes
          the real aside out of it. */}
      <div className="hidden w-64 shrink-0 lg:block" aria-hidden="true" />

      {/* Mobile drawer */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-slate-950/45 backdrop-blur-[2px]"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
          <aside
            className="relative flex h-full w-72 max-w-[85vw] flex-col border-r border-line bg-surface px-3 py-4 intern:backdrop-blur-xl"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
          >
            <div className="flex items-center justify-between px-2 pb-5">
              <Brand onNavigate={() => setDrawerOpen(false)} />
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close navigation"
                className="rounded-lg p-1.5 text-ink-3 hover:bg-surface-2 hover:text-ink"
              >
                <Icon name="close" />
              </button>
            </div>
            <div className="flex flex-1 flex-col justify-center overflow-y-auto">
              <NavItems onNavigate={() => setDrawerOpen(false)} />
            </div>
            <UserCard onNavigate={() => setDrawerOpen(false)} />
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-line bg-surface/85 px-3 py-2.5 backdrop-blur intern:bg-surface lg:hidden">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation"
            className="rounded-lg p-2 text-ink-2 hover:bg-surface-2 hover:text-ink"
          >
            <Icon name="menu" />
          </button>
          <Brand />
          <div className="flex items-center gap-2">
            {isDashboard ? <ClockWeather compact /> : null}
            <ThemeToggle />
          </div>
        </header>

        {/* Theme toggle, pinned to the viewport's top-right corner. `fixed`
            rather than `sticky` — a sticky element here proved to drift
            during scroll in real browsers (the same quirk the sidebar hit;
            see its `fixed` fix above). The dashboard is the one exception:
            it builds its own sticky header (greeting + clock/weather + this
            same toggle in one row) instead of this floating overlay — see
            DashboardPage. */}
        {!isDashboard ? (
          <div className="pointer-events-none fixed top-4 right-6 z-20 hidden lg:block">
            <div className="pointer-events-auto">
              <ThemeToggle />
            </div>
          </div>
        ) : null}

        <main
          className={cx(
            'mx-auto w-full max-w-7xl flex-1 px-3 py-4 sm:px-5 sm:py-6 lg:px-8',
            // Clears the fixed top-right toggle on every page except the
            // dashboard, which handles its own header spacing.
            !isDashboard && 'lg:pt-16',
          )}
        >
          <Outlet />
        </main>
      </div>
      </div>

      <QuickAccessMenu hidden={tourOpen} />
      <OnboardingTour open={tourOpen} onClose={() => setTourOpen(false)} mode={tourMode} />
      <ReminderScheduler />
    </>
  )
}
