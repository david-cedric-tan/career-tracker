import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cx } from '../../lib/format'
import { Icon } from './Icon'

const PHONE = '(max-width: 639px)'

function readOpen(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(`filterDrawer:${key}`)
    return raw === null ? fallback : raw === '1'
  } catch {
    return fallback
  }
}

/**
 * A row of filter chips behind one button.
 *
 * On a phone a dozen chips is most of the screen before any content, so the
 * row starts folded and one tap unfurls it — each chip springing in a beat
 * after the last. On a desktop it starts open. Either way the choice sticks
 * per page, and the button shows how many filters are live while folded.
 */
export function FilterDrawer({
  id,
  label = 'Filters',
  activeCount = 0,
  children,
  className,
  trailing,
}: {
  /** Remembers open/closed per page. */
  id: string
  label?: string
  /** Live filters — shown as a count on the folded button. */
  activeCount?: number
  children: ReactNode
  className?: string
  /** Sits on the button's row, right-aligned (a sort control, say). */
  trailing?: ReactNode
}) {
  const [open, setOpen] = useState(() =>
    readOpen(id, typeof window === 'undefined' ? true : !window.matchMedia(PHONE).matches),
  )
  useEffect(() => {
    try {
      localStorage.setItem(`filterDrawer:${id}`, open ? '1' : '0')
    } catch {
      /* preference only */
    }
  }, [id, open])

  // Phones unfold downwards (there's no room beside the button); anything
  // wider unfolds sideways along the same row, so the chips read as an
  // extension of the button rather than a second toolbar.
  const [phone, setPhone] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(PHONE).matches,
  )
  useEffect(() => {
    const query = window.matchMedia(PHONE)
    const onChange = (event: MediaQueryListEvent) => setPhone(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  // Sideways: while the width is animating the chips must not wrap, or a
  // shrinking row turns into a tall column and pushes the page down. They're
  // allowed to wrap only once the row has fully opened.
  const [settled, setSettled] = useState(open)
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(open), open ? 320 : 0)
    return () => window.clearTimeout(timer)
  }, [open])
  // Closing is a slow fold back into the button: the chips slide toward it
  // and fade while the row narrows, and only then does the row lose its
  // height. `collapsed` is the "fully shut" state that follows.
  const [collapsed, setCollapsed] = useState(!open)
  useEffect(() => {
    const timer = window.setTimeout(() => setCollapsed(!open), open ? 0 : 560)
    return () => window.clearTimeout(timer)
  }, [open])
  const closing = !open && !collapsed

  // Sideways rows ease their *height* shut: a row of chips that had wrapped
  // onto two lines used to snap to one the instant it started closing, which
  // shoved the page below it. On close the height is pinned to its measured
  // value, then eased to zero while the chips slide back and fade. Opening
  // is the column unfurling on a single line, so no height animation there.
  const rowRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = rowRef.current
    if (!el || phone) return
    if (open) {
      el.style.height = ''
      el.style.overflow = ''
      return
    }
    const current = el.offsetHeight
    if (current === 0) return
    el.style.height = `${current}px`
    el.style.overflow = 'hidden'
    requestAnimationFrame(() => {
      el.style.height = '0px'
    })
  }, [open, phone])

  const toggle = (
    <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className={cx(
            'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors',
            open || activeCount > 0
              ? 'border-brand bg-brand-soft text-brand-strong'
              : 'border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink',
          )}
        >
          <Icon name="list" size={13} />
          {label}
          {activeCount > 0 ? (
            <span className="grid min-w-[18px] place-items-center rounded-full bg-brand px-1 text-[10.5px] font-semibold text-white">
              {activeCount}
            </span>
          ) : null}
          <Icon
            name={phone ? 'chevronDown' : 'chevronRight'}
            size={13}
            className={cx('transition-transform duration-300', open && (phone ? 'rotate-180' : 'rotate-180'))}
          />
        </button>
  )

  if (phone) {
    return (
      <div className={className}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          {toggle}
          {trailing}
        </div>
        <div
          className={cx(
            'grid transition-[grid-template-rows,opacity,margin] ease-[cubic-bezier(0.34,1.56,0.64,1)]',
            open ? 'mt-2 grid-rows-[1fr] opacity-100 duration-[450ms]' : 'grid-rows-[0fr] opacity-0 duration-[550ms]',
          )}
          aria-hidden={!open}
        >
          <div
            className={cx(
              'min-h-0 overflow-hidden',
              open && 'filter-drawer-open',
              closing && 'filter-drawer-closing',
            )}
          >
            <div className="flex flex-wrap gap-1.5 pb-0.5">{children}</div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={cx('flex flex-wrap items-center gap-2', className)}>
      {toggle}
      <div
        ref={rowRef}
        className={cx(
          'grid min-w-0 flex-1 transition-[grid-template-columns,opacity,height] ease-[cubic-bezier(0.34,1.56,0.64,1)]',
          // Closing keeps the column open and animates height + chips
          // instead — collapsing the column while chips wrap makes a tower.
          open ? 'grid-cols-[1fr] opacity-100 duration-300' : 'grid-cols-[1fr] opacity-0 duration-[550ms]',
          collapsed && 'h-0',
        )}
        aria-hidden={!open}
      >
        <div
          className={cx(
            'min-w-0 overflow-hidden',
            open && 'filter-drawer-open',
            closing && 'filter-drawer-closing',
          )}
        >
          <div
            className={cx(
              'flex gap-1.5 py-0.5 pl-1',
              // While narrowing, chips must neither wrap nor squeeze their
              // text onto two lines — either would change the row's height.
              settled || closing ? 'flex-wrap [&>*]:shrink-0' : 'flex-nowrap [&>*]:shrink-0',
            )}
          >
            {children}
          </div>
        </div>
      </div>
      {trailing ? <div className="ml-auto shrink-0">{trailing}</div> : null}
    </div>
  )
}
