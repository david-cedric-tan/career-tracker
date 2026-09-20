/**
 * The console's own light/dark switch — independent of the tracker's theme
 * (lib/appearance.ts). Operators may not be the same person as the account
 * they're signed in as, so this never reads or writes the app's theme keys.
 */
const KEY = 'console-theme'
export type ConsoleTheme = 'light' | 'dark'

export function defaultConsoleTheme(): ConsoleTheme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function readConsoleTheme(): ConsoleTheme {
  try {
    const stored = localStorage.getItem(KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    // Private mode / blocked site data — fall back to system preference.
  }
  return defaultConsoleTheme()
}

export function persistConsoleTheme(theme: ConsoleTheme): void {
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    // The screen still switches; the choice just won't survive a reload.
  }
}
