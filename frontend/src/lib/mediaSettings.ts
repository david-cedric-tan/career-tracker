import { useEffect, useState } from 'react'

/**
 * Sound and motion preferences, kept per browser.
 *
 * These are about how the app *feels* on this machine — how loud it is, how
 * eagerly it animates — rather than anything about the account, so they live
 * in localStorage beside the brand scene rather than on the profile.
 */
export type MotionLevel = 'off' | 'low' | 'medium' | 'high'

export type MediaSettings = {
  /** The brand soundtrack and the about screen. 0–1. */
  musicVolume: number
  /** Reminder alerts. Deliberately separate: turning the music down to
      concentrate shouldn't also mute the thing that tells you about a
      deadline. 0–1. */
  alertVolume: number
  /** How eagerly the logo animates. `off` is the "no logo animation" switch —
      one control rather than two that can contradict each other. */
  motion: MotionLevel
}

export const DEFAULT_MEDIA: MediaSettings = {
  musicVolume: 0.35,
  alertVolume: 0.8,
  motion: 'high',
}

/**
 * What each level means in practice: how long you have to rest on the logo
 * before the weather starts, and how long it runs once it has.
 *
 * `Infinity` for high is what "runs until you leave" looks like as a number —
 * the timeout is simply never set.
 */
export const MOTION_PROFILE: Record<
  MotionLevel,
  { delayMs: number; runMs: number; label: string; hint: string }
> = {
  off: { delayMs: 0, runMs: 0, label: 'Off', hint: 'No logo animation' },
  low: { delayMs: 600, runMs: 3000, label: 'Low', hint: 'Slow to start, brief' },
  medium: { delayMs: 250, runMs: 9000, label: 'Medium', hint: 'Quicker, runs a while' },
  high: { delayMs: 0, runMs: Infinity, label: 'High', hint: 'Instant, runs while hovered' },
}

const KEY = 'career-tracker:media'
const EVENT = 'media-settings-change'

function clamp(value: unknown, fallback: number): number {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(1, Math.max(0, number))
}

export function readMedia(): MediaSettings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULT_MEDIA
    const parsed = JSON.parse(raw) as Partial<MediaSettings>
    return {
      musicVolume: clamp(parsed.musicVolume, DEFAULT_MEDIA.musicVolume),
      alertVolume: clamp(parsed.alertVolume, DEFAULT_MEDIA.alertVolume),
      motion:
        parsed.motion && parsed.motion in MOTION_PROFILE
          ? parsed.motion
          : DEFAULT_MEDIA.motion,
    }
  } catch {
    return DEFAULT_MEDIA
  }
}

export function writeMedia(next: MediaSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // Still applies for this visit.
  }
  // The sidebar logo, the about screen and the reminder scheduler are separate
  // trees; a plain setState in one can't reach the others.
  window.dispatchEvent(new Event(EVENT))
}

/** The live settings, kept in step everywhere they're read. */
export function useMediaSettings(): MediaSettings {
  const [media, setMedia] = useState<MediaSettings>(readMedia)

  useEffect(() => {
    const sync = () => setMedia(readMedia())
    window.addEventListener(EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  return media
}
