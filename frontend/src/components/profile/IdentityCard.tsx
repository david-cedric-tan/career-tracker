import { useState, type FormEvent, type ReactNode } from 'react'
import { removeAvatar, updateProfile, uploadAvatar } from '../../api/auth'
import { fieldErrors, formatApiError } from '../../api/client'
import { useAuth } from '../../auth/context'
import { displayName } from '../../lib/format'
import { Avatar } from '../ui/Avatar'
import { Button } from '../ui/Button'
import { Card, CardHeader } from '../ui/Card'
import { Input } from '../ui/Field'
import { Icon } from '../ui/Icon'
import { ImagePicker } from '../ui/ImagePicker'
import { useToast } from '../ui/toast-context'

/**
 * The identifying part of a LinkedIn URL — "in/davidcedrictan" out of
 * "https://www.linkedin.com/in/davidcedrictan/".
 *
 * The protocol and domain are the same on every LinkedIn profile, so showing
 * them costs the width that would otherwise show the handle itself. Anything
 * that isn't a recognisable LinkedIn URL is left alone rather than mangled.
 */
function linkedinHandle(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '')
  const match = trimmed.match(/linkedin\.com\/(.+)$/i)
  return match ? match[1] : trimmed
}

/** Who you are: avatar, name, and the contact details other domains (and
    recruiters) might need — separate from Settings, which is app preferences.

    Read-only until you ask to edit. This is a page you open to *check* your
    details far more often than to change them, and a card full of live inputs
    invites accidental edits to fields nobody meant to touch. */
