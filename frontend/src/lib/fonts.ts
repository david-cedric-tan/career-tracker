/**
 * Site-wide font family picker, in the spirit of monkeytype's font list — a
 * curated subset (not their full ~90) covering system, monospace, sans and
 * serif options, applied via one CSS variable so every component that reads
 * `--font-app` picks it up without per-component changes.
 */
export type FontOption = {
  label: string
  /** The CSS `font-family` value, including its own fallback stack. */
  family: string
  /** The name to request from Google Fonts, or null for a system font that
      needs no network fetch. */
  googleFont: string | null
  mono?: boolean
}

export const FONTS: Record<string, FontOption> = {
  system: {
    label: 'System UI',
    family: `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`,
    googleFont: null,
  },
  georgia: {
    label: 'Georgia',
    family: `Georgia, "Times New Roman", serif`,
    googleFont: null,
  },
  helvetica: {
    label: 'Helvetica',
    family: `Helvetica, Arial, sans-serif`,
    googleFont: null,
  },
  courier: {
    label: 'Courier',
    family: `Courier, "Courier New", monospace`,
    googleFont: null,
    mono: true,
  },
  inter: {
    label: 'Inter',
    family: `"Inter", system-ui, sans-serif`,
    googleFont: 'Inter:wght@400;500;600;700',
  },
  roboto: {
    label: 'Roboto',
    family: `"Roboto", system-ui, sans-serif`,
    googleFont: 'Roboto:wght@400;500;700',
  },
  nunito: {
    label: 'Nunito',
    family: `"Nunito", system-ui, sans-serif`,
    googleFont: 'Nunito:wght@400;600;700',
  },
  montserrat: {
    label: 'Montserrat',
    family: `"Montserrat", system-ui, sans-serif`,
    googleFont: 'Montserrat:wght@400;600;700',
  },
  lato: {
    label: 'Lato',
    family: `"Lato", system-ui, sans-serif`,
    googleFont: 'Lato:wght@400;700',
  },
  openSans: {
    label: 'Open Sans',
    family: `"Open Sans", system-ui, sans-serif`,
    googleFont: 'Open+Sans:wght@400;600;700',
  },
  poppins: {
    label: 'Poppins',
    family: `"Poppins", system-ui, sans-serif`,
    googleFont: 'Poppins:wght@400;500;600;700',
  },
  workSans: {
    label: 'Work Sans',
    family: `"Work Sans", system-ui, sans-serif`,
    googleFont: 'Work+Sans:wght@400;500;600;700',
  },
  spaceGrotesk: {
    label: 'Space Grotesk',
    family: `"Space Grotesk", system-ui, sans-serif`,
    googleFont: 'Space+Grotesk:wght@400;500;600;700',
  },
  lexend: {
    label: 'Lexend',
    family: `"Lexend", system-ui, sans-serif`,
    googleFont: 'Lexend:wght@400;500;600;700',
  },
  firaCode: {
    label: 'Fira Code',
    family: `"Fira Code", ui-monospace, monospace`,
    googleFont: 'Fira+Code:wght@400;500;600',
    mono: true,
  },
  jetBrainsMono: {
    label: 'JetBrains Mono',
    family: `"JetBrains Mono", ui-monospace, monospace`,
    googleFont: 'JetBrains+Mono:wght@400;500;700',
    mono: true,
  },
  sourceCodePro: {
    label: 'Source Code Pro',
    family: `"Source Code Pro", ui-monospace, monospace`,
    googleFont: 'Source+Code+Pro:wght@400;500;700',
    mono: true,
  },
  ibmPlexMono: {
    label: 'IBM Plex Mono',
    family: `"IBM Plex Mono", ui-monospace, monospace`,
    googleFont: 'IBM+Plex+Mono:wght@400;500;600',
    mono: true,
  },
  spaceMono: {
    label: 'Space Mono',
    family: `"Space Mono", ui-monospace, monospace`,
    googleFont: 'Space+Mono:wght@400;700',
    mono: true,
  },
  robotoMono: {
    label: 'Roboto Mono',
    family: `"Roboto Mono", ui-monospace, monospace`,
    googleFont: 'Roboto+Mono:wght@400;500;700',
    mono: true,
  },
  inconsolata: {
    label: 'Inconsolata',
    family: `"Inconsolata", ui-monospace, monospace`,
    googleFont: 'Inconsolata:wght@400;500;700',
    mono: true,
  },
  merriweather: {
    label: 'Merriweather',
    family: `"Merriweather", Georgia, serif`,
    googleFont: 'Merriweather:wght@400;700',
  },
  playfairDisplay: {
    label: 'Playfair Display',
    family: `"Playfair Display", Georgia, serif`,
    googleFont: 'Playfair+Display:wght@400;600;700',
  },
}

export const FONT_ORDER = Object.keys(FONTS) as (keyof typeof FONTS)[]
export type FontId = keyof typeof FONTS

const LINK_ID = 'app-google-font'

/**
 * Set the site-wide font. Loads the Google Fonts stylesheet on demand (never
 * for a system font, which needs no network round trip) and points
 * `--font-app` at the chosen stack.
 */
export function applyFont(id: FontId): void {
  const option = FONTS[id] ?? FONTS.system
  document.documentElement.style.setProperty('--font-app', option.family)

  const existing = document.getElementById(LINK_ID) as HTMLLinkElement | null
  if (!option.googleFont) {
    existing?.remove()
    return
  }

  const href = `https://fonts.googleapis.com/css2?family=${option.googleFont}&display=swap`
  if (existing) {
    if (existing.href !== href) existing.href = href
    return
  }
  const link = document.createElement('link')
  link.id = LINK_ID
  link.rel = 'stylesheet'
  link.href = href
  document.head.appendChild(link)
}
