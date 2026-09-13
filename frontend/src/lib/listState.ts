/**
 * Remembers the query string a list page was last showing.
 *
 * Opening a contact from a filtered view and coming back — or leaving Todos
 * for the dashboard and returning via the sidebar — should land on the same
 * filters / sort / view, not a reset to defaults. The URL is the source of
 * truth while you're on the page; this only records which URL to return to.
 *
 * sessionStorage rather than module state so it survives a reload, and rather
 * than localStorage so a new tab starts clean.
 */

const PREFIX = 'listState:'
const VIEW_PREFIX = 'viewState:'

export type ListKey =
  | 'network'
  | 'applications'
  | 'todos'
  | 'catchups'
  | 'calendar'
  | 'job-directory'
  | 'files'
  | 'dashboard'

const PATHS: Record<ListKey, string> = {
  network: '/network',
  applications: '/applications',
  todos: '/todos',
  catchups: '/catchups',
  calendar: '/calendar',
  'job-directory': '/job-directory',
  files: '/files',
  dashboard: '/',
}

/** Map a nav/path prefix to the list key that remembers its filters. */
export function listKeyForPath(pathname: string): ListKey | null {
  if (pathname === '/' || pathname === '') return 'dashboard'
  if (pathname.startsWith('/applications')) return 'applications'
  if (pathname.startsWith('/network')) return 'network'
  if (pathname.startsWith('/todos')) return 'todos'
  if (pathname.startsWith('/catchups')) return 'catchups'
  if (pathname.startsWith('/calendar')) return 'calendar'
  if (pathname.startsWith('/job-directory')) return 'job-directory'
  if (pathname.startsWith('/files') || pathname.startsWith('/resumes')) return 'files'
  return null
}

export function rememberList(key: ListKey, search: string): void {
  try {
    const normalized = search && !search.startsWith('?') ? `?${search}` : search
    sessionStorage.setItem(`${PREFIX}${key}`, normalized || '')
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
  return `${PATHS[key]}${readSearch(key)}`
}

/** Extra UI state that doesn't fit cleanly in the URL (Job Directory tabs,
    resume archive toggle, dashboard period, …). */
export function rememberViewState(key: string, state: unknown): void {
  try {
    sessionStorage.setItem(`${VIEW_PREFIX}${key}`, JSON.stringify(state))
  } catch {
    /* ignore */
  }
}

export function readViewState<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(`${VIEW_PREFIX}${key}`)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}
