import { useRef, type ReactNode } from 'react'
import type { CatchupChoices, TodoChoices } from '../../api/types'
import type { CalendarDraft, CalendarDraftRef } from '../../lib/calendarDraft'
import {
  composeOriginKind,
  type CalendarComposeState,
  type ComposeKind,
} from '../../lib/calendarCompose'
import { cx } from '../../lib/format'
import { CALENDAR_DOMAIN_META, TONE_CHIP } from '../../lib/tones'
import { CalendarEventForm } from '../CalendarEventForm'
import { CatchupForm } from '../CatchupForm'
import { TodoForm } from '../TodoForm'
import { Icon } from '../ui/Icon'

const KIND_META: {
  kind: ComposeKind
  domain: keyof typeof CALENDAR_DOMAIN_META
  label: string
}[] = [
  { kind: 'todo', domain: 'todo', label: 'Todo' },
  { kind: 'event', domain: 'custom', label: 'Event' },
  { kind: 'catchup', domain: 'catchup', label: 'Catch-up' },
]

const KIND_LABEL: Record<ComposeKind, string> = {
  todo: 'todo',
  event: 'event',
  catchup: 'catch-up',
}

const KIND_ARTICLE: Record<ComposeKind, string> = {
  todo: 'a todo',
  event: 'an event',
  catchup: 'a catch-up',
}

function KindSwitcher({
  kind,
  origin,
  onChange,
}: {
  kind: ComposeKind
  /** What the record already is, when one is being edited. */
  origin: ComposeKind | null
  onChange: (kind: ComposeKind) => void
}) {
  const converting = origin !== null && origin !== kind
  return (
    <div className="flex flex-col gap-1.5">
      <div
        role="tablist"
        aria-label="What to add"
        className="flex flex-wrap gap-1.5 rounded-xl border border-line bg-surface-2/50 p-1.5"
      >
        {KIND_META.map((row) => {
          const meta = CALENDAR_DOMAIN_META[row.domain]
          const active = kind === row.kind
          return (
            <button
              key={row.kind}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(row.kind)}
              className={cx(
                'inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-2.5 py-2 text-[12.5px] font-semibold transition-colors',
                active
                  ? TONE_CHIP[meta.tone]
                  : 'border-transparent text-ink-3 hover:bg-surface hover:text-ink-2',
              )}
            >
              <Icon name={meta.icon} size={14} />
              {row.label}
            </button>
          )
        })}
      </div>
      {converting ? (
        /* Switching on its own changes nothing on the calendar — say so,
           because until you save this is still the kind it started as. */
        <p className="flex items-start gap-1.5 rounded-lg border border-warning/30 bg-warning/10 px-2.5 py-1.5 text-[11.5px] text-ink-2">
          <Icon name="alert" size={12} className="mt-0.5 shrink-0 text-warning" />
          <span>
            Saving turns this {KIND_LABEL[origin]} into {KIND_ARTICLE[kind]}. Close without
            saving and it stays {KIND_ARTICLE[origin]}.
          </span>
        </p>
      ) : null}
    </div>
  )
}

/**
 * Calendar-only create/edit shell: one dialog, three colour-coded kinds that
 * match the filter legend (todo / event / catch-up).
 *
 * The kind stays switchable while editing. Switching hands the fields the
 * three have in common to the form you land on and writes nothing — the
 * record only becomes the new kind when you save, and the page then removes
 * the one it replaced.
 */
export function CalendarComposeModal(props: {
  state: CalendarComposeState
  onClose: () => void
  onKindChange: (kind: ComposeKind, draft: CalendarDraft | null) => void
  onSaved: () => void
  todoChoices: TodoChoices | null
  catchupChoices: CatchupChoices | null
}) {
  if (!props.state.open) return null
  return <ComposeBody {...props} />
}

function ComposeBody({
  state,
  onClose,
  onKindChange,
  onSaved,
  todoChoices,
  catchupChoices,
}: {
  state: CalendarComposeState
  onClose: () => void
  onKindChange: (kind: ComposeKind, draft: CalendarDraft | null) => void
  onSaved: () => void
  todoChoices: TodoChoices | null
  catchupChoices: CatchupChoices | null
}) {
  // Filled by whichever form is mounted; read at the moment you switch.
  const draftRef: CalendarDraftRef = useRef<(() => CalendarDraft) | null>(null)
  const kind = state.kind
  const origin = composeOriginKind(state)

  const banner: ReactNode = (
    <KindSwitcher
      kind={kind}
      origin={origin}
      onChange={(next) => onKindChange(next, draftRef.current?.() ?? null)}
    />
  )

  // Only the record matching the kind on screen is edited in place; on any
  // other kind the form starts blank and creates, which is the conversion.
  const editingTodo = kind === 'todo' ? (state.existingTodo ?? null) : null
  const editingEvent = kind === 'event' ? (state.existingEvent ?? null) : null
  const editingCatchup = kind === 'catchup' ? (state.existingCatchup ?? null) : null
  const draft = state.draft ?? null

  if (kind === 'todo') {
    return (
      <TodoForm
        key={`todo-${editingTodo?.id ?? 'new'}-${state.date}`}
        open
        banner={banner}
        draft={draft}
        draftRef={draftRef}
        existing={editingTodo}
        choices={todoChoices}
        seed={
          editingTodo || draft
            ? null
            : {
                kind: 'application',
                title: '',
                due_date: state.date,
                application: null,
                person: null,
                reason: '',
              }
        }
        onClose={onClose}
        onSaved={onSaved}
        onDeleted={onSaved}
      />
    )
  }

  if (kind === 'catchup') {
    return (
      <CatchupForm
        key={`catchup-${editingCatchup?.id ?? 'new'}-${state.date}`}
        open
        banner={banner}
        draft={draft}
        draftRef={draftRef}
        existing={editingCatchup}
        choices={catchupChoices}
        defaultMetOn={editingCatchup || draft ? null : state.date}
        onClose={onClose}
        onSaved={() => onSaved()}
        onDeleted={onSaved}
      />
    )
  }

  return (
    <CalendarEventForm
      key={`event-${editingEvent?.id ?? 'new'}-${state.date}-${state.startTime ?? ''}`}
      open
      banner={banner}
      draft={draft}
      draftRef={draftRef}
      existing={editingEvent}
      defaultDate={state.date}
      defaultAllDay={editingEvent ? undefined : (state.allDay ?? true)}
      defaultStartTime={editingEvent ? undefined : (state.startTime ?? undefined)}
      onClose={onClose}
      onSaved={() => onSaved()}
      onDeleted={onSaved}
    />
  )
}
