import { useState } from 'react'
import { formatApiError } from '../api/client'
import { onboarding } from '../api/resources'
import type { SampleDataGroup } from '../api/types'
import { Button } from './ui/Button'
import { Icon } from './ui/Icon'
import { Modal } from './ui/Modal'
import { useToast } from './ui/toast-context'

/**
 * Shown once, as the first-run tour ends: the tour seeded a sample application,
 * todo, coffee chat and calendar event so there was something real to click
 * through, and this is where the user says which of those to keep.
 *
 * Everything starts unticked — sample rows are scaffolding, so the default is
 * a clean slate and keeping one is the deliberate choice.
 */
export function SampleDataChecklist({
  open,
  groups,
  onDone,
}: {
  open: boolean
  groups: SampleDataGroup[]
  /** Marks the tour complete (`onboarding_completed: true`) and closes it.
      Awaited before the reload below — otherwise the reload can race the
      profile PATCH, land back with the flag still false, and re-trigger the
      auto tour (which re-seeds sample data) on the very page meant to be
      clean. */
  onDone: () => Promise<void>
}) {
  const { notify } = useToast()
  const [keep, setKeep] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  function toggle(category: string) {
    setKeep((prev) =>
      prev.includes(category) ? prev.filter((c) => c !== category) : [...prev, category],
    )
  }

  async function confirm() {
    setSaving(true)
    try {
      await onboarding.cleanup(keep)
      notify(
        keep.length
          ? `Kept ${keep.length} sample ${keep.length === 1 ? 'set' : 'sets'} — the rest is cleared.`
          : 'Sample data cleared — the app is all yours.',
      )
      // Mark the tour complete *before* reloading — otherwise the reload can
      // land back before that PATCH lands, the flag is still false, and the
      // auto tour re-triggers (re-seeding sample data) on reload.
      await onDone()
      // A hard reload, not just closing the modal: the notifications bell and
      // the dashboard's own widgets fetched their data when the tour first
      // opened, before this cleanup ran, and never refetch on their own —
      // without this a discarded sample todo/event stays visible in the
      // notifications panel even though the row behind it is really gone.
      // Same reasoning as Settings' "delete all my data".
      window.location.assign('/')
    } catch (err) {
      notify(formatApiError(err), 'error')
      setSaving(false)
      void onDone()
    }
  }

  return (
    <Modal
      open={open}
      onClose={onDone}
      title="Keep any of the sample data?"
      description="The tour added a few example rows so the pages weren't empty. Tick anything worth keeping — everything else is deleted."
      footer={
        <Button variant="primary" loading={saving} onClick={() => void confirm()}>
          {keep.length ? `Keep ${keep.length} and clear the rest` : 'Clear it all'}
        </Button>
      }
    >
      <ul className="flex flex-col gap-2">
        {groups.map((group) => {
          const checked = keep.includes(group.category)
          return (
            <li key={group.category}>
              <label
                className={
                  'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ' +
                  (checked
                    ? 'border-brand-ring bg-brand-soft'
                    : 'border-line bg-surface-2 hover:border-line-strong')
                }
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(group.category)}
                  className="mt-0.5 size-4 shrink-0 accent-[var(--brand)]"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-medium text-ink">
                    {group.label}
                    {group.count > 1 ? ` (${group.count})` : ''}
                  </span>
                  {group.examples.length ? (
                    <span className="mt-0.5 block truncate text-[12px] text-ink-3">
                      {group.examples.join(' · ')}
                    </span>
                  ) : null}
                </span>
                {checked ? (
                  <Icon name="check" size={15} className="mt-0.5 shrink-0 text-brand-strong" />
                ) : null}
              </label>
            </li>
          )
        })}
      </ul>
    </Modal>
  )
}
