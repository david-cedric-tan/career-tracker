import { Tooltip } from './Tooltip'

/**
 * An "i" that explains something on hover.
 *
 * Settings had grown a paragraph under almost every control — accurate, but
 * you read them once and then they're permanent clutter around the thing you
 * actually came to change. Behind an icon the explanation is still one hover
 * away for anyone who wants it, and invisible to everyone who doesn't.
 */
export function InfoHint({ label }: { label: string }) {
  return (
    <Tooltip
      label={
        // Wide enough to break into a few readable lines rather than a tall
        // narrow column, and `whitespace-normal` because the tooltip itself
        // defaults to nowrap for one-line labels.
        <span className="block w-64 whitespace-normal leading-relaxed">{label}</span>
      }
    >
      <span
        role="img"
        aria-label={label}
        tabIndex={0}
        className="grid size-4 shrink-0 cursor-help place-items-center rounded-full border border-line text-[9px] font-bold text-ink-3 transition-colors hover:border-brand hover:text-brand"
      >
        i
      </span>
    </Tooltip>
  )
}
