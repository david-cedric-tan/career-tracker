export type User = {
  id: number
  username: string
  email: string
  first_name: string
  last_name: string
}

export type AuthResponse = {
  token: string
  user: User
}

export type ApiError = Record<string, string | string[]>

const TOKEN_KEY = 'authToken'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

type ApiOptions = RequestInit & { auth?: boolean }

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { auth = false, headers: initHeaders, ...rest } = options
  const headers = new Headers(initHeaders)

  if (!headers.has('Content-Type') && rest.body) {
    headers.set('Content-Type', 'application/json')
  }

  if (auth) {
    const token = getToken()
    if (token) headers.set('Authorization', `Token ${token}`)
  }

  const baseUrl = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000'
  const response = await fetch(`${baseUrl}${path}`, { ...rest, headers })

  if (response.status === 204) {
    return null as T
  }

  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw data as ApiError
  }

  return data as T
}

/** Flatten DRF error payloads into a single message for forms. */
export function formatApiError(error: unknown): string {
  if (!error || typeof error !== 'object') return 'Something went wrong.'
  const data = error as ApiError

  if (typeof data.detail === 'string') return data.detail
  if (Array.isArray(data.non_field_errors)) return data.non_field_errors.join(' ')

  const parts = Object.entries(data).flatMap(([field, value]) => {
    if (Array.isArray(value)) return value.map((msg) => `${field}: ${msg}`)
    if (typeof value === 'string') return [`${field}: ${value}`]
    return []
  })

  return parts.length ? parts.join(' ') : 'Something went wrong.'
}
