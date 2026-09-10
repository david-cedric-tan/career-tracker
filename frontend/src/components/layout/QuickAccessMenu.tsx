import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { cx } from '../../lib/format'
import { Icon } from '../ui/Icon'

/** `fx` names the hover animation themed to what each shortcut creates —
    see the `qa-*` block in index.css. */
const SHORTCUTS = [
  { key: 'apply', label: 'Log application', icon: 'briefcase', fx: 'stamp', to: '/applications?new=1' },
  { key: 'lead', label: 'New lead', icon: 'users', fx: 'sonar', to: '/network?new=1' },
  { key: 'coffee', label: 'Coffee chat', icon: 'coffee', fx: 'steam', to: '/catchups?new=1' },
  { key: 'event', label: 'Add event', icon: 'calendar', fx: 'swing', to: '/calendar?new=1' },
  { key: 'resume', label: 'Add resume', icon: 'file', fx: 'write', to: '/resumes?new=1' },
  { key: 'listing', label: 'Add job listing', icon: 'library', fx: 'shimmer', to: '/job-directory?tab=listings&new=1' },
] as const

type ShortcutFx = (typeof SHORTCUTS)[number]['fx']

/** The layers a given effect needs inside its host, behind the icon. */
function ShortcutEffect({ fx }: { fx: ShortcutFx }) {
  if (fx === 'sonar') {
    return (
      <>
        <span className="qa-fx qa-sonar" />
        <span className="qa-fx qa-sonar" style={{ animationDelay: '0.5s' }} />
        <span className="qa-fx qa-sonar" style={{ animationDelay: '1s' }} />
      </>
    )
  }
  if (fx === 'steam') {
    return (
      <>
        <span className="qa-fx qa-steam" style={{ left: '32%' }} />
        <span className="qa-fx qa-steam" style={{ left: '48%', animationDelay: '0.45s' }} />
        <span className="qa-fx qa-steam" style={{ left: '64%', animationDelay: '0.9s' }} />
      </>
    )
  }
  if (fx === 'write') return <span className="qa-fx qa-write" />
  if (fx === 'shimmer') return <span className="qa-fx qa-shimmer" />
  // stamp and swing animate the icon itself, so they add no layer.
  return null
}

/**
 * Bottom-right quick actions — rungs climbing off a single FAB rather than a
 * radial fan, both because a corner anchor has nowhere for a fan to sweep
 * without clipping off-screen, and because it echoes the brand mark's
 * climbing-the-ladder figure (see AppLayout's Brand).
 *
 * Every shortcut just deep-links to `?new=1` on the page that already owns
 * that create-form via `useAutoOpenFromQuery` — the same mechanism the
 * onboarding tour's "try it" actions use, so no new plumbing per page.
 */
export function QuickAccessMenu({ hidden = false }: { hidden?: boolean }) {
  const [open, setOpen] = useState(false)
  const [hovered, setHovered] = useState(false)
  const navigate = useNavigate()
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  if (hidden) return null

  return (
    <div
      ref={rootRef}
      className={cx(
        'fixed bottom-5 right-5 z-40 flex flex-col items-end sm:bottom-6 sm:right-6',
        // Each collapsed item is already pointer-events-none individually,
        // but the row/list wrappers around them still lay out at full open
        // height and — without this — silently eat clicks on whatever page
        // content sits underneath this fixed corner. The toggle button below
        // opts back into pointer-events-auto so it stays clickable either way.
        !open && 'pointer-events-none',
      )}
    >
      <div className="relative flex flex-col items-end">
        <ul className="mb-3 flex flex-col items-end gap-2.5">
          {SHORTCUTS.map((item, index) => (
            <li
              key={item.key}
              className={cx(
                'flex items-center gap-2.5 transition-all duration-100 ease-out',
                open ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-2 opacity-0',
              )}
              style={{ transitionDelay: open ? `${(SHORTCUTS.length - index) * 12}ms` : '0ms' }}
            >
              <span className="rounded-md bg-ink px-2 py-1 text-[11.5px] font-medium text-surface shadow-sm">
                {item.label}
              </span>
              <button
                type="button"
                tabIndex={open ? 0 : -1}
                onClick={() => {
                  setOpen(false)
                  navigate(item.to)
                }}
                aria-label={item.label}
                className="qa-fx-host relative grid size-11 shrink-0 place-items-center overflow-visible rounded-full border border-line bg-surface text-ink shadow-md transition-colors hover:border-brand-ring hover:bg-brand-soft hover:text-brand-strong"
              >
                <span className="qa-pulse" aria-hidden="true" />
                <ShortcutEffect fx={item.fx} />
                <Icon
                  name={item.icon}
                  size={18}
                  className={cx(
                    'relative',
                    item.fx === 'stamp' && 'qa-stamp',
                    item.fx === 'swing' && 'qa-swing',
                  )}
                />
              </button>
            </li>
          ))}
        </ul>
      </div>

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        aria-label={open ? 'Close quick actions' : 'Open quick actions'}
        aria-expanded={open}
        className={cx(
          'pointer-events-auto grid size-14 shrink-0 place-items-center rounded-full bg-brand text-white shadow-lg transition-transform hover:scale-105',
          (open || hovered) && 'fab-glow',
        )}
      >
        <Icon name={open ? 'close' : 'sparkles'} size={22} strokeWidth={2.2} />
      </button>
    </div>
  )
}
