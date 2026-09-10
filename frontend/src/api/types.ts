export type Choice = { value: string; label: string }

export type User = {
  id: number
  username: string
  email: string
  first_name: string
  last_name: string
  date_joined?: string
  /** Absolute URL of the profile picture, or null if none is set. */
  avatar: string | null
  /** Absolute URL of the user's own Intern-mode background, or null. */
  custom_wallpaper: string | null
  mobile_number: string
  school_email: string
  linkedin_url: string
  onboarding_completed: boolean
  /** Appearance — blank/null until the user picks something, meaning "use the frontend default". */
  theme_mode: string
  wallpaper: string
  wallpaper_blur: number | null
  wallpaper_opacity: number | null
  color_preset: string
  font_family: string
  /** null until the user actually toggles it — the frontend default applies. */
  celebrations_enabled: boolean | null
  /** The dashboard board's arrangement, opaque to the API. */
  dashboard_layout: DashboardLayout | null
}

/** Widget ids are the frontend's vocabulary; `spans` is columns out of 4. */
export type DashboardLayout = {
  order: string[]
  hidden: string[]
  spans?: Record<string, number>
}

export type AuthResponse = { token: string; user: User }

/* ---------------------------------------------------------------- catalogs */

export type Industry = { id: number; name: string }
/** A step in the pipeline. `key` is what applications and the event log
    actually store; `position` is the order the pipeline is drawn in. */
export type ApplicationStage = {
  id: number
  key: string
  name: string
  position: number
  is_preset: boolean
}
export type Role = { id: number; name: string }
export type Country = { id: number; name: string }
export type State = { id: number; name: string; country: number; country_name: string }
export type Location = {
  id: number
  name: string
  state: number
  state_name: string
  country: number
  country_name: string
  full_name: string
}
export type Venue = {
  id: number
  name: string
  location: number
  location_name: string
  state_name: string
  country: number
  country_name: string
  full_name: string
}
export type Company = {
  id: number
  name: string
  /** Short form for long official names ("International Business Machines" -> "IBM"). */
  short_name: string
  /** A company can span more than one industry (e.g. a bank's tech arm). */
  industries: number[]
  industry_names: string[]
  /** Absolute URL of the brand mark, or null. */
  logo: string | null
  /** Countries this company operates in — optional, powers the region map. */
  regions: number[]
  region_names: string[]
}

/** A person's company as embedded in the network payload, for the graph view. */
export type CompanyRef = {
  id: number
  name: string
  logo: string | null
}

/* ---------------------------------------------------------------- resumes */

export type Resume = {
  id: number
  label: string
  variant_type: 'general' | 'company' | 'role'
  variant_type_display: string
  target_companies: number[]
  target_company_names: string[]
  target_roles: number[]
  target_role_names: string[]
  notes: string
  is_active: boolean
  /** Absolute URL of the attached document, or null. */
  file: string | null
  /** The name the user uploaded it under. */
  file_name: string
  /** "PDF" | "Word" | "Pages" | … , or null when nothing is attached. */
  file_kind: string | null
  file_size: number | null
  application_count: number
  created_at: string
  updated_at: string
}

/* --------------------------------------------------------------- listings */

export type JobListing = {
  id: number
  company: number
  company_name: string
  role: number
  role_name: string
  location: number | null
  location_name: string | null
  role_type: string
  role_type_display: string
  work_arrangement: string
  work_arrangement_display: string
  opened_at: string | null
  closing_at: string | null
  job_url: string | null
  description: string
  skills: string
  skills_list: string[]
  linkedin_application_count: number
}

/* ----------------------------------------------------------- applications */

export type ApplicationListingLink = {
  id: number
  application: number
  job_listing: number
  listing_detail: JobListing
  outcome: string
  effective_outcome: string
}

export type EventType = 'created' | 'stage' | 'outcome' | 'edited'

/** One field that moved in a save, rendered for display by the API. */
export type FieldChange = {
  field: string
  label: string
  from: string | null
  to: string | null
}

export type EventLog = {
  id: number
  application: number
  company_name: string
  event_type: EventType
  event_type_display: string
  prev_stage: string
  prev_stage_display: string | null
  curr_stage: string
  curr_stage_display: string
  prev_outcome: string
  prev_outcome_display: string | null
  curr_outcome: string
  curr_outcome_display: string
  changes: FieldChange[]
  changed_at: string
  note: string
}

export type ApplicationSummary = {
  id: number
  company: number
  company_name: string
  stage: string
  stage_display: string
  outcome: string
  outcome_display: string
  applied_at: string
  follow_up_date: string | null
  reapply_at: string | null
  source: string
  resume: number | null
  resume_label: string | null
  listing_count: number
  role_names: string[]
  updated_at: string
}

