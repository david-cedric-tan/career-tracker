import { mix } from './colorMix'
import type { FontId } from './fonts'

/**
 * Named colour-scheme presets (FR-UI extension) — the "pick a theme like
 * Dracula / Nord / Gruvbox" gallery, in the spirit of VS Code / monkeytype's
 * theme pickers.
 *
 * Each entry only specifies a handful of seed colours; the rest of the app's
 * tokens (surfaces, borders, muted ink, brand-soft/ring) are *derived* from
 * those seeds at apply-time (see `deriveTokens`) rather than hand-authored —
 * hand-picking all ~16 tokens for a dozen themes would be a lot of surface
 * area to get visually consistent.
 *
 * Status colours (good/warning/critical/serious) are deliberately **not**
 * themed: they're a fixed, validated palette (see the dataviz skill) so a
 * status colour never gets reinterpreted as "just this theme's red".
 */
export type PresetSeed = {
  label: string
  /** Which base mode this preset's contrast was designed against — decides
      whether Tailwind's `dark:` utility classes activate alongside it. */
  base: 'light' | 'dark'
  page: string
  surface: string
  ink: string
  brand: string
  /** A second and third accent for charts — most themes ship 2-3 signature
      hues (Dracula's purple/pink/green, etc.); reuse them rather than
      inventing new ones. */
  series2: string
  series3: string
  /** Firms have a signature typeface too — noted here as a suggestion, not
      applied automatically. Picking a theme only changes colours; font is
      its own setting. */
  font?: FontId
}

export const PRESET_THEMES: Record<string, PresetSeed> = {
  dracula: {
    label: 'Dracula',
    base: 'dark',
    page: '#21222c',
    surface: '#282a36',
    ink: '#f8f8f2',
    brand: '#bd93f9',
    series2: '#ff79c6',
    series3: '#50fa7b',
  },
  nord: {
    label: 'Nord',
    base: 'dark',
    page: '#2e3440',
    surface: '#3b4252',
    ink: '#eceff4',
    brand: '#88c0d0',
    series2: '#b48ead',
    series3: '#a3be8c',
  },
  gruvboxDark: {
    label: 'Gruvbox Dark',
    base: 'dark',
    page: '#1d2021',
    surface: '#282828',
    ink: '#ebdbb2',
    brand: '#fe8019',
    series2: '#b8bb26',
    series3: '#83a598',
  },
  gruvboxLight: {
    label: 'Gruvbox Light',
    base: 'light',
    page: '#f2e5bc',
    surface: '#fbf1c7',
    ink: '#3c3836',
    brand: '#af3a03',
    series2: '#79740e',
    series3: '#076678',
  },
  solarizedDark: {
    label: 'Solarized Dark',
    base: 'dark',
    page: '#002b36',
    surface: '#073642',
    ink: '#eee8d5',
    brand: '#268bd2',
    series2: '#2aa198',
    series3: '#b58900',
  },
  solarizedLight: {
    label: 'Solarized Light',
    base: 'light',
    page: '#eee8d5',
    surface: '#fdf6e3',
    ink: '#073642',
    brand: '#268bd2',
    series2: '#2aa198',
    series3: '#cb4b16',
  },
  monokai: {
    label: 'Monokai',
    base: 'dark',
    page: '#1e1f1c',
    surface: '#272822',
    ink: '#f8f8f2',
    brand: '#a6e22e',
    series2: '#f92672',
    series3: '#66d9ef',
  },
  oneDark: {
    label: 'One Dark',
    base: 'dark',
    page: '#21252b',
    surface: '#282c34',
    ink: '#abb2bf',
    brand: '#61afef',
    series2: '#c678dd',
    series3: '#98c379',
  },
  tokyoNight: {
    label: 'Tokyo Night',
    base: 'dark',
    page: '#16161e',
    surface: '#1a1b26',
    ink: '#c0caf5',
    brand: '#7aa2f7',
    series2: '#bb9af7',
    series3: '#9ece6a',
  },
  catppuccinMocha: {
    label: 'Catppuccin Mocha',
    base: 'dark',
    page: '#181825',
    surface: '#1e1e2e',
    ink: '#cdd6f4',
    brand: '#cba6f7',
    series2: '#f5c2e7',
    series3: '#a6e3a1',
  },
  rosePineDawn: {
    label: 'Rosé Pine Dawn',
    base: 'light',
    page: '#faf4ed',
    surface: '#fffaf3',
    ink: '#575279',
    brand: '#d7827e',
    series2: '#907aa9',
    series3: '#286983',
  },
  everforest: {
    label: 'Everforest',
    base: 'dark',
    page: '#272e33',
    surface: '#2d353b',
    ink: '#d3c6aa',
    brand: '#a7c080',
    series2: '#dbbc7f',
    series3: '#7fbbb3',
  },
  rouge: {
    // VS Code "Rouge" (josef.rouge-theme) v2 palette — dusty-rose accent
    // over a navy-black surface.
    label: 'Rouge',
    base: 'dark',
    page: '#0e0e1a',
    surface: '#17182b',
    ink: '#e8e8ea',
    brand: '#c6797e',
    series2: '#1e6378',
    series3: '#ea9881',
  },
  rougeLight: {
    // The same dusty-rose accent read against paper instead of navy-black.
    // The brand red is taken several steps darker than the dark theme's
    // #c6797e, which would sit at roughly 2:1 against white — nowhere near
    // readable as text or a button fill.
    label: 'Rouge Light',
    base: 'light',
    page: '#f7f1f1',
    surface: '#fffcfc',
    ink: '#2b2430',
    brand: '#9b3b45',
    series2: '#1e6378',
    series3: '#c26a4e',
    font: 'timesNewRoman',
  },

  // ---------------------------------------------------------------- firms
  // Inspired by each company's public brand colours — a personal styling
  // reference, not their real product UI, and the fonts are the closest
  // widely-available stand-in for each firm's (usually unlicensed) corporate
  // typeface rather than the literal one.
  pwc: {
    label: 'PwC',
    base: 'light',
    page: '#faf7f5',
    surface: '#ffffff',
    ink: '#2d2d2d',
    brand: '#d04a02',
    series2: '#2a78d6',
    series3: '#1baf7a',
    font: 'workSans',
  },
  deloitte: {
    label: 'Deloitte',
    base: 'light',
    page: '#f6f8f4',
    surface: '#ffffff',
    ink: '#1c1c1c',
    brand: '#86bc25',
    series2: '#00a3e0',
    series3: '#0076a8',
    font: 'openSans',
  },
  ey: {
    label: 'EY',
    base: 'dark',
    page: '#151515',
    surface: '#1e1e1e',
    ink: '#f2f2f2',
    brand: '#ffe600',
    series2: '#4da8da',
    series3: '#f2c94c',
    font: 'roboto',
  },
  canva: {
    label: 'Canva',
    base: 'light',
    page: '#f7f5fb',
    surface: '#ffffff',
    ink: '#25113d',
    brand: '#7d2ae8',
    series2: '#00c4cc',
    series3: '#ff6f91',
    font: 'poppins',
  },
}

