import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import * as authApi from '../api/auth'
import { fieldErrors, formatApiError } from '../api/client'
import { useAuth } from '../auth/context'
import { AuthShell } from './AuthShell'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Field'

export function LoginPage() {
  const { setUser } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setErrors({})
    setSubmitting(true)
    try {
      // Deliberately not context's `login()` — that commits the user
      // immediately, and GuestRoute redirects the instant it does, which
      // would cut off the success beat below before it ever plays.
      const data = await authApi.login({ username, password })
      setSuccess(true)
      await new Promise((resolve) => setTimeout(resolve, 550))
      const from = (location.state as { from?: string } | null)?.from
      navigate(from && from !== '/login' ? from : '/', { replace: true })
      setUser(data.user)
    } catch (err) {
      setError(formatApiError(err))
      setErrors(fieldErrors(err))
      setSubmitting(false)
    }
  }

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to pick up your pipeline where you left it."
      error={error}
      success={success}
      footer={
        <>
          No account yet?{' '}
          <Link to="/register" className="font-medium text-brand hover:underline">
            Create one
          </Link>
        </>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={onSubmit}>
        <Input
          label="Username"
          autoComplete="username"
          autoFocus
          required
          value={username}
          error={errors.username}
          onChange={(event) => setUsername(event.target.value)}
        />
        <Input
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          error={errors.password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <Button type="submit" variant="primary" loading={submitting} className="mt-1 w-full">
          {submitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </AuthShell>
  )
}
