/**
 * A country's flag, from its English name.
 *
 * The catalog stores countries by name only, so the ISO code has to be
 * recovered before a flag can be drawn. Rather than hand-maintaining a
 * name→code table that drifts, the browser's own region names are walked
 * once — every two-letter code it recognises is asked for its display name,
 * and the result is indexed backwards. That covers every country the
 * platform knows, in the same spellings it would show elsewhere.
 *
 * Built lazily on first use: 676 lookups is nothing, but there's no reason
 * to spend it before a flag is actually wanted.
 */

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

let index: Map<string, string> | null = null

function normalise(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

function codesByName(): Map<string, string> {
  if (index) return index
  const map = new Map<string, string>()
  try {
    const names = new Intl.DisplayNames(['en'], { type: 'region' })
    for (const first of LETTERS) {
      for (const second of LETTERS) {
        const code = `${first}${second}`
        const name = names.of(code)
        // An unassigned code comes back as the code itself.
        if (name && name !== code) map.set(normalise(name), code)
      }
    }
  } catch {
    // No Intl.DisplayNames — every lookup just misses and callers fall back.
  }
  index = map
  return map
}

/** Extra spellings people actually type, mapped to the platform's own. */
const ALIASES: Record<string, string> = {
  uk: 'GB',
  'united kingdom': 'GB',
  usa: 'US',
  'united states of america': 'US',
  'south korea': 'KR',
  'north korea': 'KP',
  uae: 'AE',
  'hong kong sar': 'HK',
  'china - hong kong s.a.r.': 'HK',
  vietnam: 'VN',
  russia: 'RU',
  czechia: 'CZ',
  'czech republic': 'CZ',
}

/** ISO 3166-1 alpha-2 for a country name, or null when it isn't one. */
export function countryCode(name: string | null | undefined): string | null {
  if (!name) return null
  const key = normalise(name)
  return ALIASES[key] ?? codesByName().get(key) ?? null
}

/**
 * The flag emoji for a country name, or null.
 *
 * Flags are two regional-indicator letters — A becomes 🇦 and so on — which
 * every current platform renders as the flag. Returning null rather than a
 * placeholder lets the caller draw its own fallback mark.
 */
export function countryFlag(name: string | null | undefined): string | null {
  const code = countryCode(name)
  if (!code) return null
  return String.fromCodePoint(
    ...[...code].map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65),
  )
}
