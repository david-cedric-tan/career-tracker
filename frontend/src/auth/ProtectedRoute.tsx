import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Spinner } from '../components/ui/Button'
import { useAuth } from './context'

function Booting() {
  return (
    <div className="flex min-h-dvh items-center justify-center gap-2 text-sm text-ink-3">
      <Spinner />
      Loading your workspace…
    </div>
  )
}

/**
 * The tracker itself. A superuser is an operator, not a tracker user — they
 * are sent to the console instead, and never see these screens.
 */
export function ProtectedRoute() {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) return <Booting />
  // Remember where they were headed so login can send them back there.
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (user.is_superuser) return <Navigate to="/console" replace />
  return <Outlet />
}

/** The admin console: superusers only; everyone else goes back to the app. */
export function ConsoleRoute() {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) return <Booting />
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (!user.is_superuser) return <Navigate to="/" replace />
  return <Outlet />
}

export function GuestRoute() {
  const { user, loading } = useAuth()
  if (loading) return <Booting />
  if (user) return <Navigate to={user.is_superuser ? '/console' : '/'} replace />
  return <Outlet />
}