export type Application = ApplicationSummary & {
  resume_version: string
  stage_updated_at: string | null
  notes: string
  listing_links: ApplicationListingLink[]
  event_logs: EventLog[]
  created_at: string
}

export type ApplicationChoices = {
  stage: Choice[]
  outcome: Choice[]
  role_type: Choice[]
  work_arrangement: Choice[]
}

/* --------------------------------------------------------------- network */

export type ContactMethod = {
  id?: number
  channel: string
  value: string
  is_preferred: boolean
  channel_display?: string
}

export type Person = {
  id: number
  full_name: string
  title: string
  /** Absolute URL of their photo, or null. */
  photo: string | null
  status: string
  status_display: string
  /** FK into the addable RelationshipTag catalog — null until set. */
  relationship: number | null
  relationship_display: string | null
  /** FK into the addable MetSourceTag catalog — null until set. */
  source: number | null
  source_display: string | null
  companies: number[]
  company_names: string[]
  company_details: CompanyRef[]
  catchup_count: number
  applications?: number[]
  application_labels?: { id: number; label: string }[]
  last_meeting_at: string | null
  next_chat_at: string | null
  /** Months between catch-ups before a blank next-chat date is auto-filled.
      Null means "use the app's 3-month default". */
  cadence_months: number | null
  notes?: string
  contact_methods: ContactMethod[]
  preferred_contact_display: { channel: string; value: string } | null
  created_at?: string
  updated_at: string
}

export type NetworkChoices = {
  status: Choice[]
  channel: Choice[]
}

/* ----------------------------------------------------------------- todos */

export type Todo = {
  id: number
  title: string
  description: string
  due_date: string | null
  priority: string
  priority_display: string
  status: string
  status_display: string
  application: number | null
  application_label: string | null
  person: number | null
  person_name: string | null
  company: number | null
  company_name: string | null
  is_overdue: boolean
  completed_at: string | null
  created_at: string
  updated_at: string
}

export type TodoChoices = { status: Choice[]; priority: Choice[] }

export type TodoSuggestion = {
  kind: 'application' | 'person'
  title: string
  due_date: string
  application: number | null
  person: number | null
  reason: string
}

/* ------------------------------------------------------------- dashboard */

export type CountBucket = { value: string; label: string; count: number }

export type DashboardSummary = {
  applications: {
    total: number
    active: number
    offers: number
    rejected: number
    follow_ups_due: number
    by_stage: CountBucket[]
    by_outcome: CountBucket[]
  }
  todos: { open: number; done: number; overdue: number; due_this_week: number }
  network: {
    total: number
    connections: number
    leads: number
    chats_overdue: number
    chats_due_soon: number
  }
}

export type TimeseriesBucket = {
  start: string
  applications: number
  stage_advances: number
  todos_completed: number
}

export type Timeseries = { period: 'week' | 'month'; buckets: TimeseriesBucket[] }

export type ActivityItem = {
  domain: 'application' | 'todo' | 'network' | 'catchup'
  event_type: EventType | 'completed' | 'person_added' | string
  occurred_at: string
  summary: string
  note: string
  target_id: number
  target_url: string
}

export type Attention = {
  follow_ups: { id: number; company: string; stage: string; follow_up_date: string }[]
  chats: { id: number; full_name: string; next_chat_at: string; status: string }[]
  tasks: {
    id: number
    title: string
    due_date: string
    priority: string
    is_overdue: boolean
  }[]
  reapplies: { id: number; company: string; outcome: string; reapply_at: string }[]
}

/* -------------------------------------------------------------- catchups */

export type Catchup = {
  id: number
  person: number
  person_name: string
  person_photo: string | null
  person_companies: string[]
  met_on: string
  title: string
  display_title: string
  format: string
  format_display: string
  /** Only meaningful when format === 'other' — what "other" actually was. */
  format_other: string
  location: string
  minutes: string
  takeaways: string
  follow_up_on: string | null
  created_at: string
  updated_at: string
}

export type CatchupChoices = { format: Choice[] }

/* ------------------------------------------------------------ experience */

export type ExperiencePhoto = {
  id: number
  image: string
  caption: string
  created_at: string
}

export type Experience = {
  id: number
  company: number
  company_name: string
  company_logo: string | null
  title: string
  started_on: string
  ended_on: string | null
  is_current: boolean
  description: string
  photos: ExperiencePhoto[]
  created_at: string
  updated_at: string
}

/* ----------------------------------------------------- dashboard company */

export type CompanyStat = {
  id: number
  name: string
  short_name: string
  logo: string | null
  count: number
  active: number
  offers: number
}

/* ------------------------------------------------------ dashboard region */

