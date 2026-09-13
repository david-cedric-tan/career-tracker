export type Tone = 'neutral' | 'brand' | 'good' | 'warning' | 'critical' | 'serious' | 'info'

/** Stage and outcome share a vocabulary across every page — keep it in one place. */
export const STAGE_TONE: Record<string, Tone> = {
  not_submitted: 'neutral',
  applied: 'brand',
  online_assessment: 'brand',
  video_interview: 'brand',
  assessment_centre: 'brand',
  final_interview: 'brand',
  offer: 'good',
}

/**
 * Stages are addable, so the map above can't be exhaustive. The two presets
 * that carry their own meaning are the ends — nothing sent yet, and an offer
 * in hand. Anything else, custom stages included, is a step in progress and
 * should read like one rather than falling back to the grey "not submitted"
 * look.
 */
export function stageTone(key: string): Tone {
  return STAGE_TONE[key] ?? 'brand'
}

export const OUTCOME_TONE: Record<string, Tone> = {
  in_progress: 'brand',
  rejected: 'critical',
  offer_received: 'good',
  accepted: 'good',
  declined: 'neutral',
  withdrawn: 'neutral',
  ghosted: 'serious',
}

export const PRIORITY_TONE: Record<string, Tone> = {
  low: 'neutral',
  medium: 'brand',
  high: 'critical',
}

export const PERSON_STATUS_TONE: Record<string, Tone> = {
  lead: 'warning',
  connection: 'good',
  archived: 'neutral',
  ghosted: 'serious',
}

export const CHANNEL_ICON: Record<string, string> = {
  linkedin: 'link',
  email: 'mail',
  whatsapp: 'phone',
  phone: 'phone',
  instagram: 'link',
  other: 'link',
}

/** Which app a message went through. */
export const MESSAGE_CHANNEL_ICON: Record<string, string> = {
  linkedin: 'link',
  email: 'mail',
  sms: 'phone',
  other: 'sparkles',
}

export const CATCHUP_FORMAT_ICON: Record<string, string> = {
  coffee: 'coffee',
  call: 'phone',
  video: 'users',
  event: 'building',
  message: 'mail',
  other: 'sparkles',
}

/** Calendar domain → display metadata, so every calendar surface (the full
    page, and any future mini widget) agrees on labels/colours/icons. */
export const CALENDAR_DOMAIN_META: Record<
  string,
  { label: string; tone: Tone; icon: string }
> = {
  // One hue per family so a week reads at a glance: green tasks, brand-red
  // application dates (amber when it's a reapply), violet catch-ups, orange
  // people follow-ups, and plain events in neutral.
  todo: { label: 'Task', tone: 'good', icon: 'checklist' },
  application_followup: { label: 'Follow-up', tone: 'brand', icon: 'briefcase' },
  application_reapply: { label: 'Reapply', tone: 'warning', icon: 'briefcase' },
  // Deadlines take their colour from urgency (see DEADLINE_URGENCY_TONE);
  // this is the legend/default.
  application_deadline: { label: 'Deadline', tone: 'critical', icon: 'alert' },
  application_stage: { label: 'Stage move', tone: 'neutral', icon: 'trendingUp' },
  person_chat: { label: 'Catch-up due', tone: 'serious', icon: 'users' },
  catchup: { label: 'Catch-up', tone: 'info', icon: 'coffee' },
  catchup_followup: { label: 'Meeting follow-up', tone: 'serious', icon: 'coffee' },
  custom: { label: 'Event', tone: 'neutral', icon: 'calendar' },
}

/** A closing date's colour by how close it is — the "urgency vibe". */
export const DEADLINE_URGENCY_TONE: Record<string, Tone> = {
  past: 'neutral',
  critical: 'critical',
  soon: 'warning',
  later: 'good',
}

/** The chip colour for a calendar entry — urgency wins for deadlines. */
export function calendarEventTone(event: { domain: string; urgency?: string }): Tone {
  if (event.domain === 'application_deadline' && event.urgency) {
    return DEADLINE_URGENCY_TONE[event.urgency] ?? 'critical'
  }
  return CALENDAR_DOMAIN_META[event.domain]?.tone ?? 'neutral'
}

/** Chip/badge surface for a tone — background, text and border together. */
export const TONE_CHIP: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-ink-2 border-line',
  brand: 'bg-brand-soft text-brand-strong border-brand-ring',
  good: 'bg-good/10 text-good border-good/25',
  warning: 'bg-warning/15 text-[#8a5d00] dark:text-warning border-warning/30',
  serious: 'bg-serious/15 text-[#a04a1f] dark:text-serious border-serious/30',
  critical: 'bg-critical/10 text-critical border-critical/25',
  info: 'bg-info/10 text-info border-info/25',
}


/**
 * The chart colour for a tone.
 *
 * Bars and badges share one vocabulary deliberately: a red "Rejected" badge in
 * the applications table and a red "Rejected" bar on the dashboard are the same
 * fact, so they should be the same colour rather than each picking its own.
 */
export const TONE_COLOR: Record<Tone, string> = {
  neutral: 'var(--color-line-strong)',
  brand: 'var(--color-brand)',
  good: 'var(--color-good)',
  warning: 'var(--color-warning)',
  serious: 'var(--color-serious)',
  critical: 'var(--color-critical)',
  info: 'var(--color-info)',
}
