/**
 * Remembers the query string a list page was last showing (FR-NAV-01/02).
 *
 * Opening a contact from the bubble view and coming back should land on the
 * bubble view with the same filters — not a reset to the default card list.
 * The URL is the source of truth; this only records which URL to return to.
 *
 * sessionStorage rather than module state so it survives a reload, and rather
 * than localStorage so a new tab starts clean.
 */

const PREFIX = 'listState:'

export type ListKey = 'network' | 'applications' | 'todos' | 'catchups'

export function rememberList(key: ListKey, search: string): void {
  try {
    sessionStorage.setItem(`${PREFIX}${key}`, search)
  } catch {
    // Private mode — the back link just falls back to the bare path.
  }
}

function readSearch(key: ListKey): string {
  try {
    return sessionStorage.getItem(`${PREFIX}${key}`) ?? ''
  } catch {
    return ''
  }
}

export function listPath(key: ListKey): string {
  return `/${key}${readSearch(key)}`
}