export type RegionStat = {
  country_id: number
  country_name: string
  count: number
}

/* ------------------------------------------------------------- profile */

export type ProfileAttachment = {
  id: number
  file: string
  original_name: string
  kind: 'image' | 'document'
  caption: string
  created_at: string
}

export type Education = {
  id: number
  school: string
  degree: string
  field_of_study: string
  started_on: string
  ended_on: string | null
  is_current: boolean
  description: string
  attachments: ProfileAttachment[]
  created_at: string
  updated_at: string
}

export type Certification = {
  id: number
  name: string
  issuer: string
  issued_on: string | null
  expires_on: string | null
  credential_url: string
  description: string
  is_expired: boolean
  attachments: ProfileAttachment[]
  created_at: string
  updated_at: string
}

export type ExtraCurricular = {
  id: number
  organization: string
  role: string
  started_on: string
  ended_on: string | null
  is_current: boolean
  description: string
  attachments: ProfileAttachment[]
  created_at: string
  updated_at: string
}

export type ProfileLink = {
  id: number
  label: string
  url: string
  category: string
  category_display: string
}

export type ProfileAddress = {
  id: number
  label: string
  address: string
}

/* -------------------------------------------------------------- calendar */

export type CalendarEvent = {
  id: string
  domain:
    | 'todo'
    | 'application_followup'
    | 'application_reapply'
    | 'person_chat'
    | 'catchup_followup'
    | 'custom'
  title: string
  date: string
  done: boolean
  target_url: string
  /** Only ever present on `domain: 'custom'` rows — every other domain is date-only. */
  all_day?: boolean
  start_time?: string | null
  end_time?: string | null
}

export type CalendarResponse = { start: string; end: string; events: CalendarEvent[] }

/** A user-created calendar entry (FR-CAL-07) — the CRUD row this app owns,
    as opposed to `CalendarEvent` above, which is the read-only aggregated
    shape every domain (this one included) gets flattened into. */
export type EventReminder = {
  id: number
  minutes_before: number
  /** ISO datetime — computed server-side from the event's date/time (or,
      for an all-day event, a fixed 9am reference) minus `minutes_before`. */
  fires_at: string
}

/** Enough of a person to draw them on the event bubble view without a
    second fetch — same shape rationale as Person.company_details. */
export type EventPersonRef = {
  id: number
  full_name: string
  status: string
  status_display: string
  relationship_display: string | null
  photo: string | null
}

export type CalendarEventRecord = {
  id: number
  title: string
  date: string
  all_day: boolean
  start_time: string | null
  end_time: string | null
  notes: string
  is_done: boolean
  company: number | null
  company_name: string | null
  application: number | null
  application_label: string | null
  people: number[]
  people_details: EventPersonRef[]
  reminders: EventReminder[]
  created_at: string
  updated_at: string
}

/** The write shape — `reminders` only carries what's settable; `id`/`fires_at`
    are server-computed. The form always sends the full current set. */
export type CalendarEventInput = {
  title: string
  date: string
  all_day: boolean
  start_time: string | null
  end_time: string | null
  notes: string
  is_done: boolean
  company: number | null
  application: number | null
  people: number[]
  reminders: { minutes_before: number }[]
}

/* -------------------------------------------------------------- onboarding */

/** One keep-or-discard choice in the end-of-tour sample-data checklist. */
export type SampleDataGroup = {
  category: string
  label: string
  count: number
  examples: string[]
}

/* ------------------------------------------------------ job listing import */

export type JobListingImportRow = {
  company: string
  role: string
  role_type?: string
  work_arrangement?: string
  closing_at?: string
  job_url?: string
  location?: string
  description?: string
  skills?: string[] | string
}

export type JobListingImportResult = {
  index: number
  ok: boolean
  id?: number
  created?: boolean
  role?: string
  company?: string
  warnings?: string[]
  error?: string
}

/** A user's own private note on a company — see FR-COMPANY-04. */
export type CompanyNote = {
  notes: string
  updated_at?: string
}

/* ------------------------------------------------------------- network v2 */

export type RelationshipTag = { id: number; name: string }
export type MetSourceTag = { id: number; name: string }

/* -------------------------------------------------------- historical logging */

/** One backdated stage move for the "log an old application" flow. */
export type HistoricalMove = {
  stage: string
  outcome?: string
  /** YYYY-MM-DD. */
  changed_at: string
  note?: string
}

/** One place a person or location was @mentioned, from the free-text search
    across notes-shaped fields (todos, contact notes, catch-ups, company notes). */
export type Mention = {
  domain: 'todo' | 'person_notes' | 'catchup' | 'company_note'
  id: number
  title: string
  snippet: string
  url: string
}
