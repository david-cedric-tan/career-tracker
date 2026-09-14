import { api, clearToken, setToken } from './client'
import type { AuthResponse, User } from './types'

export type LoginPayload = { username: string; password: string }

export type RegisterPayload = {
  username: string
  email: string
  password: string
  password_confirm: string
  first_name: string
  last_name: string
  mobile_number: string
  linkedin_url: string
  school_email?: string
}

export async function login(payload: LoginPayload): Promise<AuthResponse> {
  const data = await api<AuthResponse>('/auth/login/', {
    method: 'POST',
    body: payload,
    anonymous: true,
  })
  setToken(data.token)
  return data
}

export async function register(payload: RegisterPayload): Promise<AuthResponse> {
  const data = await api<AuthResponse>('/auth/register/', {
    method: 'POST',
    body: payload,
    anonymous: true,
  })
  setToken(data.token)
  return data
}

export async function logout(): Promise<void> {
  try {
    await api('/auth/logout/', { method: 'POST' })
  } finally {
    clearToken()
  }
}

export function me(): Promise<User> {
  return api<User>('/auth/me/')
}

export function updateProfile(payload: Partial<User>): Promise<User> {
  return api<User>('/auth/me/', { method: 'PATCH', body: payload })
}

export function uploadAvatar(file: File): Promise<User> {
  const body = new FormData()
  body.append('avatar', file)
  return api<User>('/auth/me/avatar/', { method: 'POST', body })
}

export function removeAvatar(): Promise<User> {
  return api<User>('/auth/me/avatar/', { method: 'DELETE' })
}

export function uploadWallpaper(file: File): Promise<User> {
  const body = new FormData()
  body.append('wallpaper', file)
  return api<User>('/auth/me/wallpaper/', { method: 'POST', body })
}

export function removeWallpaper(): Promise<User> {
  return api<User>('/auth/me/wallpaper/', { method: 'DELETE' })
}

export function uploadPinnedPhoto(file: Blob, caption = ''): Promise<User> {
  const body = new FormData()
  body.append('photo', file, file instanceof File ? file.name : 'pinned.jpg')
  if (caption) body.append('caption', caption)
  return api<User>('/auth/me/pinned-photo/', { method: 'POST', body })
}

export function removePinnedPhoto(): Promise<User> {
  return api<User>('/auth/me/pinned-photo/', { method: 'DELETE' })
}

/** Clears everything the account tracks; the account itself survives.
    `confirm` is required server-side so this can't fire on a stray POST. */
export function deleteAllData(): Promise<{ deleted: Record<string, number> }> {
  return api<{ deleted: Record<string, number> }>('/auth/me/delete-data/', {
    method: 'POST',
    body: { confirm: true },
  })
}
