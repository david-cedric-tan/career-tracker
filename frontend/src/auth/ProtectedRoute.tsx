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

export function ProtectedRoute() {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) return <Booting />
  // Remember where they were headed so login can send them back there.
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <Outlet />
}

export function GuestRoute() {
  const { user, loading } = useAuth()
  if (loading) return <Booting />
  if (user) return <Navigate to="/" replace />
  return <Outlet />
}
