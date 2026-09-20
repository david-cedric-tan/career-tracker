/** The admin console (superuser only) — see backend/console. */
import { api } from './client'

const BASE = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000'

export type ConsoleSectionTable = { model: string; name: string; rows: number }
export type ConsoleSection = {
  key: string
  label: string
  description: string
  rows: number
  files: number
  tables: ConsoleSectionTable[]
}

export type ConsoleOverview = {
  server_time: string
  uptime_seconds: number
  revision: string | null
  python: string
  django: string
  platform: string
  hostname: string
  pid: number
  database: { engine: string; name: string; vendor: string; bytes: number | null; host?: string }
  media: { path: string; files: number; bytes: number }
  settings: Record<string, string | boolean | string[]>
  totals: Record<string, number>
  sections: ConsoleSection[]
}

export type ConsoleAccount = {
  id: number
  username: string
  first_name: string
  last_name: string
  email: string
  is_active: boolean
  is_staff: boolean
  is_superuser: boolean
  is_developer: boolean
  onboarding_completed: boolean
  date_joined: string | null
  last_login: string | null
  counts: Record<string, number>
  /** When this account asked the operator for a new password, or null. */
  password_reset_requested_at: string | null
}

export type PasswordResetQueueRow = {
  id: number
  user_id: number
  username: string
  email: string
  message: string
  created_at: string
}

export type ConsoleTicket = {
  id: number
  user: string
  user_id: number
  kind: string
  status: string
  page: string
  screens: string[]
  body: string
  resolution: string
  resolved_by: string | null
  resolved_at: string | null
  created_at: string | null
  updated_at: string | null
  message_count: number
  event_count: number
  messages?: { id: number; author: string | null; body: string; image: string | null; created_at: string | null }[]
  events?: { id: number; event_type: string; detail: string; actor: string | null; created_at: string | null }[]
}

export type ConsoleActivity = {
  type: 'event' | 'message'
  ticket: number
  user: string
  created_at: string | null
  actor?: string | null
  author?: string | null
  event_type?: string
  detail?: string
  body?: string
}

export type MigrationPreview = {
  dry_run: boolean
  created_at: string | null
  sections: string[]
  users: number[] | 'all'
  models: string[]
  counts: Record<string, number>
  object_count: number
  file_count: number
  files_copied?: number
  signed_out?: boolean
}

export const consoleApi = {
  overview: () => api<ConsoleOverview>('/console/overview/'),
  accounts: () => api<ConsoleAccount[]>('/console/accounts/'),
  passwordResets: () => api<PasswordResetQueueRow[]>('/console/password-resets/'),
  createAccount: (body: {
    username: string
    password: string
    email?: string
    first_name?: string
    last_name?: string
    is_developer?: boolean
    is_superuser?: boolean
  }) => api<ConsoleAccount>('/console/accounts/', { method: 'POST', body }),
  updateAccount: (id: number, body: Partial<ConsoleAccount> & { password?: string }) =>
    api<ConsoleAccount>(`/console/accounts/${id}/`, { method: 'PATCH', body }),
  deleteAccount: (id: number, confirm: string) =>
    api<null>(`/console/accounts/${id}/`, { method: 'DELETE', body: { confirm } }),
  sections: (users: number[] | null) =>
    api<{ sections: ConsoleSection[] }>('/console/migration/sections/', {
      params: { users: users ? users.join(',') : 'all' },
    }),
  exportUrl: (options: { sections: string[] | null; users: number[] | null; media: boolean }) => {
    const query = new URLSearchParams()
    if (options.sections) query.set('sections', options.sections.join(','))
    if (options.users) query.set('users', options.users.join(','))
    query.set('media', options.media ? '1' : '0')
    return `${BASE}/api/console/migration/export.zip?${query}`
  },
  importArchive: (file: File, options: { dryRun: boolean; confirm?: string }) => {
    const body = new FormData()
    body.append('file', file)
    if (options.dryRun) body.append('dry_run', '1')
    if (options.confirm) body.append('confirm', options.confirm)
    return api<MigrationPreview>('/console/migration/import/', { method: 'POST', body })
  },
  refinements: (params?: { status?: string; user?: number }) =>
    api<ConsoleTicket[]>('/console/refinements/', { params }),
  refinement: (id: number) => api<ConsoleTicket>(`/console/refinements/${id}/`),
  activity: (limit = 40) => api<ConsoleActivity[]>('/console/activity/', { params: { limit } }),
}
