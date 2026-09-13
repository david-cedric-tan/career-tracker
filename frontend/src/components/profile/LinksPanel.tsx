import { useEffect, useState, type FormEvent } from 'react'
import { fieldErrors, formatApiError } from '../../api/client'
import { profileLinks } from '../../api/resources'
import type { ProfileLink } from '../../api/types'
import { cx } from '../../lib/format'
import { Button } from '../ui/Button'
import { Card, CardHeader } from '../ui/Card'
import { Input, Select } from '../ui/Field'
import { Icon } from '../ui/Icon'
import { EmptyState, Loading } from '../ui/States'
import { useToast } from '../ui/toast-context'

const CATEGORIES = [
  { value: 'portfolio', label: 'Portfolio' },
  { value: 'github', label: 'GitHub' },
  { value: 'website', label: 'Personal Site' },
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

type LinkDraft = { label: string; url: string; category: string }

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
  const [editingId, setEditingId] = useState<number | null>(null)
  const [copiedId, setCopiedId] = useState<number | null>(null)
  const [draggingId, setDraggingId] = useState<number | null>(null)

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

  async function copy(row: ProfileLink) {
    try {
      await navigator.clipboard.writeText(row.url)
      setCopiedId(row.id)
      // Revert the tick to a copy icon on its own, so the row doesn't stay
      // stuck in a "done" state the next time you look at it.
      window.setTimeout(() => setCopiedId((current) => (current === row.id ? null : current)), 1500)
    } catch {
      notify('Could not copy the link.', 'error')
    }
  }

  async function onDropRow(targetId: number) {
    if (draggingId === null || draggingId === targetId || !rows) return
    const from = rows.findIndex((row) => row.id === draggingId)
    const to = rows.findIndex((row) => row.id === targetId)
    if (from < 0 || to < 0) return

    const ordered = [...rows]
    const [moved] = ordered.splice(from, 1)
    ordered.splice(to, 0, moved)
    setRows(ordered)
    try {
      await profileLinks.reorder(ordered.map((row) => row.id))
    } catch (err) {
      notify(formatApiError(err), 'error')
      await reload()
    }
  }

  async function save(id: number, patch: LinkDraft) {
    const updated = await profileLinks.update(id, patch)
    setRows((current) => (current ?? []).map((row) => (row.id === id ? updated : row)))
    setEditingId(null)
    notify('Link updated.')
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
          {rows.map((row) =>
            editingId === row.id ? (
              <li key={row.id} className="rounded-lg border border-brand bg-surface-2 p-2.5">
                <LinkEditor
                  row={row}
                  onCancel={() => setEditingId(null)}
                  onSave={(patch) => save(row.id, patch)}
                />
              </li>
            ) : (
              <li
                key={row.id}
                draggable
                onDragStart={() => setDraggingId(row.id)}
                onDragEnd={() => setDraggingId(null)}
                // Without preventDefault the row refuses the drop.
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault()
                  void onDropRow(row.id)
                  setDraggingId(null)
                }}
                className={cx(
                  'group/link flex items-center gap-2 rounded-lg border border-line bg-surface-2 py-2 pl-1.5 pr-2.5',
                  'cursor-grab transition-opacity active:cursor-grabbing',
                  draggingId === row.id && 'opacity-40',
                )}
              >
                <span
                  aria-hidden="true"
                  title="Drag to reorder"
                  className="-ml-1 shrink-0 text-ink-3 opacity-0 transition-opacity group-hover/link:opacity-100"
                >
                  <Icon name="gripVertical" size={14} />
                </span>
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
                {/* Focus-within keeps the row reachable by keyboard, where
                    there is no hover to reveal the buttons. */}
                <div className="flex shrink-0 items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover/link:opacity-100">
                  <button
                    type="button"
                    onClick={() => void copy(row)}
                    aria-label={`Copy link to ${row.label}`}
                    className="rounded-lg p-1.5 text-ink-3 transition-colors hover:bg-surface hover:text-brand"
                  >
                    <Icon name={copiedId === row.id ? 'check' : 'copy'} size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(row.id)}
                    aria-label={`Edit ${row.label}`}
                    className="rounded-lg p-1.5 text-ink-3 transition-colors hover:bg-surface hover:text-brand"
                  >
                    <Icon name="edit" size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(row.id)}
                    aria-label={`Remove ${row.label}`}
                    className="rounded-lg p-1.5 text-ink-3 transition-colors hover:bg-surface hover:text-critical"
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              </li>
            ),
          )}
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

/** Edits one row in place, mirroring the add row's fields. Its own state, so
    cancelling leaves the saved link untouched. */
function LinkEditor({
  row,
  onSave,
  onCancel,
}: {
  row: ProfileLink
  onSave: (patch: LinkDraft) => Promise<void>
  onCancel: () => void
}) {
  const { notify } = useToast()
  const [draft, setDraft] = useState<LinkDraft>({
    label: row.label,
    url: row.url,
    category: row.category,
  })
  const [fieldError, setFieldError] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setFieldError({})
    try {
      await onSave(draft)
    } catch (err) {
      setFieldError(fieldErrors(err))
      notify(formatApiError(err), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1.4fr_auto_auto_auto]"
    >
      <Input
        value={draft.label}
        onChange={(event) => setDraft({ ...draft, label: event.target.value })}
        placeholder="Label"
        error={fieldError.label}
        aria-label="Link label"
        autoFocus
      />
      <Input
        value={draft.url}
        onChange={(event) => setDraft({ ...draft, url: event.target.value })}
        placeholder="https://…"
        type="url"
        error={fieldError.url}
        aria-label="Link URL"
      />
      <Select
        value={draft.category}
        onChange={(event) => setDraft({ ...draft, category: event.target.value })}
        aria-label="Link category"
      >
        {CATEGORIES.map((entry) => (
          <option key={entry.value} value={entry.value}>
            {entry.label}
          </option>
        ))}
      </Select>
      <Button type="submit" loading={saving} icon={<Icon name="check" size={14} />}>
        Save
      </Button>
      <Button type="button" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </form>
  )
}
