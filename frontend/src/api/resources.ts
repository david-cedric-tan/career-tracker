import { api } from './client'
import type {
  Application,
  ApplicationStage,
  CompanyNote,
  HistoricalMove,
  JobListingImportRow,
  JobListingImportResult,
  Mention,
  MetSourceTag,
  RelationshipTag,
  CalendarEventInput,
  CalendarEventRecord,
  CalendarResponse,
  Catchup,
  CatchupChoices,
  Certification,
  CompanyStat,
  Education,
  Experience,
  ExtraCurricular,
  ProfileAddress,
  ProfileLink,
  ApplicationChoices,
  ApplicationListingLink,
  ApplicationSummary,
  Attention,
  Company,
  Country,
  DashboardSummary,
  EventLog,
  Industry,
  JobListing,
  Location,
  NetworkChoices,
  Person,
  RegionStat,
  Resume,
  Role,
  SampleDataGroup,
  State,
  Timeseries,
  ActivityItem,
  Todo,
  TodoChoices,
  TodoSuggestion,
  Venue,
} from './types'

type Query = Record<string, string | number | boolean | string[] | null | undefined>

/** The five list/CRUD calls every DRF ModelViewSet exposes. */
function crud<T, Payload = Partial<T>>(path: string) {
  return {
    list: (params?: Query) => api<T[]>(`/${path}/`, { params }),
    get: (id: number) => api<T>(`/${path}/${id}/`),
    create: (body: Payload) => api<T>(`/${path}/`, { method: 'POST', body }),
    update: (id: number, body: Payload) =>
      api<T>(`/${path}/${id}/`, { method: 'PATCH', body }),
    remove: (id: number) => api<void>(`/${path}/${id}/`, { method: 'DELETE' }),
  }
}

/** A CRUD resource whose rows carry a generic file+caption attachment list. */
function sectionWithAttachments<T extends { id: number }>(path: string) {
  return {
    ...crud<T>(`auth/${path}`),
    addAttachment: (id: number, file: File, caption: string) => {
      const body = new FormData()
      body.append('file', file)
      if (caption) body.append('caption', caption)
      return api<T>(`/auth/${path}/${id}/attachments/`, { method: 'POST', body })
    },
    removeAttachment: (id: number, attachmentId: number) =>
      api<T>(`/auth/${path}/${id}/attachments/${attachmentId}/`, { method: 'DELETE' }),
  }
}

/** Catalogs add `ensure` — get-or-create by name, so pickers can create inline. */
function catalog<T extends { id: number; name: string }>(path: string) {
  return {
    ...crud<T>(path),
    ensure: (body: Record<string, unknown>) =>
      api<T>(`/${path}/ensure/`, { method: 'POST', body }),
  }
}

export const companies = {
  ...catalog<Company>('companies'),
  uploadLogo: (id: number, file: File) => {
    const body = new FormData()
    body.append('logo', file)
    return api<Company>(`/companies/${id}/logo/`, { method: 'POST', body })
  },
  removeLogo: (id: number) => api<Company>(`/companies/${id}/logo/`, { method: 'DELETE' }),
  getNote: (id: number) => api<CompanyNote>(`/companies/${id}/note/`),
  setNote: (id: number, notes: string) =>
    api<CompanyNote>(`/companies/${id}/note/`, { method: 'PUT', body: { notes } }),
}
export const roles = catalog<Role>('roles')
export const applicationStages = catalog<ApplicationStage>('application-stages')
export const industries = catalog<Industry>('industries')
export const relationships = catalog<RelationshipTag>('relationships')
export const metSources = catalog<MetSourceTag>('met-sources')
export const countries = catalog<Country>('countries')
export const states = catalog<State>('states')
export const locations = catalog<Location>('locations')
export const venues = catalog<Venue>('venues')

export const resumes = {
  ...crud<Resume>('resumes'),
  uploadFile: (id: number, file: File) => {
    const body = new FormData()
    body.append('file', file)
    return api<Resume>(`/resumes/${id}/file/`, { method: 'POST', body })
  },
  removeFile: (id: number) => api<Resume>(`/resumes/${id}/file/`, { method: 'DELETE' }),
}
export const jobListings = {
  ...crud<JobListing>('job-listings'),
  import: (rows: JobListingImportRow[]) =>
    api<{ results: JobListingImportResult[] }>('/job-listings/import_listings/', {
      method: 'POST',
      body: { listings: rows },
    }),
}

export const applications = {
  ...crud<Application>('applications'),
  list: (params?: Query) => api<ApplicationSummary[]>('/applications/', { params }),
  choices: () => api<ApplicationChoices>('/applications/choices/'),
  events: (id: number) => api<EventLog[]>(`/applications/${id}/events/`),
  addListing: (id: number, jobListing: number) =>
    api<ApplicationListingLink>(`/applications/${id}/listings/`, {
      method: 'POST',
      body: { job_listing: jobListing },
    }),
  advance: (id: number, body: { stage?: string; outcome?: string; note?: string }) =>
    api<Application>(`/applications/${id}/advance/`, { method: 'POST', body }),
  backfill: (id: number, moves: HistoricalMove[]) =>
    api<Application>(`/applications/${id}/backfill/`, { method: 'POST', body: { moves } }),
}