export type PresetId = keyof typeof PRESET_THEMES | 'none'
export const PRESET_ORDER = Object.keys(PRESET_THEMES) as (keyof typeof PRESET_THEMES)[]

/** Derive the full token set this app's CSS reads from a preset's seed
    colours. Kept separate from the seed data so the seeds stay short. */
function deriveTokens(seed: PresetSeed) {
  const { page, surface, ink, brand } = seed
  return {
    '--color-page': page,
    '--color-surface': surface,
    '--color-surface-2': mix(surface, ink, 0.07),
    '--color-line': mix(surface, ink, 0.16),
    '--color-line-strong': mix(surface, ink, 0.28),
    '--color-ink': ink,
    '--color-ink-2': mix(ink, surface, 0.32),
    '--color-ink-3': mix(ink, surface, 0.52),
    '--color-brand': brand,
    '--color-brand-strong': mix(brand, ink, 0.18),
    '--color-brand-soft': mix(brand, surface, 0.85),
    '--color-brand-ring': mix(brand, surface, 0.5),
    '--series-1': brand,
    '--series-2': seed.series2,
    '--series-3': seed.series3,
  }
}

const OVERRIDE_PROPERTIES = [
  '--color-page',
  '--color-surface',
  '--color-surface-2',
  '--color-line',
  '--color-line-strong',
  '--color-ink',
  '--color-ink-2',
  '--color-ink-3',
  '--color-brand',
  '--color-brand-strong',
  '--color-brand-soft',
  '--color-brand-ring',
  '--series-1',
  '--series-2',
  '--series-3',
]

/**
 * Apply a preset by setting inline custom properties on <html> — inline
 * style outranks the class-based rules in index.css regardless of which of
 * light/dark/intern is also active, which is what lets "pick a preset" work
 * as a clean override rather than a fourth parallel theme system.
 */
export function applyPreset(id: PresetId): void {
  const root = document.documentElement
  if (id === 'none' || !(id in PRESET_THEMES)) {
    OVERRIDE_PROPERTIES.forEach((prop) => root.style.removeProperty(prop))
    delete root.dataset.preset
    return
  }

  const seed = PRESET_THEMES[id]
  const tokens = deriveTokens(seed)
  for (const [prop, value] of Object.entries(tokens)) {
    root.style.setProperty(prop, value)
  }
  // Tailwind's `dark:` utility classes should still activate for a dark
  // preset even though the *base* theme mode might be 'light'.
  root.classList.toggle('dark', seed.base === 'dark')
  root.dataset.preset = id
}
