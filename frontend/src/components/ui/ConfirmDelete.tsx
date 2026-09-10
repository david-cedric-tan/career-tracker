import { useState } from 'react'
import { formatApiError } from '../../api/client'
import { Button } from './Button'
import { Modal } from './Modal'
import { useToast } from './toast-context'

/**
 * "Are you sure?" for anything destructive.
 *
 * One component rather than each panel rolling its own, so every delete in the
 * app asks the same way and names the same two things: what kind of record is
 * going, and which one. A dialog that only says "Are you sure?" makes you
 * reconstruct what you clicked; naming it lets you catch the wrong row before
 * it's gone rather than after.
 */
export function ConfirmDelete({
  open,
  onClose,
  onConfirm,
  /** The kind of record — "application", "contact", "catch-up". Lowercase. */
  kind,
  /** Which one, if it has a name worth showing. */
  name,
  /** Anything that goes with it, so the cost is stated before the click. */
  consequence,
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => Promise<void> | void
  kind: string
  name?: string | null
  consequence?: string
}) {
  const { notify } = useToast()
  const [deleting, setDeleting] = useState(false)

  async function confirm() {
    setDeleting(true)
    try {
      await onConfirm()
      onClose()
    } catch (err) {
      notify(formatApiError(err), 'error')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Delete this ${kind}?`}
      footer={
        <>
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => void confirm()} loading={deleting}>
            Delete {kind}
          </Button>
        </>
      }
    >
      <p className="text-[13.5px] text-ink-2">
        {name ? (
          <>
            <strong className="font-semibold text-ink">{name}</strong> will be permanently
            deleted.
          </>
        ) : (
          <>This {kind} will be permanently deleted.</>
        )}{' '}
        {consequence ? <span>{consequence} </span> : null}
        This can&rsquo;t be undone.
      </p>
    </Modal>
  )
}