export const applicationListings = crud<ApplicationListingLink>('application-job-listings')

export const people = {
  ...crud<Person>('people'),
  choices: () => api<NetworkChoices>('/people/choices/'),
  logMeeting: (id: number, body: { met_on?: string; next_chat_at?: string }) =>
    api<Person>(`/people/${id}/log-meeting/`, { method: 'POST', body }),
  uploadPhoto: (id: number, file: File) => {
    const body = new FormData()
    body.append('photo', file)
    return api<Person>(`/people/${id}/photo/`, { method: 'POST', body })
  },
  removePhoto: (id: number) =>
    api<Person>(`/people/${id}/photo/`, { method: 'DELETE' }),
}

export const todos = {
  ...crud<Todo>('todos'),
  choices: () => api<TodoChoices>('/todos/choices/'),
  toggle: (id: number) => api<Todo>(`/todos/${id}/toggle/`, { method: 'POST' }),
  suggestions: () => api<TodoSuggestion[]>('/todos/suggestions/'),
  reorder: (ids: number[]) =>
    api<{ ids: number[] }>('/todos/reorder/', { method: 'POST', body: { ids } }),
}

export const catchups = {
  ...crud<Catchup>('catchups'),
  choices: () => api<CatchupChoices>('/catchups/choices/'),
}

export const calendarEvents = crud<CalendarEventRecord, CalendarEventInput>('events')

export const experiences = {
  ...crud<Experience>('auth/experiences'),
  addPhoto: (id: number, file: File, caption: string) => {
    const body = new FormData()
    body.append('image', file)
    if (caption) body.append('caption', caption)
    return api<Experience>(`/auth/experiences/${id}/photos/`, { method: 'POST', body })
  },
  removePhoto: (id: number, photoId: number) =>
    api<Experience>(`/auth/experiences/${id}/photos/${photoId}/`, { method: 'DELETE' }),
}

export const education = sectionWithAttachments<Education>('education')
export const certifications = sectionWithAttachments<Certification>('certifications')
export const extracurriculars = sectionWithAttachments<ExtraCurricular>('extracurriculars')
export const profileLinks = crud<ProfileLink>('auth/links')
export const profileAddresses = crud<ProfileAddress>('auth/addresses')

export type BackupCounts = Record<string, number>
export type BackupFormat = 'json' | 'xlsx' | 'zip'

export const backup = {
  summary: () =>
    api<{ version: number; counts: BackupCounts; file_count: number }>('/backup/summary/'),
  /** Downloads bypass `api()` — the response is a file, not JSON. */
  downloadUrl: (format: BackupFormat) =>
    `${import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000'}/api/backup/export.${format}`,
  restore: (file: File, options: { dryRun?: boolean } = {}) => {
    const body = new FormData()
    body.append('file', file)
    if (options.dryRun) body.append('dry_run', 'true')
    else body.append('mode', 'replace')
    return api<{
      dry_run: boolean
      from_username?: string
      counts: BackupCounts
      file_count?: number
      files_attached?: number
    }>('/backup/import/', { method: 'POST', body })
  },
}

export const dashboard = {
  summary: () => api<DashboardSummary>('/dashboard/summary/'),
  timeseries: (params?: Query) => api<Timeseries>('/dashboard/timeseries/', { params }),
  activity: (params?: Query) => api<ActivityItem[]>('/dashboard/activity/', { params }),
  attention: () => api<Attention>('/dashboard/attention/'),
  companies: () => api<CompanyStat[]>('/dashboard/companies/'),
  regions: () => api<RegionStat[]>('/dashboard/regions/'),
  /** Every place this account's own notes @mention the given tag — the same
      "strip whitespace" form `MentionTextarea` inserts, e.g. "SarahChen". */
  mentions: (tag: string) => api<Mention[]>('/dashboard/mentions/', { params: { tag } }),
  calendar: (params?: Query) => api<CalendarResponse>('/dashboard/calendar/', { params }),
  /** A direct download URL — bypasses `api()` since the response is a file. */
  calendarIcsUrl: (params: { start: string; end: string }) => {
    const base = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000'
    const query = new URLSearchParams(params).toString()
    return `${base}/api/dashboard/calendar.ics?${query}`
  },
}

/**
 * Sample data seeded alongside the first-run tour, so there's something real
 * to click through instead of empty pages. The checklist at the end of the
 * tour decides which categories survive; `cleanup` deletes the rest.
 */
export const onboarding = {
  seed: () => api<SampleDataGroup[]>('/onboarding/sample-data/seed/', { method: 'POST' }),
  summary: () => api<SampleDataGroup[]>('/onboarding/sample-data/'),
  cleanup: (keep: string[]) =>
    api<void>('/onboarding/sample-data/cleanup/', { method: 'POST', body: { keep } }),
}