export function IdentityCard() {
  const { user, setUser } = useAuth()
  const { notify } = useToast()

  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState(current)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const name = displayName(user)

  function current() {
    return {
      first_name: user?.first_name ?? '',
      last_name: user?.last_name ?? '',
      preferred_name: user?.preferred_name ?? '',
      email: user?.email ?? '',
      mobile_number: user?.mobile_number ?? '',
      school_email: user?.school_email ?? '',
      personal_email: user?.personal_email ?? '',
      linkedin_url: user?.linkedin_url ?? '',
    }
  }

  function startEditing() {
    // Re-seed from the account rather than reusing stale state, so reopening
    // after a cancel never shows the abandoned draft.
    setForm(current())
    setErrors({})
    setEditing(true)
  }

  function cancel() {
    setForm(current())
    setErrors({})
    setEditing(false)
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setErrors({})
    try {
      const updated = await updateProfile(form)
      setUser(updated)
      notify('Profile updated.')
      setEditing(false)
    } catch (err) {
      setErrors(fieldErrors(err))
      notify(formatApiError(err), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader
        title="Identity"
        subtitle="How people find and reach you."
        action={
          editing ? undefined : (
            <Button size="sm" onClick={startEditing} icon={<Icon name="edit" size={14} />}>
              Edit
            </Button>
          )
        }
      />

      <div className="mt-4 border-b border-line pb-5">
        {editing ? (
          <ImagePicker
            name={name}
            src={user?.avatar ?? null}
            label="profile picture"
            helpText="Also used as the app mark in the sidebar."
            onUpload={async (file) => {
              setUser(await uploadAvatar(file))
              notify('Profile picture updated.')
            }}
            onRemove={
              user?.avatar
                ? async () => {
                    setUser(await removeAvatar())
                    notify('Profile picture removed.')
                  }
                : undefined
            }
          />
        ) : (
          <div className="flex items-center gap-3.5">
            <Avatar name={name} src={user?.avatar} size="lg" />
            <div className="min-w-0">
              <p className="truncate text-[15px] font-semibold text-ink">{name || '—'}</p>
              <p className="truncate text-[12.5px] text-ink-3">@{user?.username}</p>
            </div>
          </div>
        )}
      </div>

      {editing ? (
        <form onSubmit={onSubmit} className="mt-5 flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="First name"
              required
              autoFocus
              value={form.first_name}
              error={errors.first_name}
              onChange={(event) => setForm((prev) => ({ ...prev, first_name: event.target.value }))}
            />
            <Input
              label="Last name"
              required
              value={form.last_name}
              error={errors.last_name}
              onChange={(event) => setForm((prev) => ({ ...prev, last_name: event.target.value }))}
            />
          </div>
          <Input
            label="Preferred name"
            placeholder={user?.first_name?.split(' ')[0] || 'Dave'}
            maxLength={40}
            value={form.preferred_name}
            error={errors.preferred_name}
            help="What the sidebar and greeting call you — keep it short."
            onChange={(event) => setForm((prev) => ({ ...prev, preferred_name: event.target.value }))}
          />
          <Input
            label="Email"
            type="email"
            required
            value={form.email}
            error={errors.email}
            onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Mobile number"
              required
              value={form.mobile_number}
              error={errors.mobile_number}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, mobile_number: event.target.value }))
              }
            />
            <Input
              label="LinkedIn URL"
              type="url"
              required
              placeholder="https://linkedin.com/in/…"
              value={form.linkedin_url}
              error={errors.linkedin_url}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, linkedin_url: event.target.value }))
              }
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="School / work email"
              type="email"
              help="Optional — kept separate from your login email."
              value={form.school_email}
              error={errors.school_email}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, school_email: event.target.value }))
              }
            />
            <Input
              label="Personal email"
              type="email"
              help="Optional — the one to use after university."
              value={form.personal_email}
              error={errors.personal_email}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, personal_email: event.target.value }))
              }
            />
          </div>
          <Input
            label="Username"
            value={user?.username ?? ''}
            disabled
            help="Usernames can't be changed."
          />
          <div className="flex justify-end gap-2">
            <Button type="button" onClick={cancel}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={saving}>
              Save profile
            </Button>
          </div>
        </form>
      ) : (
        <dl className="mt-5 grid gap-x-6 gap-y-4 sm:grid-cols-2">
          <Detail label="First name" value={user?.first_name} />
          <Detail label="Last name" value={user?.last_name} />
          <Detail label="Preferred name" value={user?.preferred_name} />
          <Detail label="Email" value={user?.email} />
          <Detail label="Mobile number" value={user?.mobile_number} />
          <Detail
            label="LinkedIn"
            value={user?.linkedin_url ? <LinkedinValue url={user.linkedin_url} /> : null}
          />
          <Detail label="School / work email" value={user?.school_email} />
          <Detail label="Personal email" value={user?.personal_email} />
        </dl>
      )}
    </Card>
  )
}

/** The handle, linked, with a copy button that appears on hover. */
function LinkedinValue({ url }: { url: string }) {
  const { notify } = useToast()
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      // Copies the full URL, not the shortened handle on screen — what you
      // want on your clipboard is something you can paste and open.
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      notify('Could not copy the link.', 'error')
    }
  }

  return (
    <span className="group/li flex min-w-0 items-center gap-1">
      <a
        href={url}
        target="_blank"
        rel="noreferrer noopener"
        title={url}
        className="min-w-0 truncate text-brand hover:underline"
      >
        {linkedinHandle(url)}
      </a>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label="Copy LinkedIn URL"
        className="shrink-0 rounded p-1 text-ink-3 opacity-0 transition-opacity hover:text-brand focus:opacity-100 group-hover/li:opacity-100"
      >
        <Icon name={copied ? 'check' : 'copy'} size={13} />
      </button>
    </span>
  )
}

function Detail({
  label,
  value,
  className,
}: {
  label: string
  value?: ReactNode
  className?: string
}) {
  return (
    <div className={className}>
      <dt className="text-[11.5px] font-medium uppercase tracking-wide text-ink-3">{label}</dt>
      <dd className="mt-0.5 truncate text-[13.5px] text-ink">{value || '—'}</dd>
    </div>
  )
}
