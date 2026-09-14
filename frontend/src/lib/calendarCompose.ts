import type { CalendarEventRecord, Catchup, Todo } from '../api/types'
import type { CalendarDraft } from './calendarDraft'

export type ComposeKind = 'todo' | 'event' | 'catchup'

export type CalendarComposeState = {
  open: boolean
  kind: ComposeKind
  date: string
  /** `HH:MM` when opened from a timed hour slot. */
  startTime?: string | null
  allDay?: boolean
  existingTodo?: Todo | null
  existingEvent?: CalendarEventRecord | null
  existingCatchup?: Catchup | null
  /** Values handed over by the kind you switched away from. */
  draft?: CalendarDraft | null
}

export function emptyCompose(date: string, kind: ComposeKind = 'event'): CalendarComposeState {
  return {
    open: false,
    kind,
    date,
    startTime: null,
    allDay: true,
    existingTodo: null,
    existingEvent: null,
    existingCatchup: null,
    draft: null,
  }
}

/** Which kind the record actually is, when one is being edited. */
export function composeOriginKind(state: CalendarComposeState): ComposeKind | null {
  if (state.existingTodo) return 'todo'
  if (state.existingEvent) return 'event'
  if (state.existingCatchup) return 'catchup'
  return null
}
