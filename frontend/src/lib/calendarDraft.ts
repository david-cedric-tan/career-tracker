import { useEffect, type MutableRefObject } from 'react'

/**
 * The fields a todo, an event and a catch-up all understand.
 *
 * Switching what you're logging shouldn't cost you what you've already
 * typed: the form you're leaving hands over this, and the one you arrive at
 * fills in whatever it has a home for. Anything the next kind can't hold (a
 * catch-up has no clock time, no company) is simply dropped — it was never
 * saved, so nothing is lost that existed.
 */
export type CalendarDraft = {
  title: string
  /** YYYY-MM-DD. */
  date: string
  allDay: boolean
  /** HH:MM, meaningful only when `allDay` is false. */
  startTime: string
  endTime: string
  notes: string
  person: number | null
  company: number | null
  application: number | null
}

/** Where a form parks a getter for its current values, for the switcher. */
export type CalendarDraftRef = MutableRefObject<(() => CalendarDraft) | null>

/**
 * Publish this form's values so a kind switch can carry them over.
 *
 * A getter rather than a value: the switcher reads it in the click handler,
 * at which point it wants what's on screen right now, not whatever was there
 * when the last render committed. Set in an effect (never during render) so
 * it can't trip the "no refs during render" rule.
 */
export function usePublishDraft(
  ref: CalendarDraftRef | undefined,
  build: () => CalendarDraft,
): void {
  useEffect(() => {
    if (!ref) return
    ref.current = build
    return () => {
      if (ref.current === build) ref.current = null
    }
  })
}
