import { useEffect, useState, type FormEvent } from 'react'
import { fieldErrors, formatApiError } from '../../api/client'
import { profileLinks } from '../../api/resources'
import type { ProfileLink } from '../../api/types'
import { Button } from '../ui/Button'
import { Card, CardHeader } from '../ui/Card'
import { Input, Select } from '../ui/Field'
import { Icon } from '../ui/Icon'
import { EmptyState, Loading } from '../ui/States'
import { useToast } from '../ui/toast-context'

const CATEGORIES = [
  { value: 'portfolio', label: 'Portfolio' },
  { value: 'github', label: 'GitHub' },
  { value: 'website', label: 'Personal site' },
  { value: 'social', label: 'Social' },
  { value: 'other', label: 'Other' },
]

const CATEGORY_ICON: Record<string, string> = {
  portfolio: 'sparkles',
  github: 'link',
  website: 'link',
  social: 'link',
  other: 'link',
}

/** FR-PROF-07 — important links. Kept optional and lightweight: no modal, no
    required category, so adding one is a single row of inputs. */
export function LinksPanel() {
  const { notify } = useToast()
  const [rows, setRows] = useState<ProfileLink[] | null>(null)
  const [error, setError] = useState('')
  const [label, setLabel] = useState('')
  const [url, setUrl] = useState('')
  const [category, setCategory] = useState('other')
  const [fieldError, setFieldError] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  function reload() {
    return profileLinks.list().then(setRows)
  }

  useEffect(() => {
    reload().catch((err) => setError(formatApiError(err)))
  }, [])

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setFieldError({})
    try {
      await profileLinks.create({ label, url, category })
      setLabel('')
      setUrl('')
      setCategory('other')
      await reload()
      notify('Link added.')
    } catch (err) {
      setFieldError(fieldErrors(err))
      notify(formatApiError(err), 'error')
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: number) {
    try {
      await profileLinks.remove(id)
      setRows((current) => (current ?? []).filter((row) => row.id !== id))
    } catch (err) {
      notify(formatApiError(err), 'error')
    }
  }

  return (
    <Card>
      <CardHeader title="Important Links" subtitle="Portfolio, GitHub, personal site…" />

      {error ? (
        <p className="mt-3 text-[13px] text-critical">{error}</p>
      ) : rows === null ? (
        <Loading />
      ) : rows.length === 0 ? (
        <EmptyState icon="link" title="No links yet" className="py-6" />
      ) : (
        <ul className="mt-3 flex flex-col gap-1.5">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex items-center gap-2.5 rounded-lg border border-line bg-surface-2 px-2.5 py-2"
            >
              <Icon name={CATEGORY_ICON[row.category] ?? 'link'} size={15} className="shrink-0 text-brand" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-ink">{row.label}</p>
                <a
                  href={row.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="block truncate text-[11.5px] text-ink-3 hover:text-brand hover:underline"
                >
                  {row.url}
                </a>
              </div>
              <button
                type="button"
                onClick={() => void remove(row.id)}
                aria-label={`Remove ${row.label}`}
                className="shrink-0 rounded-lg p-1.5 text-ink-3 transition-colors hover:bg-surface hover:text-critical"
              >
                <Icon name="trash" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={onSubmit} className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1.4fr_auto_auto]">
        <Input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="Label"
          error={fieldError.label}
          aria-label="Link label"
        />
        <Input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://…"
          type="url"
          error={fieldError.url}
          aria-label="Link URL"
        />
        <Select
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          aria-label="Link category"
        >
          {CATEGORIES.map((entry) => (
            <option key={entry.value} value={entry.value}>
              {entry.label}
            </option>
          ))}
        </Select>
        <Button type="submit" loading={saving} icon={<Icon name="plus" size={14} />}>
          Add
        </Button>
      </form>
    </Card>
  )
}
