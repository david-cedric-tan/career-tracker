import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { updateProfile } from '../api/auth'
import { onboarding } from '../api/resources'
import type { SampleDataGroup } from '../api/types'
import { useAuth } from '../auth/context'
import { cx } from '../lib/format'
import { SampleDataChecklist } from './SampleDataChecklist'
import { Button } from './ui/Button'
import { Icon } from './ui/Icon'

/** Tags a specific panel or feature named inside a step's description, so
    it reads as "this exact thing" rather than getting lost in the prose. */
function Term({ children }: { children: ReactNode }) {
  return (
    <span className="rounded bg-brand-soft px-1 py-0.5 font-semibold text-brand-strong">
      {children}
    </span>
  )
}

type StepAction = { label: string; query: string }

type StepActionSource =
  | StepAction
  | StepAction[]
  | ((search: string) => StepAction | StepAction[])

function resolveActions(
  action: StepActionSource | undefined,
  search: string,
): StepAction[] {
  if (!action) return []
  const resolved = typeof action === 'function' ? action(search) : action
  return Array.isArray(resolved) ? resolved : [resolved]
}

const STEPS: {
  icon: string
  title: string
  description: ReactNode
  route: string
  /** A small thematic flourish on this step's icon badge — purely
      decorative, no meaning beyond "network" / "coffee". */
  iconEffect?: 'sonar' | 'steam'
  /** Optional "see it live" or "try it" affordance for this step — appends
      `query` to `route`, without advancing to the next step, so the page
      underneath actually shows what the description just described. Static
      for a one-shot action (open a form); a function for one that toggles
      based on the current URL (bubble view vs. card view). Multiple actions
      are fine when a page has more than one thing worth demonstrating. */
  action?: StepActionSource
}[] = [
  {
    icon: 'sparkles',
    title: 'Welcome to Career Tracker',
    description: (
      <>
        This is your dashboard — <Term>Progress Over Time</Term>, <Term>Needs Attention</Term>{' '}
        for what's due this week, and <Term>Recent Activity</Term> for everything that just
        happened. It's a quick, live tour: each step below jumps to the real page.
      </>
    ),
    route: '/',
  },
  {
    icon: 'briefcase',
    title: 'Applications',
    description: (
      <>
        Log a role, move it through each stage, and keep a full history of what changed and
        when. A rejection can carry <strong className="text-ink">notes</strong> and a{' '}
        <strong className="text-ink">reapply reminder</strong> — nothing about it is a dead
        end.
      </>
    ),
    route: '/applications',
    action: { label: 'Try it — log an application', query: '?new=1' },
  },
  {
    icon: 'users',
    title: 'Network',
    description: (
      <>
        Everyone you know, grouped by company — with a <Term>bubble view</Term> that shows who
        you know where, and when you're due to check in with them.
      </>
    ),
    route: '/network',
    iconEffect: 'sonar',
    action: (search) =>
      new URLSearchParams(search).get('view') === 'cards'
        ? { label: 'See the bubble view', query: '' }
        : { label: 'Show card view', query: '?view=cards' },
  },
  {
    icon: 'coffee',
    title: 'Catch-ups',
    description: (
      <>
        A meeting that actually happened, with <strong className="text-ink">minutes</strong> —
        distinct from just remembering you spoke to someone. Log what you talked about and what
        to follow up on.
      </>
    ),
    route: '/catchups',
    iconEffect: 'steam',
    action: { label: 'Try it — log a catch-up', query: '?new=1' },
  },
  {
    icon: 'checklist',
    title: 'Todos',
    description: (
      <>
        A task list that knows the context — tie a todo to an application or a contact, or keep
        it standalone. Your call.
      </>
    ),
    route: '/todos',
    action: { label: 'Try it — add a todo', query: '?new=1' },
  },
  {
    icon: 'calendar',
    title: 'Calendar',
    description: (
      <>
        Every follow-up, reapply reminder and catch-up due date, plus events you add yourself.
        Export any month or year straight to your own calendar app with{' '}
        <Term>Export (.ics)</Term>.
      </>
    ),
    route: '/calendar',
    action: { label: 'Try it — add an event', query: '?new=1' },
  },
  {
    icon: 'file',
    title: 'File Directory',
    description: (
      <>
        Keep application files and resume versions together — link cover letters to an
        application, or keep them general with tags. Applications still pick a resume from
        your library.
      </>
    ),
    route: '/files',
    action: { label: 'Try it — add a resume', query: '?tab=resumes&new=1' },
  },
  {
    icon: 'library',
    title: 'Job Directory',
    description: (
      <>
        The shared reference data behind everything else — companies, roles and listings,
        logged once and reused wherever they're needed.
      </>
    ),
    route: '/job-directory',
    action: { label: 'Try it — add a job listing', query: '?tab=listings&new=1' },
  },
  {
    icon: 'settings',
    title: 'Settings',
    description: (
      <>
        Theme, wallpaper and fonts, your celebration effects, and full backups. It's also where{' '}
        <Term>Bring Your Own AI</Term> lives — convert an existing tracker with any AI, then
        paste or drop the JSON to import it into this account.
      </>
    ),
    route: '/settings',
    action: [
      { label: 'Try it — open import from another tracker', query: '?import=1' },
      { label: 'Try it — upload a background photo', query: '?new=1' },
    ],
  },
  {
    icon: 'check',
    title: "You're set",
    description: (
      <>
        Start here — fill in your <Term>Experience</Term> and <Term>Education</Term>, the
        things worth having on hand before you need them.
      </>
    ),
    route: '/profile',
  },
]

