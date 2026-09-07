import { useState, type ChangeEvent, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { formatApiError, useAuth } from '../auth/AuthContext'

export function RegisterPage() {
  const { register } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({
    username: '',
    email: '',
    first_name: '',
    last_name: '',
    password: '',
    password_confirm: '',
  })
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  function update(field: keyof typeof form) {
    return (e: ChangeEvent<HTMLInputElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }))
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      await register(form)
      navigate('/', { replace: true })
    } catch (err) {
      setError(formatApiError(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="page auth-page">
      <div className="auth-card">
        <p className="brand">Apps Tracker</p>
        <h1>Create account</h1>
        <p className="muted">Register to track applications.</p>

        <form className="auth-form" onSubmit={onSubmit}>
          {error ? <p className="error" role="alert">{error}</p> : null}

          <label>
            Username
            <input
              autoComplete="username"
              value={form.username}
              onChange={update('username')}
              required
            />
          </label>

          <label>
            Email
            <input
              type="email"
              autoComplete="email"
              value={form.email}
              onChange={update('email')}
              required
            />
          </label>

          <div className="row">
            <label>
              First name
              <input
                autoComplete="given-name"
                value={form.first_name}
                onChange={update('first_name')}
              />
            </label>
            <label>
              Last name
              <input
                autoComplete="family-name"
                value={form.last_name}
                onChange={update('last_name')}
              />
            </label>
          </div>

          <label>
            Password
            <input
              type="password"
              autoComplete="new-password"
              value={form.password}
              onChange={update('password')}
              required
            />
          </label>

          <label>
            Confirm password
            <input
              type="password"
              autoComplete="new-password"
              value={form.password_confirm}
              onChange={update('password_confirm')}
              required
            />
          </label>

          <button type="submit" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create account'}
          </button>
        </form>

        <p className="auth-footer">
          Already registered? <Link to="/login">Log in</Link>
        </p>
      </div>
    </main>
  )
}
