import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { updateProfile } from '../api/auth'
import { useAuth } from '../auth/context'
import {
  applyAppearance,
  defaultThemeMode,
  DEFAULT_FONT,
  DEFAULT_PRESET,
  DEFAULT_WALLPAPER,
  persistBlur,
  persistFont,
  persistOpacity,
  persistPreset,
  persistThemeMode,
  persistWallpaper,
  readBlur,
  readFont,
  readOpacity,
  readPreset,
  readThemeMode,
  readWallpaper,
  THEMES,
  WALLPAPER_META,
  type Theme,
  type ThemeMode,
  type Wallpaper,
} from '../lib/appearance'
import { applyFont, type FontId } from '../lib/fonts'
import { applyPreset, type PresetId } from '../lib/presetThemes'
import { LOCATION_EVENT, resolveCoords } from '../lib/location'
import { isDaytime, isDaytimeFallback } from '../lib/sunTimes'
import { AppearanceContext } from './context'

const DYNAMIC_POLL_MS = 60_000

/**
 * Single source of truth for theme, wallpaper and the two backdrop sliders.
 *
 * These used to be per-component `useState`, which meant the header toggle and
 * the Settings picker could show different "current" values at the same time.
 *
 * Persistence is two-layered: localStorage always gets the change immediately
 * (works logged-out, and means no flash-of-default on this same device), and
 * — once logged in — the account's profile gets it too (FR-APPEAR-*), so it
 * follows the user to another device rather than staying stuck to whichever
 * browser last set it. A device that's shared between accounts no longer
 * leaks one user's picks into another's session.
 */