/**
 * FR-AUTH-07 — a live tour: a small floating card, not a full-screen modal,
 * that actually navigates the app as it steps through — the sidebar's own
 * active-link styling follows along for free since this drives the real
 * router rather than describing each page in prose.
 *
 * Two modes: `auto` runs once per account (gated on `Profile.onboarding_completed`)
 * and any way of leaving it — Finish, Skip, or just closing it — marks that
 * flag so it never nags again. `manual` is the same tour reopened from
 * Settings; closing it doesn't touch the flag, since opening it was already
 * a deliberate choice.
 */
export function OnboardingTour({
  open,
  onClose,
  mode,
}: {
  open: boolean
  onClose: () => void
  mode: 'auto' | 'manual'
}) {
  const { setUser } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [index, setIndex] = useState(0)
  const [checklist, setChecklist] = useState<SampleDataGroup[] | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)

  // Reset to the first step whenever this transitions to open — computed
  // during render (matching AppLayout's drawer-close pattern) rather than in
  // an effect, so there's no flash of the previous step before it resets.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setIndex(0)
  }

  // The actual page-change: an effect, not a render-time call, since
  // `navigate()` is an imperative side effect (like any router/DOM API) —
  // it belongs in the same place `document.addEventListener` would.
  useEffect(() => {
    if (open) navigate(STEPS[index].route)
  }, [open, index, navigate])

  // A first-run tour walks through pages that would otherwise be empty, so
  // seed a sample row per domain to look at. Idempotent server-side, and the
  // checklist at the end decides what survives.
  useEffect(() => {
    if (!open || mode !== 'auto') return
    void onboarding.seed().catch(() => {
      // Non-critical — the tour still works, just against empty pages.
    })
  }, [open, mode])

  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      // A "try it" action can open another modal (the real create-form for
      // that page) on top of this card. That modal moves focus into itself
      // and has its own Escape handling — if focus is inside THAT dialog
      // right now (not just "not inside the tour", which is also true the
      // whole time nothing's been clicked in the tour yet), this key is
      // its to handle, or the tour ends up eating the Escape meant for it.
      if (checklist) return
      const active = document.activeElement
      const insideAnotherDialog =
        active instanceof Element &&
        !cardRef.current?.contains(active) &&
        active.closest('[role="dialog"]') !== null
      if (insideAnotherDialog) return
      if (event.key === 'Escape') void dismiss()
      else if (event.key === 'ArrowRight' && index < STEPS.length - 1) setIndex((i) => i + 1)
      else if (event.key === 'ArrowLeft' && index > 0) setIndex((i) => i - 1)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, index, checklist])

  if (!open) return null

  const step = STEPS[index]
  const isFirst = index === 0
  const isLast = index === STEPS.length - 1
  const resolvedActions = resolveActions(step.action, location.search)

  async function finish() {
    if (mode === 'auto') {
      try {
        setUser(await updateProfile({ onboarding_completed: true }))
      } catch {
        // Non-critical — worst case it offers the tour again next time.
      }
    }
    setChecklist(null)
    onClose()
  }

  /** Every exit from an auto-mode tour — Finish, Skip, Escape, the X — goes
      through the keep-or-discard checklist first, so seeded sample rows never
      quietly become permanent. A manual replay skips it: nothing was seeded. */
  async function dismiss() {
    if (mode === 'auto') {
      try {
        const groups = await onboarding.summary()
        if (groups.length) {
          setChecklist(groups)
          return
        }
      } catch {
        // Fall through and just close rather than trapping the user here.
      }
    }
    await finish()
  }

  if (checklist) {
    return <SampleDataChecklist open groups={checklist} onDone={finish} />
  }

  return createPortal(
    <div
      ref={cardRef}
      role="dialog"
      aria-label="Getting started"
      className="fixed inset-x-3 bottom-3 z-50 sm:inset-x-auto sm:bottom-6 sm:right-6 sm:w-116"
    >
      {/* `tour-glow` is a slowly-rotating rainbow ring (index.css) — this
          card sits over a live, busy page, so it needs to read as "look
          here" rather than blend into the corner. */}
      <div className="tour-glow rounded-2xl">
        <div
          key={index}
          className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-6 shadow-2xl intern:backdrop-blur-2xl animate-[auth-success-pop_0.3s_ease-out]"
        >
          <div className="flex items-start gap-3">
            <span className="relative grid size-12 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-strong">
              {step.iconEffect === 'sonar' ? (
                <>
                  <span className="tour-sonar-ring" />
                  <span className="tour-sonar-ring" style={{ animationDelay: '0.6s' }} />
                  <span className="tour-sonar-ring" style={{ animationDelay: '1.2s' }} />
                </>
              ) : null}
              {step.iconEffect === 'steam' ? (
                <>
                  <span className="tour-steam-wisp left-2.5" />
                  <span className="tour-steam-wisp left-5" style={{ animationDelay: '0.5s' }} />
                  <span className="tour-steam-wisp left-8" style={{ animationDelay: '1s' }} />
                </>
              ) : null}
              <Icon name={step.icon} size={23} />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="text-[11px] font-medium uppercase tracking-wide text-ink-3">
                Step {index + 1} of {STEPS.length}
              </p>
              <h3 className="text-[16px] font-semibold text-ink">{step.title}</h3>
            </div>
            <button
              type="button"
              onClick={() => void dismiss()}
              aria-label="Close tour"
              className="-mr-1 -mt-1 shrink-0 rounded-lg p-1.5 text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <Icon name="close" size={16} />
            </button>
          </div>

          <p className="text-[13.5px] leading-relaxed text-ink-2">{step.description}</p>

          {resolvedActions.length > 0 ? (
            <div className="flex flex-col gap-2">
              {resolvedActions.map((action) => (
                <button
                  key={action.query}
                  type="button"
                  onClick={() => navigate(`${step.route}${action.query}`)}
                  className="flex items-center justify-center gap-1.5 rounded-lg border border-brand-ring bg-brand-soft px-3 py-2 text-[12.5px] font-semibold text-brand-strong transition-colors hover:bg-brand-ring/40"
                >
                  <Icon name="sparkles" size={13} />
                  {action.label}
                </button>
              ))}
            </div>
          ) : null}

          <div className="flex items-center gap-1.5" role="tablist" aria-label="Tour progress">
            {STEPS.map((s, i) => (
              <button
                key={s.title}
                type="button"
                role="tab"
                aria-selected={i === index}
                aria-label={`Go to "${s.title}"`}
                onClick={() => setIndex(i)}
                className={cx(
                  'h-1.5 rounded-full transition-all',
                  i === index ? 'w-5 bg-brand' : 'w-1.5 bg-line-strong hover:bg-ink-3',
                )}
              />
            ))}
          </div>

          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => void dismiss()}
              className="text-[12px] font-medium text-ink-3 transition-colors hover:text-ink"
            >
              {mode === 'auto' ? "Don't show this again" : 'Close'}
            </button>
            <div className="flex gap-2">
              {!isFirst ? (
                <Button size="sm" onClick={() => setIndex((i) => i - 1)}>
                  Back
                </Button>
              ) : null}
              {isLast ? (
                <Button size="sm" variant="primary" onClick={() => void dismiss()}>
                  Let's start tracking
                </Button>
              ) : (
                <Button size="sm" variant="primary" onClick={() => setIndex((i) => i + 1)}>
                  Next
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
