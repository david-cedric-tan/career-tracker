import cityTowers from '../assets/wallpapers/city-towers.jpg'
import orbitAtlantis from '../assets/wallpapers/orbit-atlantis.jpg'
import pwcLockscreen from '../assets/wallpapers/pwc-lockscreen.jpg'
import sageArches from '../assets/wallpapers/sage-arches.jpg'

export const THEMES = ['light', 'dark', 'intern'] as const
/** A resolved, paintable palette — what actually ends up as a class on <html>. */
export type Theme = (typeof THEMES)[number]

/** What the user picked. 'dynamic' isn't a palette itself — it resolves to
    'light' or 'dark' from the sun's position (see lib/sunTimes.ts). */
export const THEME_MODES = [...THEMES, 'dynamic'] as const
export type ThemeMode = (typeof THEME_MODES)[number]

export const THEME_META: Record<ThemeMode, { label: string; icon: string; hint: string }> = {
  light: { label: 'Light', icon: 'sun', hint: 'Flat surfaces, maximum contrast.' },
  dark: { label: 'Dark', icon: 'moon', hint: 'Same layout, dark surfaces.' },
  intern: { label: 'Intern', icon: 'sparkles', hint: 'PwC palette over a wallpaper.' },
  dynamic: {
    label: 'Dynamic',
    icon: 'clock',
    hint: 'Light by day, dark by night — follows sunrise and sunset where you are.',
  },
}

export const WALLPAPERS = ['pwc', 'city', 'orbit', 'sage', 'custom', 'none'] as const
export type Wallpaper = (typeof WALLPAPERS)[number]

export type WallpaperMeta = {
  label: string
  description: string
  /** null = no image, just the flat themed page colour. */
  url: string | null
  /** Starting point for the sliders; the photos need more taming than the
      soft PwC gradient does. */
  blur: number
  opacity: number
}

export const WALLPAPER_META: Record<Wallpaper, WallpaperMeta> = {
  pwc: {
    label: 'Ember Dawn',
    description: 'White warming into rose and orange.',
    url: pwcLockscreen,
    blur: 30,
    opacity: 82,
  },
  city: {
    label: 'City towers',
    description: 'Looking up through a financial district.',
    url: cityTowers,
    blur: 20,
    opacity: 40,
  },
  orbit: {
    label: 'Orbit',
    description: 'Atlantis over the Bahamas.',
    url: orbitAtlantis,
    blur: 20,
    opacity: 36,
  },
  sage: {
    label: 'Sage arches',
    description: 'Soft green architectural forms.',
    url: sageArches,
    blur: 22,
    opacity: 42,
  },
  custom: {
    label: 'Your own photo',
    description: 'Upload a background from your own device.',
    // Resolved at render time from the signed-in user's `custom_wallpaper` —
    // this static entry only supplies the label/description/slider defaults.
    url: null,
    blur: 24,
    opacity: 45,
  },
  none: {
    label: 'No image',
    description: 'Flat PwC-tinted background.',
    url: null,
    blur: 0,
    opacity: 0,
  },
}

const THEME_KEY = 'theme'
const WALLPAPER_KEY = 'wallpaper'
const BLUR_KEY = 'wallpaperBlur'
const OPACITY_KEY = 'wallpaperOpacity'

export const BLUR_RANGE = { min: 0, max: 48 }
export const OPACITY_RANGE = { min: 5, max: 100 }

function clamp(value: number, { min, max }: { min: number; max: number }): number {
  return Math.min(Math.max(value, min), max)
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    // Private mode / blocked site data — fall back to the defaults.
    return null
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // The DOM is still updated; the choice just won't survive a reload.
  }
}

/**
 * What an account that has never picked anything gets. Exported so signing in
 * can *reset* to these rather than leaving whatever the previous user of this
 * browser chose — a saved-or-default answer for every field, never "keep".
 */
export const DEFAULT_WALLPAPER: Wallpaper = 'pwc'

export function defaultThemeMode(): ThemeMode {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function readThemeMode(): ThemeMode {
  const stored = read(THEME_KEY)
  if (stored && (THEME_MODES as readonly string[]).includes(stored)) return stored as ThemeMode
  return defaultThemeMode()
}

export function readWallpaper(): Wallpaper {
  const stored = read(WALLPAPER_KEY)
  if (stored && (WALLPAPERS as readonly string[]).includes(stored)) {
    return stored as Wallpaper
  }
  return DEFAULT_WALLPAPER
}

function readNumber(key: string, fallback: number, range: { min: number; max: number }) {
  const stored = Number(read(key))
  return Number.isFinite(stored) && read(key) !== null ? clamp(stored, range) : fallback
}

export function readBlur(wallpaper: Wallpaper): number {
  return readNumber(BLUR_KEY, WALLPAPER_META[wallpaper].blur, BLUR_RANGE)
}

export function readOpacity(wallpaper: Wallpaper): number {
  return readNumber(OPACITY_KEY, WALLPAPER_META[wallpaper].opacity, OPACITY_RANGE)
}

/**
 * Mirror the choice onto <html>, which is what every themed CSS rule keys off.
 * Kept in one place so the pre-paint inline script in index.html and the React
 * provider can't drift apart.
 */
export function applyAppearance(
  theme: Theme,
  wallpaper: Wallpaper,
  blur: number,
  opacity: number,
): void {
  const root = document.documentElement
  THEMES.forEach((name) => root.classList.toggle(name, name === theme))
  // Independent of theme — a wallpaper now shows under light/dark too, not
  // just intern, so switching backgrounds never has to hijack the theme.
  root.dataset.wallpaper = wallpaper
  root.style.setProperty('--wp-blur', `${clamp(blur, BLUR_RANGE)}px`)
  // The scrim is what dims the image, so it's the inverse of image opacity.
  root.style.setProperty(
    '--wp-dim',
    String(1 - clamp(opacity, OPACITY_RANGE) / 100),
  )
}

export function persistThemeMode(mode: ThemeMode): void {
  write(THEME_KEY, mode)
}

export function persistWallpaper(wallpaper: Wallpaper): void {
  write(WALLPAPER_KEY, wallpaper)
}

export function persistBlur(blur: number): void {
  write(BLUR_KEY, String(clamp(blur, BLUR_RANGE)))
}

export function persistOpacity(opacity: number): void {
  write(OPACITY_KEY, String(clamp(opacity, OPACITY_RANGE)))
}

const PRESET_KEY = 'presetTheme'
const FONT_KEY = 'fontFamily'

export const DEFAULT_PRESET = 'none'
export const DEFAULT_FONT = 'system'

export function readPreset(): string {
  return read(PRESET_KEY) ?? DEFAULT_PRESET
}

export function persistPreset(id: string): void {
  write(PRESET_KEY, id)
}

export function readFont(): string {
  return read(FONT_KEY) ?? DEFAULT_FONT
}

export function persistFont(id: string): void {
  write(FONT_KEY, id)
}