export function AppearanceProvider({ children }: { children: ReactNode }) {
  const { user, setUser } = useAuth()
  const [theme, setThemeState] = useState<ThemeMode>(readThemeMode)
  const [dynamicIsDay, setDynamicIsDay] = useState(isDaytimeFallback)
  const [wallpaper, setWallpaperState] = useState<Wallpaper>(readWallpaper)
  const [blur, setBlurState] = useState(() => readBlur(readWallpaper()))
  const [opacity, setOpacityState] = useState(() => readOpacity(readWallpaper()))
  const [preset, setPresetState] = useState<PresetId>(() => readPreset() as PresetId)
  const [font, setFontState] = useState<FontId>(() => readFont() as FontId)

  // Best-effort sync to the account — local state and localStorage already
  // have the change, so a failed request just means it won't follow to
  // another device this time.
  const syncProfile = useCallback(
    (patch: Parameters<typeof updateProfile>[0]) => {
      if (!user) return
      void updateProfile(patch).then(setUser).catch(() => {})
    },
    [user, setUser],
  )

  // Once per login (not on every profile refetch), adopt the account's own
  // saved appearance. Every field is saved-value-*or-default* — never "keep
  // what's already here": localStorage may still hold whoever last used this
  // browser, and a new account must not open wearing their theme. A user who
  // has picked nothing gets the defaults; one who has gets exactly theirs,
  // on any device.
  const [syncedForUserId, setSyncedForUserId] = useState<number | null>(null)
  if (user && user.id !== syncedForUserId) {
    setSyncedForUserId(user.id)

    const nextTheme = (user.theme_mode || defaultThemeMode()) as ThemeMode
    persistThemeMode(nextTheme)
    setThemeState(nextTheme)

    const nextWallpaper = (user.wallpaper || DEFAULT_WALLPAPER) as Wallpaper
    persistWallpaper(nextWallpaper)
    setWallpaperState(nextWallpaper)

    const nextBlur = user.wallpaper_blur ?? WALLPAPER_META[nextWallpaper].blur
    persistBlur(nextBlur)
    setBlurState(nextBlur)

    const nextOpacity = user.wallpaper_opacity ?? WALLPAPER_META[nextWallpaper].opacity
    persistOpacity(nextOpacity)
    setOpacityState(nextOpacity)

    const nextPreset = (user.color_preset || DEFAULT_PRESET) as PresetId
    persistPreset(nextPreset)
    setPresetState(nextPreset)

    const nextFont = (user.font_family || DEFAULT_FONT) as FontId
    persistFont(nextFont)
    setFontState(nextFont)
  }

  const resolvedTheme: Theme = theme === 'dynamic' ? (dynamicIsDay ? 'light' : 'dark') : theme

  // While Dynamic mode is active, use cached coordinates (only after this
  // account has allowed location) and re-check the sun every minute. A minute
  // is cheap and means the switch at actual sunrise/sunset never needs a
  // page reload to take effect.
  useEffect(() => {
    if (theme !== 'dynamic') return
    let cancelled = false
    let coords: { lat: number; lon: number } | null = null

    function recompute() {
      setDynamicIsDay(coords ? isDaytime(coords.lat, coords.lon) : isDaytimeFallback())
    }

    function loadCoords() {
      void resolveCoords().then((resolved) => {
        if (cancelled) return
        coords = resolved
        recompute()
      })
    }

    loadCoords()
    recompute()
    window.addEventListener(LOCATION_EVENT, loadCoords)
    const interval = window.setInterval(recompute, DYNAMIC_POLL_MS)
    return () => {
      cancelled = true
      window.removeEventListener(LOCATION_EVENT, loadCoords)
      window.clearInterval(interval)
    }
  }, [theme])

  useEffect(() => {
    applyAppearance(resolvedTheme, wallpaper, blur, opacity)
    // Applied *after* the base theme, so a preset's colours and (for a dark
    // preset) its `.dark` class win over whatever light/dark/intern picked.
    applyPreset(preset)
  }, [resolvedTheme, wallpaper, blur, opacity, preset])

  useEffect(() => {
    applyFont(font)
  }, [font])

  const setTheme = useCallback(
    (next: ThemeMode) => {
      persistThemeMode(next)
      setThemeState(next)
      syncProfile({ theme_mode: next })
    },
    [syncProfile],
  )

  const setWallpaper = useCallback(
    (next: Wallpaper) => {
      persistWallpaper(next)
      setWallpaperState(next)
      // Each image needs a different amount of taming, so switching wallpaper
      // snaps the sliders back to that image's recommended starting point.
      const defaults = WALLPAPER_META[next]
      persistBlur(defaults.blur)
      persistOpacity(defaults.opacity)
      setBlurState(defaults.blur)
      setOpacityState(defaults.opacity)
      syncProfile({
        wallpaper: next,
        wallpaper_blur: defaults.blur,
        wallpaper_opacity: defaults.opacity,
      })
    },
    [syncProfile],
  )

  const setBlur = useCallback(
    (next: number) => {
      persistBlur(next)
      setBlurState(next)
      syncProfile({ wallpaper_blur: next })
    },
    [syncProfile],
  )

  const setOpacity = useCallback(
    (next: number) => {
      persistOpacity(next)
      setOpacityState(next)
      syncProfile({ wallpaper_opacity: next })
    },
    [syncProfile],
  )

  const resetBackdrop = useCallback(() => {
    const defaults = WALLPAPER_META[wallpaper]
    persistBlur(defaults.blur)
    persistOpacity(defaults.opacity)
    setBlurState(defaults.blur)
    setOpacityState(defaults.opacity)
    syncProfile({ wallpaper_blur: defaults.blur, wallpaper_opacity: defaults.opacity })
  }, [wallpaper, syncProfile])

  // Steps light -> dark -> intern -> light. Doesn't include 'dynamic' — that
  // mode is only ever entered from the Settings picker, and ThemeToggle
  // overrides out of it directly rather than routing through this cycle.
  const cycleTheme = useCallback(() => {
    setThemeState((current) => {
      const currentIndex = (THEMES as readonly string[]).indexOf(current)
      const next = THEMES[currentIndex === -1 ? 0 : (currentIndex + 1) % THEMES.length]
      persistThemeMode(next)
      syncProfile({ theme_mode: next })
      return next
    })
  }, [syncProfile])

  const setPreset = useCallback(
    (next: PresetId) => {
      persistPreset(next)
      setPresetState(next)
      syncProfile({ color_preset: next })
    },
    [syncProfile],
  )

  const setFont = useCallback(
    (next: FontId) => {
      persistFont(next)
      setFontState(next)
      syncProfile({ font_family: next })
    },
    [syncProfile],
  )

  const value = useMemo(
    () => ({
      theme,
      resolvedTheme,
      wallpaper,
      blur,
      opacity,
      preset,
      font,
      setTheme,
      setWallpaper,
      setBlur,
      setOpacity,
      setPreset,
      setFont,
      resetBackdrop,
      cycleTheme,
    }),
    [
      theme,
      resolvedTheme,
      wallpaper,
      blur,
      opacity,
      preset,
      font,
      setTheme,
      setWallpaper,
      setBlur,
      setOpacity,
      setPreset,
      setFont,
      resetBackdrop,
      cycleTheme,
    ],
  )

  return (
    <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>
  )
}
