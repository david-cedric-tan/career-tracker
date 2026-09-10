import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { cx } from '../../lib/format'
import { Icon } from './Icon'
import { Label } from './Field'
import { Spinner } from './Button'

export type Option = { id: number; label: string; hint?: string }

/**
 * Type-ahead picker over a catalog, with "create <name>" inline.
 *
 * FR-REF-07: logging an application must never force a trip to a separate
 * admin screen to pre-seed a company or role, so `onCreate` writes through to
 * the catalog's `ensure/` endpoint and selects the result.
 */
export function Combobox({
  label,
  value,
  options,
  onChange,
  onCreate,
  placeholder = 'Search…',
  createLabel = 'Create',
  error,
  help,
  disabled,
  required,
  className,
}: {
  label?: string
  value: number | null
  options: Option[]
  onChange: (id: number | null) => void
  onCreate?: (name: string) => Promise<Option | null>
  placeholder?: string
  createLabel?: string
  error?: string
  help?: string
  disabled?: boolean
  required?: boolean
  className?: string
}) {
  const id = useId()
  const wrapperRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [creating, setCreating] = useState(false)

  const selected = useMemo(
    () => options.find((option) => option.id === value) ?? null,
    [options, value],
  )

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return options.slice(0, 50)
    return options
      .filter((option) => option.label.toLowerCase().includes(needle))
      .slice(0, 50)
  }, [options, query])

  const exactMatch = matches.some(
    (option) => option.label.toLowerCase() === query.trim().toLowerCase(),
  )
  const canCreate = Boolean(onCreate) && query.trim().length > 0 && !exactMatch
  const rowCount = matches.length + (canCreate ? 1 : 0)

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: MouseEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  // Highlight the first row again whenever the candidate list changes.
  const listKey = `${open}:${query}`
  const [lastListKey, setLastListKey] = useState(listKey)
  if (lastListKey !== listKey) {
    setLastListKey(listKey)
    setActive(0)
  }

  function choose(index: number) {
    if (canCreate && index === matches.length) {
      void create()
      return
    }
    const option = matches[index]
    if (!option) return
    onChange(option.id)
    setQuery('')
    setOpen(false)
  }

  async function create() {
    if (!onCreate || creating) return
    setCreating(true)
    try {
      const created = await onCreate(query.trim())
      if (created) {
        onChange(created.id)
        setQuery('')
        setOpen(false)
      }
    } finally {
      setCreating(false)
    }
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) {
        setOpen(true)
        return
      }
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActive((current) => (current + step + rowCount) % Math.max(rowCount, 1))
    } else if (event.key === 'Enter') {
      if (!open) return
      event.preventDefault()
      choose(active)
    } else if (event.key === 'Escape') {
      setOpen(false)
    } else if (event.key === 'Backspace' && !query && selected) {
      onChange(null)
    }
  }

  return (
    <div className={className}>
      {label ? <Label htmlFor={id}>{label}</Label> : null}
      <div ref={wrapperRef} className="relative">
        <div
          className={cx(
            'flex min-h-10 w-full items-center gap-1.5 rounded-lg border bg-surface px-2.5 transition-colors',
            error ? 'border-critical' : 'border-line hover:border-line-strong',
            open && 'border-brand ring-2 ring-brand-ring',
            disabled && 'bg-surface-2',
          )}
          onClick={() => {
            if (disabled) return
            setOpen(true)
            inputRef.current?.focus()
          }}
        >
          {selected && !query ? (
            <span className="flex min-w-0 items-center gap-1 rounded-md bg-brand-soft px-1.5 py-0.5 text-[13px] font-medium text-brand-strong">
              <span className="truncate">{selected.label}</span>
              <button
                type="button"
                aria-label={`Clear ${selected.label}`}
                className="rounded hover:text-critical"
                onClick={(event) => {
                  event.stopPropagation()
                  onChange(null)
                  inputRef.current?.focus()
                }}
              >
                <Icon name="close" size={13} />
              </button>
            </span>
          ) : null}

          <input
            id={id}
            ref={inputRef}
            role="combobox"
            aria-expanded={open}
            aria-controls={`${id}-listbox`}
            aria-autocomplete="list"
            aria-invalid={error ? true : undefined}
            autoComplete="off"
            disabled={disabled}
            required={required && !selected}
            value={query}
            placeholder={selected ? '' : placeholder}
            onFocus={() => setOpen(true)}
            onChange={(event) => {
              setQuery(event.target.value)
              setOpen(true)
            }}
            onKeyDown={onKeyDown}
            className="min-w-0 flex-1 bg-transparent py-2 text-sm text-ink placeholder:text-ink-3 focus:outline-none disabled:cursor-not-allowed"
          />
          {creating ? (
            <Spinner className="text-ink-3" />
          ) : (
            <Icon name="chevronDown" size={16} className="text-ink-3" />
          )}
        </div>

        {open ? (
          <ul
            id={`${id}-listbox`}
            role="listbox"
            className="scrollbar-thin absolute z-30 mt-1.5 max-h-60 w-full overflow-y-auto rounded-xl border border-line bg-surface-solid p-1 shadow-xl"
          >
            {matches.map((option, index) => (
              <li key={option.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={option.id === value}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(index)}
                  className={cx(
                    'flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm',
                    index === active ? 'bg-surface-2 text-ink' : 'text-ink-2',
                  )}
                >
                  <span className="truncate">{option.label}</span>
                  {option.hint ? (
                    <span className="shrink-0 text-[11px] text-ink-3">{option.hint}</span>
                  ) : null}
                  {option.id === value ? (
                    <Icon name="check" size={15} className="text-brand" />
                  ) : null}
                </button>
              </li>
            ))}

            {canCreate ? (
              <li>
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  onMouseEnter={() => setActive(matches.length)}
                  onClick={() => void create()}
                  className={cx(
                    'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm font-medium text-brand-strong',
                    active === matches.length && 'bg-brand-soft',
                  )}
                >
                  <Icon name="plus" size={15} />
                  {createLabel} “{query.trim()}”
                </button>
              </li>
            ) : null}

            {rowCount === 0 ? (
              <li className="px-2.5 py-3 text-center text-[13px] text-ink-3">
                No matches
              </li>
            ) : null}
          </ul>
        ) : null}
      </div>

      {error ? (
        <p className="mt-1 text-[12px] text-critical">{error}</p>
      ) : help ? (
        <p className="mt-1 text-[12px] text-ink-3">{help}</p>
      ) : null}
    </div>
  )
}

