import type { ReactNode } from 'react'
import { cx } from '../../lib/format'
import type { Tone } from '../../lib/tones'
import { Tooltip } from './Tooltip'

const TONES: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-ink-2 border-line',
  brand: 'bg-brand-soft text-brand-strong border-brand-ring',
  good: 'bg-good/10 text-good border-good/25',
  warning: 'bg-warning/15 text-[#8a5d00] dark:text-warning border-warning/30',
  serious: 'bg-serious/15 text-[#a04a1f] dark:text-serious border-serious/30',
  critical: 'bg-critical/10 text-critical border-critical/25',
}

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
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  )

  return title ? <Tooltip label={title}>{badge}</Tooltip> : badge
}
