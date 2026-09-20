export type ApiError = Record<string, string | string[] | undefined> & {
  /** HTTP status, attached so the UI can say something useful even when the
      body carried no message of its own (a 500's HTML page, say). */
  status?: number
}

const TOKEN_KEY = 'authToken'

// sessionStorage, not localStorage: a DRF token never expires on its own, so
// localStorage meant closing the browser without signing out still left you
// signed in indefinitely on next launch — the token was still sitting there
// and bootstrap() in AuthContext would happily re-use it. sessionStorage is
// cleared when the browser (not just the tab) actually closes, so a real
// "close and reopen" always lands back on the login screen; a page reload or
// a duplicated tab still carries the session, since sessionStorage survives
// both. Same reasoning already used for list-view state (see lib/listState.ts).
export function getToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(token: string): void {
  try {
    sessionStorage.setItem(TOKEN_KEY, token)
  } catch {
    /* private mode — the token simply won't survive a reload */
  }
}

export function clearToken(): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY)
  } catch {
    /* nothing to clear */
  }
}

const BASE_URL = `${import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000'}/api`

type ApiOptions = Omit<RequestInit, 'body'> & {
  /** Skip the Authorization header (login/register only). */
  anonymous?: boolean
  body?: unknown
  /** Appended as a query string; null/undefined/'' entries are dropped. */
  params?: Record<string, string | number | boolean | string[] | null | undefined>
}

/** Listeners fired when the server rejects our token, so the app can log out. */
const unauthorizedHandlers = new Set<() => void>()

export function onUnauthorized(handler: () => void): () => void {
  unauthorizedHandlers.add(handler)
  return () => unauthorizedHandlers.delete(handler)
}

function buildQuery(params: ApiOptions['params']): string {
  if (!params) return ''
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '') continue
    if (Array.isArray(value)) {
      value.filter(Boolean).forEach((entry) => search.append(key, entry))
    } else {
      search.append(key, String(value))
    }
  }
  const query = search.toString()
  return query ? `?${query}` : ''
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { anonymous = false, body, params, headers: initHeaders, ...rest } = options
  const headers = new Headers(initHeaders)

  // FormData carries its own multipart boundary — setting Content-Type by hand
  // would strip it and the upload would arrive unparseable.
  const isMultipart = body instanceof FormData
  if (body !== undefined && !isMultipart && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  if (!anonymous) {
    const token = getToken()
    if (token) headers.set('Authorization', `Token ${token}`)
  }

  const response = await fetch(`${BASE_URL}${path}${buildQuery(params)}`, {
    ...rest,
    headers,
    body:
      body === undefined
        ? undefined
        : isMultipart
          ? (body as FormData)
          : JSON.stringify(body),
  })

  if (response.status === 401 && !anonymous) {
    clearToken()
    unauthorizedHandlers.forEach((handler) => handler())
  }

  if (response.status === 204) return null as T

  // Read as text first: an error response isn't always JSON (a 500 comes back
  // as Django's HTML page, a proxy may return plain text). Parsing straight to
  // JSON and swallowing the failure threw all of that away, leaving the UI
  // with an empty object and nothing to say but "Something went wrong."
  const raw = await response.text()
  let data: unknown = null
  if (raw) {
    try {
      data = JSON.parse(raw)
    } catch {
      data = null
    }
  }

  if (!response.ok) {
    const hasDetail = data && typeof data === 'object' && Object.keys(data).length > 0
    throw {
      ...(hasDetail ? (data as object) : { detail: httpFallback(response.status) }),
      status: response.status,
    } as ApiError
  }
  return data as T
}

/** What to say when the server gave us no usable message of its own. */
const HTTP_FALLBACKS: Record<number, string> = {
  400: 'The server rejected that request.',
  403: "You don't have permission to do that.",
  404: 'That item no longer exists — it may have been deleted already.',
  409: 'That conflicts with something already saved.',
  413: 'That file is too large to upload.',
  500: 'The server hit an unexpected error, so nothing was saved.',
  502: 'Could not reach the server.',
  503: 'The server is temporarily unavailable — try again in a moment.',
  504: 'The server took too long to respond.',
}

function httpFallback(status: number): string {
  const known = HTTP_FALLBACKS[status]
  return known
    ? `${known} (HTTP ${status})`
    : `The server returned an unexpected response (HTTP ${status}).`
}

const FIELD_LABELS: Record<string, string> = {
  non_field_errors: '',
  detail: '',
  password_confirm: 'Confirm password',
  full_name: 'Name',
  job_listing: 'Job listing',
  listing_ids: 'Roles',
  next_chat_at: 'Next chat',
  last_meeting_at: 'Last meeting',
  applied_at: 'Applied on',
  follow_up_date: 'Follow-up',
  due_date: 'Due date',
  due_time: 'Due time',
  due_end_time: 'End time',
  closing_at: 'Closing date',
  opened_at: 'Opening date',
  job_url: 'Job URL',
  variant_type: 'Variant',
}

function label(field: string): string {
  if (field in FIELD_LABELS) return FIELD_LABELS[field]
  return field.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
}

/** Flatten a DRF error payload into one sentence for a form banner. */
export function formatApiError(error: unknown): string {
  if (!error) return 'Something went wrong.'
  if (error instanceof TypeError) {
    return 'Could not reach the server. Is the backend running?'
  }
  if (typeof error === 'string') return error
  if (typeof error !== 'object') return 'Something went wrong.'

  const parts: string[] = []
  const walk = (value: unknown, field: string) => {
    if (typeof value === 'string') {
      const name = label(field)
      parts.push(name ? `${name}: ${value}` : value)
    } else if (Array.isArray(value)) {
      value.forEach((entry) => walk(entry, field))
    } else if (value && typeof value === 'object') {
      Object.entries(value).forEach(([key, entry]) => walk(entry, key))
    }
  }
  Object.entries(error as Record<string, unknown>).forEach(([key, value]) => {
    // Carried for context, not for display — it's already folded into the
    // fallback sentence when the server gave us nothing else.
    if (key === 'status') return
    walk(value, key)
  })

  if (parts.length) return parts.join(' ')

  const status = (error as { status?: unknown }).status
  return typeof status === 'number' ? httpFallback(status) : 'Something went wrong.'
}

/** Per-field messages, for inline errors under inputs. */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!error || typeof error !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(error as Record<string, unknown>)) {
    if (typeof value === 'string') out[key] = value
    else if (Array.isArray(value) && typeof value[0] === 'string') out[key] = value[0]
  }
  return out
}
