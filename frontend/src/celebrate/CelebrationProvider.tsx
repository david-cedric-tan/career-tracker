import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CelebrationContext, type CelebrationKind } from './context'

type Particle = {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  colour: string
  size: number
}

/**
 * Palettes are pulled from the live theme tokens, so a burst in intern mode is
 * PwC orange rather than the light theme's blue.
 */
function themeColours(): string[] {
  const styles = getComputedStyle(document.documentElement)
  const read = (name: string, fallback: string) =>
    styles.getPropertyValue(name).trim() || fallback
  return [
    read('--series-1', '#2a78d6'),
    read('--series-2', '#eb6834'),
    read('--series-3', '#1baf7a'),
    read('--color-brand', '#2563eb'),
    read('--color-good', '#0ca30c'),
  ]
}

/** Bigger achievements get a bigger burst. */
const INTENSITY: Record<CelebrationKind, number> = {
  application: 90,
  stage: 120,
  catchup: 60,
  connection: 60,
  todo: 45,
  experience: 70,
}

const GRAVITY = 0.12
const DRAG = 0.985

/**
 * Fireworks on genuine progress (FR-FX-*).
 *
 * A single canvas pinned above the app, `pointer-events: none`, driven by one
 * rAF loop that stops itself when the last particle dies — so it costs nothing
 * while idle and never blocks interaction. Honours `prefers-reduced-motion` by
 * doing nothing at all.
 */
export function CelebrationProvider({ children }: { children: ReactNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const particles = useRef<Particle[]>([])
  const frame = useRef<number | null>(null)
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  // Settings toggle (FR-FX per user opinion: "Settings keeps... celebration
  // toggle"). Persisted per browser like the rest of appearance state.
  const [enabled, setEnabledState] = useState(() => {
    try {
      return localStorage.getItem('celebrationsEnabled') !== 'false'
    } catch {
      return true
    }
  })
  const setEnabled = useCallback((next: boolean) => {
    setEnabledState(next)
    try {
      localStorage.setItem('celebrationsEnabled', String(next))
    } catch {
      // The choice still applies for this session.
    }
  }, [])

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = (event: MediaQueryListEvent) => setReducedMotion(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  /** Advance one frame. Returns whether anything is still alive. */
  const step = useCallback(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return false

    context.clearRect(0, 0, canvas.width, canvas.height)

    const alive: Particle[] = []
    for (const p of particles.current) {
      p.vx *= DRAG
      p.vy = p.vy * DRAG + GRAVITY
      p.x += p.vx
      p.y += p.vy
      p.life -= 1
      if (p.life <= 0 || p.y > canvas.height + 40) continue

      context.globalAlpha = Math.max(0, Math.min(1, p.life / p.maxLife))
      context.fillStyle = p.colour
      context.fillRect(p.x, p.y, p.size, p.size * 1.6)
      alive.push(p)
    }
    context.globalAlpha = 1
    particles.current = alive
    return alive.length > 0
  }, [])

  const celebrate = useCallback(
    (kind: CelebrationKind) => {
      if (reducedMotion || !enabled) return
      const canvas = canvasRef.current
      if (!canvas) return

      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = window.innerWidth * ratio
      canvas.height = window.innerHeight * ratio
      const context = canvas.getContext('2d')
      context?.setTransform(ratio, 0, 0, ratio, 0, 0)

      const colours = themeColours()
      const count = INTENSITY[kind]
      // Two shells, offset horizontally, so it reads as fireworks rather than
      // a single puff.
      const shells = [
        { x: window.innerWidth * 0.34, y: window.innerHeight * 0.36 },
        { x: window.innerWidth * 0.66, y: window.innerHeight * 0.3 },
      ]

      for (const shell of shells) {
        for (let i = 0; i < count / shells.length; i += 1) {
          const angle = Math.random() * Math.PI * 2
          const speed = 2 + Math.random() * 6
          const maxLife = 55 + Math.random() * 45
          particles.current.push({
            x: shell.x,
            y: shell.y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - 2,
            life: maxLife,
            maxLife,
            colour: colours[Math.floor(Math.random() * colours.length)],
            size: 2 + Math.random() * 3,
          })
        }
      }

      if (frame.current === null) {
        // A hoisted declaration, so the loop can schedule itself without
        // referencing a const that isn't initialised yet.
        function run() {
          frame.current = step() ? requestAnimationFrame(run) : null
        }
        frame.current = requestAnimationFrame(run)
      }
    },
    [reducedMotion, enabled, step],
  )

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
    },
    [],
  )

  const value = useMemo(
    () => ({ celebrate, enabled, setEnabled }),
    [celebrate, enabled, setEnabled],
  )

  return (
    <CelebrationContext.Provider value={value}>
      {children}
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-[70] size-full"
      />
    </CelebrationContext.Provider>
  )
}
