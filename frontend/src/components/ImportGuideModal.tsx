import { useState } from 'react'
import { IMPORT_GUIDE_PROMPT } from '../lib/importGuide'
import { Button } from './ui/Button'
import { Icon } from './ui/Icon'
import { Modal } from './ui/Modal'

/**
 * "Bring your own AI" bulk import — the guide half of the feature. Hand this
 * prompt to any AI alongside an existing tracker (a spreadsheet, notes,
 * another app's export) and it comes back with one JSON file shaped to match
 * this app's own fields. There's no upload endpoint yet; this just gets the
 * data into a shape that's ready the moment there is one.
 */
export function ImportGuideModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(IMPORT_GUIDE_PROMPT)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API blocked (permissions, insecure context) — the text is
      // still selectable by hand in the box below.
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Import guide"
      description="Copy this, paste it into any AI along with your existing tracker, and save what comes back. There's no upload for that file here yet — this just gets your data into a shape that's ready for when there is."
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <Button
            variant="primary"
            onClick={() => void copy()}
            icon={<Icon name={copied ? 'check' : 'file'} size={15} />}
          >
            {copied ? 'Copied' : 'Copy prompt'}
          </Button>
        </>
      }
    >
      <textarea
        readOnly
        value={IMPORT_GUIDE_PROMPT}
        onFocus={(event) => event.target.select()}
        rows={18}
        className="scrollbar-thin w-full resize-none rounded-lg border border-line bg-surface-2 p-3 font-mono text-[12px] leading-relaxed text-ink-2"
      />
    </Modal>
  )
}
