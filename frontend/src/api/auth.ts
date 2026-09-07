import { api, setToken, clearToken, type AuthResponse, type User } from './client'

export type LoginPayload = {
  username: string
  password: string
}

export type RegisterPayload = {
  username: string
  email: string
  password: string
  password_confirm: string
  first_name?: string
  last_name?: string
}

export async function login(payload: LoginPayload): Promise<AuthResponse> {
  const data = await api<AuthResponse>('/auth/login/', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  setToken(data.token)
  return data
}

export async function register(payload: RegisterPayload): Promise<AuthResponse> {
  const data = await api<AuthResponse>('/auth/register/', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  setToken(data.token)
  return data
}

export async function logout(): Promise<void> {
  try {
    await api('/auth/logout/', { method: 'POST', auth: true })
  } finally {
    clearToken()
  }
}

export async function me(): Promise<User> {
  return api<User>('/auth/me/', { auth: true })
}
