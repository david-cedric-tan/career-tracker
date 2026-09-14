import type { ReactNode } from 'react'
import { cx } from '../../lib/format'
import { TONE_CHIP, type Tone } from '../../lib/tones'
import { Tooltip } from './Tooltip'


export function Badge({
  tone = 'neutral',
  children,
  className,
  title,
}: {
  tone?: Tone
  children: ReactNode
  className?: string
  /** Hover text. Shown immediately rather than after the global dwell: a
      status badge is a summary, and the date behind it is the obvious next
      question — waiting a beat to answer it just feels unresponsive. */
  title?: string
}) {
  const badge = (
    <span
      className={cx(
        // `whitespace-nowrap`: a pill is a single token. Letting "Assessment
        // centre" wrap turns the oval into a lumpy two-line blob that no
        // longer reads as one label.
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5',
        'text-[11px] font-medium leading-5',
        TONE_CHIP[tone],
        className,
      )}
    >
      {children}
    </span>
  )

  return title ? <Tooltip label={title}>{badge}</Tooltip> : badge
}
