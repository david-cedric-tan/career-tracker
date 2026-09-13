import { useEffect, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { formatApiError } from '../api/client'
import { todos } from '../api/resources'
import type {
  Todo,
  TodoSuggestion,
} from '../api/types'
import { useCelebrate } from '../celebrate/context'
import { ProgressRing } from '../components/charts/ProgressRing'
import { PageHeader } from '../components/layout/PageHeader'
import { TodoForm } from '../components/TodoForm'
import { Badge } from '../components/ui/Badge'
import { PRIORITY_TONE } from '../lib/tones'
import { Button } from '../components/ui/Button'
import { Card, CardHeader } from '../components/ui/Card'
import { Select } from '../components/ui/Field'
import { Icon } from '../components/ui/Icon'
import { EmptyState, ErrorState, Loading, Refreshing } from '../components/ui/States'
import { useToast } from '../components/ui/toast-context'
import { useAutoOpenFromQuery } from '../hooks/useAutoOpenFromQuery'
import { useResource } from '../hooks/useResource'
import { cx, relativeDay } from '../lib/format'
import {
  useTodoSuggestionsExpanded,
  useTodoSuggestionsHidden,
  useTodoSuggestionsSetting,
} from '../lib/todoSuggestions'
import { plainText } from '../lib/richTextMarkers'
import { rememberList } from '../lib/listState'

/** `position` is the manual order behind the drag handles; everything else is
    a computed sort that ignores it. */
const SORTS = [
  { value: 'due_date', label: 'Due date' },
  { value: '-priority', label: 'Priority' },
  { value: 'title', label: 'Title' },
  { value: '-created_at', label: 'Newest' },
  { value: 'position', label: 'Custom order' },
] as const

const SCOPES = [
  { value: '', label: 'All' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'today', label: 'Today' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'standalone', label: 'Standalone' },
]

export function TodosPage() {
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  // A link from the dashboard or calendar carries a `from` so there's a way
  // back to it — direct nav here (sidebar, bookmark) shows no such link.
  const from = (location.state as { from?: string } | null)?.from ?? null
  const { notify } = useToast()
  const celebrate = useCelebrate()
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Todo | null>(null)
  const [seed, setSeed] = useState<TodoSuggestion | null>(null)

  // The onboarding tour's "try it" action for this page — `?new=1` opens the
  // same form the "Add todo" button does.
  useAutoOpenFromQuery('new', () => {
    setEditing(null)
    setSeed(null)
    setFormOpen(true)
  })

  const sort = params.get('sort') ?? 'due_date'
  const scope = params.get('scope') ?? ''
  // `open` is the default *view*, but "Any status" has to be representable in
  // the URL — clearing the param would just fall back to the default again, so
  // "all" is an explicit value rather than an absent one.
  const status = params.get('status') ?? 'open'
  const statusFilter = status === 'all' ? '' : status

  // Sidebar / back-links restore this query via listPath('todos').
  useEffect(() => {
    rememberList('todos', params.toString() ? `?${params}` : '')
  }, [params])

  const choices = useResource(() => todos.choices(), [])
  const list = useResource(
    () => todos.list({ scope, status: statusFilter, ordering: sort }),
    [scope, statusFilter, sort],
  )
  // The order shown while a drag is in flight, so the row follows the cursor
  // instead of waiting on the round trip.
  const [dragOrder, setDragOrder] = useState<Todo[] | null>(null)
  const [draggingId, setDraggingId] = useState<number | null>(null)
  const [suggestionsEnabled] = useTodoSuggestionsSetting()
  const [suggestionsExpanded, setSuggestionsExpanded] = useTodoSuggestionsExpanded()
  const [suggestionsHidden, setSuggestionsHidden] = useTodoSuggestionsHidden()

  // A leftover drag overlay would keep showing the old arrangement after a
  // create/edit reload, so the new entry looked like it never saved.
  useEffect(() => {
    setDragOrder(null)
  }, [scope, statusFilter, sort])

  async function persistOrder(ordered: Todo[]) {
    setDragOrder(ordered)
    try {
      await todos.reorder(ordered.map((todo) => todo.id))
      // Dragging *is* the act of choosing a custom order, so switch to it
      // rather than making the arrangement invisible behind another sort.
      if (sort !== 'position') setParam('sort', 'position')
      else list.reload()
      setDragOrder(null)
    } catch (err) {
      notify(formatApiError(err), 'error')
      setDragOrder(null)
      list.reload()
    }
  }

  function onDropRow(targetId: number) {
    const current = dragOrder ?? list.data ?? []
    if (draggingId === null || draggingId === targetId) return
    const from = current.findIndex((todo) => todo.id === draggingId)
    const to = current.findIndex((todo) => todo.id === targetId)
    if (from === -1 || to === -1) return
    const next = [...current]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    void persistOrder(next)
  }
  const suggestions = useResource(
    () => (suggestionsEnabled ? todos.suggestions() : Promise.resolve([])),
    [suggestionsEnabled],
  )
  // Counted over every todo, not the current filter — otherwise the ring would
  // read 100% the moment you filtered to "Done".
  const allTodos = useResource(() => todos.list(), [])
  const doneCount = allTodos.data?.filter((todo) => todo.status === 'done').length ?? 0
  const totalCount = allTodos.data?.length ?? 0

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  async function toggle(todo: Todo) {
    try {
      const updated = await todos.toggle(todo.id)
      // Finishing something is progress; un-finishing it isn't.
      if (updated.status === 'done') celebrate('todo')
      list.reload()
      suggestions.reload()
      allTodos.reload()
    } catch (err) {
      notify(formatApiError(err), 'error')
    }
  }

  // While a drag is settling, show the arrangement the user just made.
  const rows = dragOrder ?? list.data ?? []


  return (
    <>
      {from ? (
        <Link
          to={from}
          className="mb-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-3 transition-colors hover:text-ink"
        >
          <Icon name="chevronLeft" size={15} />
          Back
        </Link>
      ) : null}

      <PageHeader
        title="My Todos"
        subtitle={rows.length ? `${rows.length} ${rows.length === 1 ? 'task' : 'tasks'}` : undefined}
        action={
          <>
            {totalCount > 0 ? (
              <div className="mr-1 hidden rounded-lg border border-line bg-surface px-3 py-1.5 intern:backdrop-blur-md sm:block">
                <ProgressRing
                  done={doneCount}
                  total={totalCount}
                  size={38}
                  stroke={4.5}
                  label="Completed"
                />
              </div>
            ) : null}
            <Button
              variant="primary"
              onClick={() => {
                setEditing(null)
                setSeed(null)
                setFormOpen(true)
              }}
              icon={<Icon name="plus" size={16} />}
            >
              New todo
            </Button>
          </>
        }
      />

      {suggestionsEnabled && suggestionsHidden && (suggestions.data?.length ?? 0) > 0 ? (
        <button
          type="button"
          onClick={() => {
            setSuggestionsHidden(false)
            suggestions.reload()
          }}
          className="mb-4 inline-flex items-center gap-1.5 rounded-lg border border-brand-ring bg-brand-soft px-3 py-1.5 text-[12.5px] font-medium text-brand-strong transition-colors hover:bg-brand-soft/80"
        >
          <Icon name="sparkles" size={14} />
          Suggestions
          <span className="rounded-full bg-brand/15 px-1.5 py-0.5 text-[11px]">
            {suggestions.data?.length}
          </span>
        </button>
      ) : null}

      {suggestionsEnabled &&
      !suggestionsHidden &&
      suggestions.data &&
      suggestions.data.length > 0 ? (
        <Card className="mb-4 border-brand-ring bg-brand-soft">
          <CardHeader
            title={
              <span className="flex items-center gap-1.5">
                <Icon name="sparkles" size={15} className="text-brand" />
                Suggested follow-ups
              </span>
            }
            subtitle="Dates elsewhere in the app that nothing is tracking yet"
            action={
              <button
                type="button"
                onClick={() => setSuggestionsHidden(true)}
                aria-label="Hide suggestions"
                className="rounded-lg p-1.5 text-ink-3 transition-colors hover:bg-surface/70 hover:text-ink"
              >
                <Icon name="close" size={14} />
              </button>
            }
          />
          <ul className="mt-3 flex flex-col gap-2">
            {(suggestionsExpanded
              ? suggestions.data
              : suggestions.data.slice(0, 3)
            ).map((suggestion, index) => (
              <li
                key={`${suggestion.kind}-${suggestion.application ?? suggestion.person}-${index}`}
                className="flex items-center gap-3 rounded-lg border border-brand-ring/70 bg-surface px-3 py-2"
              >
                <Icon
                  name={suggestion.kind === 'application' ? 'briefcase' : 'users'}
                  size={16}
                  className="shrink-0 text-brand"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium text-ink">
                    {suggestion.title}
                  </span>
                  <span className="block truncate text-[12px] text-ink-3">
                    {suggestion.reason}
                  </span>
                </span>
                <Button
                  size="sm"
                  onClick={() => {
                    setEditing(null)
                    setSeed(suggestion)
                    setFormOpen(true)
                  }}
                >
                  Add
                </Button>
              </li>
            ))}
          </ul>
          {suggestions.data.length > 3 ? (
            <button
              type="button"
              onClick={() => setSuggestionsExpanded(!suggestionsExpanded)}
              className="mt-2 text-[12.5px] font-medium text-brand hover:underline"
            >
              {suggestionsExpanded
                ? 'Show less'
                : `View more (${suggestions.data.length - 3})`}
            </button>
          ) : null}
        </Card>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex flex-wrap rounded-lg border border-line bg-surface p-0.5">
          {SCOPES.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setParam('scope', option.value)}
              aria-pressed={scope === option.value}
              className={cx(
                'rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors',
                scope === option.value
                  ? 'bg-brand-soft text-brand-strong'
                  : 'text-ink-2 hover:text-ink',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        <Select
          value={sort}
          onChange={(event) => {
            setDragOrder(null)
            setParam('sort', event.target.value)
          }}
          aria-label="Sort todos"
          wrapperClassName="w-44"
        >
          {SORTS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        <Select
          value={status}
          onChange={(event) => setParam('status', event.target.value)}
          aria-label="Filter by status"
          wrapperClassName="w-40"
        >
          <option value="all">Any status</option>
          {choices.data?.status.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </Select>
      </div>

      {list.initial ? (
        <Loading />
      ) : list.error && !list.data ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : rows.length === 0 ? (
        <Card padded={false}>
          <EmptyState
            icon="checklist"
            title={scope || status !== 'open' ? 'Nothing here' : 'No open todos'}
            description="Follow-ups you create here show up on the dashboard as they come due."
            action={
              <Button
                variant="primary"
                onClick={() => {
                  setEditing(null)
                  setSeed(null)
                  setFormOpen(true)
                }}
                icon={<Icon name="plus" size={16} />}
              >
                New todo
              </Button>
            }
          />
        </Card>
      ) : (
        <Refreshing active={list.loading && !list.initial}>
          <Card padded={false}>
            <ul className="divide-y divide-line">
              {rows.map((todo) => (
                <li
                  key={todo.id}
                  draggable
                  onDragStart={() => setDraggingId(todo.id)}
                  onDragEnd={() => setDraggingId(null)}
                  // Without preventDefault the row refuses the drop.
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault()
                    onDropRow(todo.id)
                    setDraggingId(null)
                  }}
                  className={cx(
                    // Tighter on the left than the right: the grip glyph is
                    // drawn inset inside its own icon box, so full padding as
                    // well left the row looking indented from the card edge.
                    'group/todo flex items-start gap-2 py-3 pl-1.5 pr-3 transition-opacity sm:pl-2 sm:pr-4',
                    'cursor-grab active:cursor-grabbing',
                    draggingId === todo.id && 'opacity-40',
                  )}
                >
                  {/* Draggable under every sort, not just Custom: dragging is
                      how you ask for a custom order, so requiring you to pick
                      it first would put the setting before the intention. The
                      drop switches the sort for you. */}
                  <span
                    aria-hidden="true"
                    title="Drag to reorder"
                    // `-ml-1` claws back the dead space the grip glyph
                    // carries inside its own 24-unit icon box.
                    className="-ml-1 mt-0.5 shrink-0 text-ink-3 opacity-0 transition-opacity group-hover/todo:opacity-100"
                  >
                    <Icon name="gripVertical" size={16} />
                  </span>
                  <button
                    type="button"
                    onClick={() => void toggle(todo)}
                    aria-label={todo.status === 'done' ? 'Mark as open' : 'Mark as done'}
                    className={cx(
                      'mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border transition-colors',
                      todo.status === 'done'
                        ? 'border-good bg-good text-white'
                        : 'border-line-strong text-transparent hover:border-brand hover:text-brand-ring',
                    )}
                  >
                    <Icon name="check" size={13} />
                  </button>

                  <div className="min-w-0 flex-1">
                    <p
                      className={cx(
                        'text-[13.5px] font-medium',
                        todo.status === 'done' ? 'text-ink-3 line-through' : 'text-ink',
                      )}
                    >
                      {todo.title}
                    </p>
                    {todo.description ? (
                      <p className="mt-0.5 line-clamp-2 text-[12.5px] text-ink-3">
                        {plainText(todo.description)}
                      </p>
                    ) : null}
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px]">
                      {todo.due_date ? (
                        <span
                          className={cx(
                            'inline-flex items-center gap-1 font-medium',
                            todo.is_overdue ? 'text-critical' : 'text-ink-3',
                          )}
                        >
                          <Icon name={todo.is_overdue ? 'alert' : 'calendar'} size={12} />
                          {relativeDay(todo.due_date)}
                        </span>
                      ) : null}
                      {todo.application ? (
                        <Link
                          to={`/applications/${todo.application}`}
                          className="inline-flex items-center gap-1 text-ink-3 hover:text-brand"
                        >
                          <Icon name="briefcase" size={12} />
                          {todo.application_label}
                        </Link>
                      ) : null}
                      {todo.person ? (
                        <Link
                          to={`/network/${todo.person}`}
                          className="inline-flex items-center gap-1 text-ink-3 hover:text-brand"
                        >
                          <Icon name="users" size={12} />
                          {todo.person_name}
                        </Link>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    <Badge tone={PRIORITY_TONE[todo.priority] ?? 'neutral'}>
                      {todo.priority_display}
                    </Badge>
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(todo)
                        setSeed(null)
                        setFormOpen(true)
                      }}
                      aria-label={`Edit ${todo.title}`}
                      className="rounded-lg p-1.5 text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
                    >
                      <Icon name="edit" size={15} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </Refreshing>
      )}

      <TodoForm
        open={formOpen}
        existing={editing}
        seed={seed}
        choices={choices.data}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          setDragOrder(null)
          list.reload()
          suggestions.reload()
          allTodos.reload()
        }}
        onDeleted={() => {
          setDragOrder(null)
          list.reload()
          suggestions.reload()
          allTodos.reload()
        }}
      />
    </>
  )
}