import { useEffect, useState } from 'react'

/**
 * How much the app's panels behave like frosted glass, 0–1.
 *
 * A single dial rather than a set of switches: translucency, blur and the
 * highlight along a panel's top edge all read as one material, so exposing
 * them separately would let you build combinations that look broken. The
 * value drives a `--glass` custom property, and the panels do the rest in CSS.
 *
 * Per browser rather than per account — it's about what this screen can render
 * comfortably, and a heavy blur costs more on a laptop than on a desktop.
 */
const KEY = 'career-tracker:glass'
const EVENT = 'glass-change'

export const DEFAULT_GLASS = 0

export function readGlass(): number {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw === null) return DEFAULT_GLASS
    const value = Number(raw)
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : DEFAULT_GLASS
  } catch {
    return DEFAULT_GLASS
  }
}

/**
 * Paint the value onto <html>.
 *
 * `data-glass` is only present above zero, so the whole glass ruleset costs
 * nothing when it's off — no backdrop-filter on every panel, which is the
 * expensive part.
 */
export function applyGlass(level: number) {
  const root = document.documentElement
  root.style.setProperty('--glass', String(level))
  if (level > 0) root.dataset.glass = 'on'
  else delete root.dataset.glass
}

export function writeGlass(level: number) {
  const clamped = Math.min(1, Math.max(0, level))
  try {
    localStorage.setItem(KEY, String(clamped))
  } catch {
    // Still applies for this visit.
  }
  applyGlass(clamped)
  window.dispatchEvent(new Event(EVENT))
}

export function useGlass(): number {
  const [glass, setGlass] = useState(readGlass)

  useEffect(() => {
    const sync = () => setGlass(readGlass())
    window.addEventListener(EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  return glass
}
