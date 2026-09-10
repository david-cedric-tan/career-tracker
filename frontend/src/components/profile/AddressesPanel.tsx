import { useEffect, useState, type FormEvent } from 'react'
import { fieldErrors, formatApiError } from '../../api/client'
import { profileAddresses } from '../../api/resources'
import type { ProfileAddress } from '../../api/types'
import { Button } from '../ui/Button'
import { Card, CardHeader } from '../ui/Card'
import { Input, Textarea } from '../ui/Field'
import { Icon } from '../ui/Icon'
import { EmptyState, Loading } from '../ui/States'
import { useToast } from '../ui/toast-context'

/** FR-PROF-08 — free-text + label rather than structured street/city fields:
    a home address, a uni campus and a mailing address don't share one shape. */
export function AddressesPanel() {
  const { notify } = useToast()
  const [rows, setRows] = useState<ProfileAddress[] | null>(null)
  const [error, setError] = useState('')
  const [label, setLabel] = useState('')
  const [address, setAddress] = useState('')
  const [fieldError, setFieldError] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  function reload() {
    return profileAddresses.list().then(setRows)
  }

  useEffect(() => {
    reload().catch((err) => setError(formatApiError(err)))
  }, [])

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setFieldError({})
    try {
      await profileAddresses.create({ label, address })
      setLabel('')
      setAddress('')
      await reload()
      notify('Address added.')
    } catch (err) {
      setFieldError(fieldErrors(err))
      notify(formatApiError(err), 'error')
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: number) {
    try {
      await profileAddresses.remove(id)
      setRows((current) => (current ?? []).filter((row) => row.id !== id))
    } catch (err) {
      notify(formatApiError(err), 'error')
    }
  }

  return (
    <Card>
      <CardHeader title="Addresses" subtitle="Home, campus, mailing — whatever's useful." />

      {error ? (
        <p className="mt-3 text-[13px] text-critical">{error}</p>
      ) : rows === null ? (
        <Loading />
      ) : rows.length === 0 ? (
        <EmptyState icon="building" title="No addresses yet" className="py-6" />
      ) : (
        <ul className="mt-3 flex flex-col gap-1.5">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex items-start gap-2.5 rounded-lg border border-line bg-surface-2 px-2.5 py-2"
            >
              <Icon name="building" size={15} className="mt-0.5 shrink-0 text-brand" />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-ink">{row.label}</p>
                <p className="whitespace-pre-wrap text-[12px] text-ink-3">{row.address}</p>
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

      <form onSubmit={onSubmit} className="mt-3 flex flex-col gap-2">
        <div className="flex gap-2">
          <Input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Label (e.g. Home)"
            error={fieldError.label}
            wrapperClassName="flex-1"
          />
          <Button type="submit" loading={saving} icon={<Icon name="plus" size={14} />}>
            Add
          </Button>
        </div>
        <Textarea
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          placeholder="Address"
          error={fieldError.address}
          rows={2}
        />
      </form>
    </Card>
  )
}
