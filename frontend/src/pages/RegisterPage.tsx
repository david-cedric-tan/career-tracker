import { useState, type ChangeEvent, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import * as authApi from '../api/auth'
import { fieldErrors, formatApiError } from '../api/client'
import { useAuth } from '../auth/context'
import { AuthShell } from './AuthShell'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Field'

export function RegisterPage() {
  const { setUser } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({
    username: '',
    email: '',
    first_name: '',
    last_name: '',
    mobile_number: '',
    linkedin_url: '',
    school_email: '',
    password: '',
    password_confirm: '',
  })
  const [error, setError] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)

  function update(field: keyof typeof form) {
    return (event: ChangeEvent<HTMLInputElement>) =>
      setForm((prev) => ({ ...prev, [field]: event.target.value }))
  }

  const mismatch =
    form.password_confirm.length > 0 && form.password !== form.password_confirm

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setErrors({})
    setSubmitting(true)
    try {
      // Not context's `register()` — see LoginPage for why the commit is
      // deferred until after the success beat.
      const data = await authApi.register(form)
      setSuccess(true)
      await new Promise((resolve) => setTimeout(resolve, 550))
      navigate('/', { replace: true })
      setUser(data.user)
    } catch (err) {
      setError(formatApiError(err))
      setErrors(fieldErrors(err))
      setSubmitting(false)
    }
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="Start tracking applications, contacts and follow-ups."
      error={error}
      success={success}
      footer={
        <>
          Already registered?{' '}
          <Link to="/login" className="font-medium text-brand hover:underline">
            Log in
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
          value={form.username}
          error={errors.username}
          onChange={update('username')}
        />
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={form.email}
          error={errors.email}
          onChange={update('email')}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label="First name"
            autoComplete="given-name"
            required
            value={form.first_name}
            error={errors.first_name}
            onChange={update('first_name')}
          />
          <Input
            label="Last name"
            autoComplete="family-name"
            required
            value={form.last_name}
            error={errors.last_name}
            onChange={update('last_name')}
          />
        </div>
        <Input
          label="Mobile number"
          type="tel"
          autoComplete="tel"
          required
          value={form.mobile_number}
          error={errors.mobile_number}
          onChange={update('mobile_number')}
        />
        <Input
          label="LinkedIn URL"
          type="url"
          placeholder="https://linkedin.com/in/…"
          required
          value={form.linkedin_url}
          error={errors.linkedin_url}
          onChange={update('linkedin_url')}
        />
        <Input
          label="School / work email"
          type="email"
          help="Optional — kept separate from your login email above."
          value={form.school_email}
          error={errors.school_email}
          onChange={update('school_email')}
        />
        <Input
          label="Password"
          type="password"
          autoComplete="new-password"
          required
          value={form.password}
          error={errors.password}
          help="At least 8 characters, and not all numbers."
          onChange={update('password')}
        />
        <Input
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          required
          value={form.password_confirm}
          error={errors.password_confirm ?? (mismatch ? 'Passwords do not match.' : undefined)}
          onChange={update('password_confirm')}
        />
        <Button
          type="submit"
          variant="primary"
          loading={submitting}
          disabled={mismatch}
          className="mt-1 w-full"
        >
          {submitting ? 'Creating…' : 'Create account'}
        </Button>
      </form>
    </AuthShell>
  )
}
