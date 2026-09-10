import { useState, type FormEvent } from 'react'
import { removeAvatar, updateProfile, uploadAvatar } from '../../api/auth'
import { fieldErrors, formatApiError } from '../../api/client'
import { useAuth } from '../../auth/context'
import { displayName } from '../../lib/format'
import { Button } from '../ui/Button'
import { Card, CardHeader } from '../ui/Card'
import { Input } from '../ui/Field'
import { ImagePicker } from '../ui/ImagePicker'
import { useToast } from '../ui/toast-context'

/** Who you are: avatar, name, and the contact details other domains (and
    recruiters) might need — separate from Settings, which is app preferences. */
export function IdentityCard() {
  const { user, setUser } = useAuth()
  const { notify } = useToast()

  const [form, setForm] = useState({
    first_name: user?.first_name ?? '',
    last_name: user?.last_name ?? '',
    email: user?.email ?? '',
    mobile_number: user?.mobile_number ?? '',
    school_email: user?.school_email ?? '',
    linkedin_url: user?.linkedin_url ?? '',
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const name = displayName(user)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setErrors({})
    try {
      const updated = await updateProfile(form)
      setUser(updated)
      notify('Profile updated.')
    } catch (err) {
      setErrors(fieldErrors(err))
      notify(formatApiError(err), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader title="Identity" subtitle="How people find and reach you." />
      <div className="mt-4 border-b border-line pb-5">
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
      </div>

      <form onSubmit={onSubmit} className="mt-5 flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="First name"
            required
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
        <Input
          label="School / work email"
          type="email"
          help="Optional — kept separate from your login email."
          value={form.school_email}
          error={errors.school_email}
          onChange={(event) => setForm((prev) => ({ ...prev, school_email: event.target.value }))}
        />
        <Input label="Username" value={user?.username ?? ''} disabled help="Usernames can't be changed." />
        <div className="flex justify-end">
          <Button type="submit" variant="primary" loading={saving}>
            Save profile
          </Button>
        </div>
      </form>
    </Card>
  )
}
