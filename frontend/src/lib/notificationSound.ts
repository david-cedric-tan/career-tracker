/**
 * The reminder alert tone, synthesized with the Web Audio API rather than a
 * bundled audio file — no asset to license or fetch, and it's a handful of
 * oscillator calls.
 *
 * Shaped after iOS's default alert: a bright bell-like ding (a fundamental
 * plus a quiet inharmonic overtone, struck hard and left to ring) rather than
 * a flat sine beep, played as a rising two-note figure.
 *
 * It repeats, because one ding is easy to miss if you're looking elsewhere —
 * but it stops the moment the banner is dismissed, and gives up after two
 * either way rather than nagging indefinitely.
 */

import { readMedia } from './mediaSettings'

const REPEATS = 2
const REPEAT_GAP_MS = 2200

type AudioContextClass = typeof AudioContext

function audioContextClass(): AudioContextClass | undefined {
  return (
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: AudioContextClass }).webkitAudioContext
  )
}

/** One ding. Returns roughly how long it rings, in ms. */
function ding(volume: number): number {
  const AudioCtor = audioContextClass()
  if (!AudioCtor) return 0
  const ctx = new AudioCtor()
  const now = ctx.currentTime

  /** A struck-bell voice: fast attack, long exponential tail. */
  function bell(frequency: number, start: number, duration: number, peak: number) {
    const oscillator = ctx.createOscillator()
    const overtone = ctx.createOscillator()
    const gain = ctx.createGain()

    oscillator.type = 'sine'
    oscillator.frequency.value = frequency
    // A non-integer ratio is what stops it sounding like a plain sine tone —
    // real bells ring inharmonically.
    overtone.type = 'sine'
    overtone.frequency.value = frequency * 2.76

    const overtoneGain = ctx.createGain()
    overtoneGain.gain.value = 0.18
    overtone.connect(overtoneGain)
    overtoneGain.connect(gain)
    oscillator.connect(gain)

    gain.gain.setValueAtTime(0, now + start)
    gain.gain.linearRampToValueAtTime(peak, now + start + 0.006)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + start + duration)
    gain.connect(ctx.destination)

    oscillator.start(now + start)
    overtone.start(now + start)
    oscillator.stop(now + start + duration + 0.05)
    overtone.stop(now + start + duration + 0.05)
  }

  bell(1567.98, 0, 0.5, 0.5 * volume) // G6
  bell(2093.0, 0.16, 0.75, 0.42 * volume) // C7 — the rising second note

  const ringMs = 1000
  window.setTimeout(() => void ctx.close(), ringMs)
  return ringMs
}

/**
 * Plays the alert up to three times. Returns a stop function — call it when
 * the notification is dismissed so the remaining repeats are cancelled.
 */
export function playNotificationSound(): () => void {
  let timer: number | null = null
  let cancelled = false

  // Read at call time rather than captured at import: the volume may have
  // changed since the page loaded, and an alert should honour it now.
  const volume = readMedia().alertVolume
  // Silence means silence — no point scheduling three repeats of nothing, and
  // the visual banner still shows either way.
  if (volume <= 0) return () => {}

  function play(remaining: number) {
    if (cancelled) return
    try {
      ding(volume)
    } catch {
      // Autoplay can be blocked before any user gesture on the page — the
      // visual banner still shows, so there's nothing to recover from.
      return
    }
    if (remaining <= 1) return
    timer = window.setTimeout(() => play(remaining - 1), REPEAT_GAP_MS)
  }

  play(REPEATS)

  return () => {
    cancelled = true
    if (timer !== null) window.clearTimeout(timer)
  }
}
