import { useEffect, useState } from 'react'

/**
 * Calendar visual effects — deadline glow colour and whether the looping
 * breath/orbit runs. Per-browser, like media settings.
 */
export type CalendarEffectColor = 'critical' | 'brand' | 'warning' | 'serious' | 'info' | 'good'

export type CalendarEffects = {
  enabled: boolean
  color: CalendarEffectColor
}

export const DEFAULT_CALENDAR_EFFECTS: CalendarEffects = {
  enabled: true,
  color: 'critical',
}

export const CALENDAR_EFFECT_COLORS: {
  value: CalendarEffectColor
  label: string
  cssVar: string
}[] = [
  { value: 'critical', label: 'Red', cssVar: 'var(--color-critical)' },
  { value: 'brand', label: 'Brand', cssVar: 'var(--color-brand)' },
  { value: 'warning', label: 'Amber', cssVar: 'var(--color-warning)' },
  { value: 'serious', label: 'Orange', cssVar: 'var(--color-serious)' },
  { value: 'info', label: 'Violet', cssVar: 'var(--color-info)' },
  { value: 'good', label: 'Green', cssVar: 'var(--color-good)' },
]

const KEY = 'career-tracker:calendar-effects'
const EVENT = 'calendar-effects-change'

export function readCalendarEffects(): CalendarEffects {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULT_CALENDAR_EFFECTS
    const parsed = JSON.parse(raw) as Partial<CalendarEffects>
    const color = CALENDAR_EFFECT_COLORS.some((row) => row.value === parsed.color)
      ? (parsed.color as CalendarEffectColor)
      : DEFAULT_CALENDAR_EFFECTS.color
    return {
      enabled: parsed.enabled !== false,
      color,
    }
  } catch {
    return DEFAULT_CALENDAR_EFFECTS
  }
}

export function writeCalendarEffects(next: CalendarEffects) {
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* still applies this visit */
  }
  window.dispatchEvent(new Event(EVENT))
}

export function useCalendarEffects(): [CalendarEffects, (next: CalendarEffects) => void] {
  const [effects, setEffects] = useState<CalendarEffects>(readCalendarEffects)

  useEffect(() => {
    const sync = () => setEffects(readCalendarEffects())
    window.addEventListener(EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  function update(next: CalendarEffects) {
    writeCalendarEffects(next)
    setEffects(next)
  }

  return [effects, update]
}

export function calendarEffectCssVar(color: CalendarEffectColor): string {
  return (
    CALENDAR_EFFECT_COLORS.find((row) => row.value === color)?.cssVar ??
    'var(--color-critical)'
  )
}
