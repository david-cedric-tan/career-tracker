import { createContext, useContext } from 'react'
import type { Theme, ThemeMode, Wallpaper } from '../lib/appearance'
import type { FontId } from '../lib/fonts'
import type { PresetId } from '../lib/presetThemes'

export type AppearanceValue = {
  /** What the user picked — light/dark/intern, or 'dynamic'. Drives the
      Settings picker's active state. */
  theme: ThemeMode
  /** What 'theme' actually resolves to right now — 'dynamic' resolved
      against the sun. This is what every themed CSS rule keys off. */
  resolvedTheme: Theme
  wallpaper: Wallpaper
  /** Backdrop blur in px. */
  blur: number
  /** How much of the wallpaper shows through the scrim, 5–100. */
  opacity: number
  /** A named colour-scheme override (Dracula, Nord, …), or 'none'. */
  preset: PresetId
  /** The site-wide font family. */
  font: FontId
  setTheme: (theme: ThemeMode) => void
  setWallpaper: (wallpaper: Wallpaper) => void
  setBlur: (blur: number) => void
  setOpacity: (opacity: number) => void
  setPreset: (preset: PresetId) => void
  setFont: (font: FontId) => void
  /** Snap both sliders back to the current wallpaper's recommended values. */
  resetBackdrop: () => void
  /** Step light → dark → intern → light, for the single header button.
      Leaves 'dynamic' alone — see ThemeToggle for how that mode overrides. */
  cycleTheme: () => void
}

export const AppearanceContext = createContext<AppearanceValue | null>(null)

export function useAppearance(): AppearanceValue {
  const ctx = useContext(AppearanceContext)
  if (!ctx) throw new Error('useAppearance must be used within AppearanceProvider')
  return ctx
}
