import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Wallpaper } from '../components/layout/Wallpaper'
import { Icon } from '../components/ui/Icon'
import { ThemeToggle } from '../components/ui/ThemeToggle'
import { cx } from '../lib/format'

const HIGHLIGHTS = [
  { icon: 'briefcase', text: 'Every application, every stage — one history you can trust' },
  { icon: 'users', text: 'The people who can open doors, tracked before you forget them' },
  { icon: 'checklist', text: 'Follow-ups that surface before a lead goes cold' },
]

/** Split layout: form on the left, product pitch on the right (desktop only). */
export function AuthShell({
  title,
  subtitle,
  error,
  footer,
  success = false,
  children,
}: {
  title: string
  subtitle: string
  error?: string
  footer: ReactNode
  /** True for the moment between a successful sign-in and the redirect —
      fades the form out behind a checkmark instead of cutting straight to
      the next page. */
  success?: boolean
  children: ReactNode
}) {
  return (
    <>
      <Wallpaper />
      <div className="app-frame grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="relative flex items-center justify-center overflow-hidden px-4 py-10 sm:px-8">
        <ThemeToggle className="absolute right-4 top-4" />

        <div
          className={cx(
            'w-full max-w-sm transition-all duration-300 ease-out',
            success ? 'scale-95 opacity-0 blur-sm' : 'scale-100 opacity-100',
          )}
        >
          <div className="mb-7 flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-xl bg-brand text-white shadow-sm">
              <Icon name="trendingUp" size={19} />
            </span>
            <span className="text-base font-semibold tracking-tight text-ink">
              Career Tracker
            </span>
          </div>

          <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
          <p className="mt-1.5 mb-6 text-sm text-ink-3">{subtitle}</p>

          {error ? (
            <p
              role="alert"
              className="mb-4 flex items-start gap-2 rounded-lg border border-critical/25 bg-critical/10 px-3 py-2.5 text-[13px] text-ink"
            >
              <Icon name="alert" size={15} className="mt-0.5 text-critical" />
              <span>{error}</span>
            </p>
          ) : null}

          {children}

          <p className="mt-6 text-center text-[13px] text-ink-3">{footer}</p>
        </div>

        {success ? (
          <div className="pointer-events-none absolute inset-0 grid place-items-center" aria-hidden="true">
            <span className="grid size-16 animate-[auth-success-pop_0.5s_ease-out] place-items-center rounded-full bg-brand text-white shadow-xl">
              <Icon name="check" size={28} />
            </span>
          </div>
        ) : null}
      </div>

      <aside className="relative hidden overflow-hidden bg-brand lg:flex lg:items-center lg:px-12">
        <div
          aria-hidden="true"
          className="absolute inset-0 opacity-[0.16]"
          style={{
            backgroundImage:
              'radial-gradient(circle at 22% 18%, #fff 0, transparent 42%), radial-gradient(circle at 78% 74%, #fff 0, transparent 46%)',
          }}
        />
        <div className="relative max-w-md text-white">
          <p className="text-[13px] font-medium uppercase tracking-wider text-white/70">
            Built for the long game
          </p>
          <h2 className="mt-3 text-3xl font-semibold leading-tight tracking-tight">
            Your career isn&rsquo;t luck. It&rsquo;s a pipeline — and you&rsquo;re finally
            running it.
          </h2>
          <ul className="mt-8 flex flex-col gap-4">
            {HIGHLIGHTS.map((item) => (
              <li key={item.text} className="flex items-start gap-3">
                <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-white/15">
                  <Icon name={item.icon} size={15} />
                </span>
                <span className="text-sm text-white/90">{item.text}</span>
              </li>
            ))}
          </ul>

          <AuthShowcase />

          <p className="mt-2 text-[13px] italic text-white/60">
            Six months from now, you&rsquo;ll be glad you started today.
          </p>
        </div>
      </aside>
      </div>
    </>
  )
}

const STAGES: {
  stage: string
  company: string
  dot: string
  position: string
  transform: string
}[] = [
  {
    stage: 'Applied',
    company: 'EY',
    dot: 'bg-ink-3',
    position: 'left-0 top-16',
    transform: 'translateZ(0px) rotate(-8deg)',
  },
  {
    stage: 'Interview',
    company: 'Canva',
    dot: 'bg-warning',
    position: 'left-14 top-7',
    transform: 'translateZ(70px) rotate(3deg)',
  },
  {
    stage: 'Offer',
    company: 'Atlassian',
    dot: 'bg-good',
    position: 'left-28 top-0',
    transform: 'translateZ(140px) rotate(-2deg)',
  },
]

/**
 * A small deck of "pipeline stage" cards floating in 3D, tilting toward the
 * pointer — a lightweight, dependency-free stand-in for the "3D" flourish,
 * built from plain CSS perspective/preserve-3d rather than a WebGL library.
 * Static (no pointer-tracking) under prefers-reduced-motion.
 */
function AuthShowcase() {
  const sceneRef = useRef<HTMLDivElement>(null)
  const [tilt, setTilt] = useState({ rx: 8, ry: -10 })

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const scene = sceneRef.current
    if (!scene) return

    const onMove = (event: MouseEvent) => {
      const rect = scene.getBoundingClientRect()
      const px = (event.clientX - rect.left) / rect.width - 0.5
      const py = (event.clientY - rect.top) / rect.height - 0.5
      setTilt({ rx: 8 - py * 16, ry: -10 + px * 20 })
    }
    const onLeave = () => {
      setTilt({ rx: 8, ry: -10 })
    }

    // Only tilts while the pointer is actually over the card stack — not on
    // every mouse move anywhere on the page.
    scene.addEventListener('mousemove', onMove)
    scene.addEventListener('mouseleave', onLeave)
    return () => {
      scene.removeEventListener('mousemove', onMove)
      scene.removeEventListener('mouseleave', onLeave)
    }
  }, [])

  return (
    <div
      ref={sceneRef}
      className="relative mt-10 h-44 w-full perspective-[1400px]"
      aria-hidden="true"
    >
      <div
        className="absolute inset-0 transform-3d transition-transform duration-300 ease-out"
        style={{ transform: `rotateX(${tilt.rx}deg) rotateY(${tilt.ry}deg)` }}
      >
        {STAGES.map((item) => (
          <PipelineCard key={item.stage} {...item} />
        ))}
      </div>
    </div>
  )
}

function PipelineCard({
  stage,
  company,
  dot,
  position,
  transform,
}: {
  stage: string
  company: string
  dot: string
  position: string
  transform: string
}) {
  const style: CSSProperties = { transform }
  return (
    <div
      className={cx(
        'absolute w-36 rounded-xl border border-white/20 bg-white/10 p-3 shadow-2xl backdrop-blur-sm',
        position,
      )}
      style={style}
    >
      <div className="flex items-center justify-between">
        <span className="text-[10.5px] font-medium uppercase tracking-wider text-white/60">
          {stage}
        </span>
        <span className={cx('size-2 rounded-full', dot)} />
      </div>
      <p className="mt-2 text-sm font-semibold text-white">{company}</p>
    </div>
  )
}
