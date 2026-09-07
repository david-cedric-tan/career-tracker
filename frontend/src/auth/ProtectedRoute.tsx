import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from './AuthContext'

export function ProtectedRoute() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <main className="page">
        <p className="muted">Loading…</p>
      </main>
    )
  }

  if (!user) return <Navigate to="/login" replace />

  return <Outlet />
}

export function GuestRoute() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <main className="page">
        <p className="muted">Loading…</p>
      </main>
    )
  }

  if (user) return <Navigate to="/" replace />

  return <Outlet />
}
