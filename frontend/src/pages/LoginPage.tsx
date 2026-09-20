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
  // "Forgot my password": there's no email round-trip, the operator resets
  // it by hand — this just puts the request in their queue.
  const [forgot, setForgot] = useState(false)
  const [forgotMessage, setForgotMessage] = useState('')
  const [forgotSent, setForgotSent] = useState(false)
  const [forgotBusy, setForgotBusy] = useState(false)

  async function sendForgot(event: FormEvent) {
    event.preventDefault()
    setError('')
    setForgotBusy(true)
    try {
      await authApi.requestPasswordReset({ username, message: forgotMessage })
      setForgotSent(true)
    } catch (err) {
      setError(formatApiError(err))
    } finally {
      setForgotBusy(false)
    }
  }

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
      // Operators go to the console, whatever page they were sent from.
      const home = data.user.is_superuser ? '/console' : '/'
      navigate(from && from !== '/login' && !data.user.is_superuser ? from : home, { replace: true })
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
      {forgot ? (
        forgotSent ? (
          <div className="flex flex-col gap-4">
            <p className="text-[13.5px] text-ink-2">
              If <span className="font-medium text-ink">{username}</span> is an account here, the
              operator has been asked to set a new password for it. They'll pass it on to you
              directly — there's no email on the way.
            </p>
            <Button
              type="button"
              onClick={() => {
                setForgot(false)
                setForgotSent(false)
                setForgotMessage('')
              }}
              className="w-full"
            >
              Back to sign in
            </Button>
          </div>
        ) : (
          <form className="flex flex-col gap-4" onSubmit={sendForgot}>
            <p className="text-[13px] text-ink-3">
              Passwords are reset by the operator, not by email. Send them your username and
              they'll set a new one and get it to you.
            </p>
            <Input
              label="Username"
              autoComplete="username"
              autoFocus
              required
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
            <Input
              label="Anything they should know"
              placeholder="Optional — how to reach you, what happened"
              value={forgotMessage}
              maxLength={280}
              onChange={(event) => setForgotMessage(event.target.value)}
            />
            <Button type="submit" variant="primary" loading={forgotBusy} className="mt-1 w-full">
              Ask for a reset
            </Button>
            <button
              type="button"
              onClick={() => setForgot(false)}
              className="text-[12.5px] font-medium text-ink-3 hover:text-ink"
            >
              Back to sign in
            </button>
          </form>
        )
      ) : (
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
          <button
            type="button"
            onClick={() => {
              setError('')
              setForgot(true)
            }}
            className="self-center text-[12.5px] font-medium text-ink-3 hover:text-brand hover:underline"
          >
            Forgot your password?
          </button>
        </form>
      )}
    </AuthShell>
  )
}