/** Checkbox list for M2M fields (target companies, roles, listings). A search
    box sits above the list whenever there's enough in it to be worth
    filtering — a company picker with a couple dozen entries is a scroll,
    with a couple hundred it's unusable without one. */
export function MultiSelect({
  label,
  options,
  value,
  onChange,
  emptyText = 'Nothing to pick yet.',
  help,
  maxHeight = 'max-h-44',
  searchPlaceholder = 'Search…',
}: {
  label?: string
  options: Option[]
  value: number[]
  onChange: (ids: number[]) => void
  emptyText?: string
  help?: string
  maxHeight?: string
  searchPlaceholder?: string
}) {
  const [query, setQuery] = useState('')

  function toggle(id: number) {
    onChange(value.includes(id) ? value.filter((entry) => entry !== id) : [...value, id])
  }

  const needle = query.trim().toLowerCase()
  const visible = needle
    ? options.filter((option) => option.label.toLowerCase().includes(needle))
    : options
  // Ticked-but-filtered-out entries stay ticked (the value is untouched),
  // they just don't render — so a search never silently drops a selection.

  return (
    <div>
      {label ? <Label>{label}</Label> : null}
      {options.length > 6 ? (
        <div className="relative mb-1.5">
          <Icon
            name="search"
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3"
          />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={searchPlaceholder}
            className="w-full rounded-lg border border-line bg-surface py-1.5 pl-8 pr-2.5 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-brand-ring"
          />
        </div>
      ) : null}
      <div
        className={cx(
          'scrollbar-thin overflow-y-auto rounded-lg border border-line bg-surface-solid p-1',
          maxHeight,
        )}
      >
        {options.length === 0 ? (
          <p className="px-2 py-3 text-center text-[13px] text-ink-3">{emptyText}</p>
        ) : visible.length === 0 ? (
          <p className="px-2 py-3 text-center text-[13px] text-ink-3">No matches.</p>
        ) : (
          visible.map((option) => (
            <label
              key={option.id}
              className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-ink transition-colors hover:bg-surface-2"
            >
              <input
                type="checkbox"
                checked={value.includes(option.id)}
                onChange={() => toggle(option.id)}
                className="size-4 shrink-0 cursor-pointer rounded border-line-strong accent-[var(--color-brand)]"
              />
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {option.hint ? (
                <span className="shrink-0 text-[11px] text-ink-3">{option.hint}</span>
              ) : null}
            </label>
          ))
        )}
      </div>
      {help ? <p className="mt-1 text-[12px] text-ink-3">{help}</p> : null}
    </div>
  )
}
