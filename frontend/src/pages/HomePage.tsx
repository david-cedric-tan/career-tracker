import { useAuth } from '../auth/AuthContext'

export function HomePage() {
  const { user, logout } = useAuth()

  return (
    <main className="page home-page">
      <header className="home-header">
        <p className="brand">Apps Tracker</p>
        <button type="button" className="ghost" onClick={() => void logout()}>
          Log out
        </button>
      </header>

      <section className="home-panel">
        <h1>Welcome{user?.first_name ? `, ${user.first_name}` : ''}</h1>
        <p className="muted">You’re signed in. Catalogs and applications come next.</p>

        <dl className="user-meta">
          <div>
            <dt>Username</dt>
            <dd>{user?.username}</dd>
          </div>
          <div>
            <dt>Email</dt>
            <dd>{user?.email || '—'}</dd>
          </div>
          <div>
            <dt>User ID</dt>
            <dd>{user?.id}</dd>
          </div>
        </dl>
      </section>
    </main>
  )
}
