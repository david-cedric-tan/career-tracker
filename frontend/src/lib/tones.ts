export type Tone = 'neutral' | 'brand' | 'good' | 'warning' | 'critical' | 'serious'

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
  todo: { label: 'Task', tone: 'good', icon: 'checklist' },
  application_followup: { label: 'Follow-up', tone: 'brand', icon: 'briefcase' },
  application_reapply: { label: 'Reapply', tone: 'warning', icon: 'briefcase' },
  person_chat: { label: 'Catch-up due', tone: 'serious', icon: 'users' },
  catchup_followup: { label: 'Meeting follow-up', tone: 'neutral', icon: 'coffee' },
  custom: { label: 'Event', tone: 'brand', icon: 'calendar' },
}
