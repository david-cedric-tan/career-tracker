import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import {
  applications,
  companies,
  jobListings,
  locations,
  people,
  venues,
} from '../../api/resources'
import { useResource } from '../../hooks/useResource'
import { cx } from '../../lib/format'
import { MARKERS } from '../../lib/richTextMarkers'
import { FieldShell } from './Field'
import { Icon } from './Icon'

type MentionOption = {
  key: string
  kind: 'person' | 'location' | 'company' | 'venue' | 'application' | 'listing'
  /** What gets inserted after "@" — spaces stripped, so it stays one token
      ("@DanielJohnson", "@NewYork") rather than swallowing the rest of the
      sentence as part of the mention. */
  tag: string
  label: string
  hint?: string
}

const MENTION_ICON: Record<MentionOption['kind'], string> = {
  person: 'users',
  company: 'briefcase',
  location: 'building',
  venue: 'mapPin',
  application: 'checklist',
  listing: 'file',
}

const MAX_SUGGESTIONS = 8

/** Loads the catalogs a mention can resolve against. Each field does its own
    small fetch rather than sharing a cache — this is reference data that
    rarely changes, so the simplicity is worth the odd extra request. */
function useMentionOptions(): MentionOption[] {
  const peopleList = useResource(() => people.list(), [])
  const companiesList = useResource(() => companies.list(), [])
  const locationsList = useResource(() => locations.list(), [])
  const venuesList = useResource(() => venues.list(), [])
  const applicationsList = useResource(() => applications.list(), [])
  const listingsList = useResource(() => jobListings.list(), [])

  return useMemo(() => {
    const fromPeople: MentionOption[] = (peopleList.data ?? []).map((person) => ({
      key: `person-${person.id}`,
      kind: 'person',
      tag: person.full_name.replace(/\s+/g, ''),
      label: person.full_name,
      hint: person.title || person.company_names[0],
    }))
    const fromCompanies: MentionOption[] = (companiesList.data ?? []).map((company) => {
      const label = company.short_name || company.name
      return {
        key: `company-${company.id}`,
        kind: 'company',
        tag: label.replace(/\s+/g, ''),
        label,
        hint: company.industry_names[0],
      }
    })
    const fromLocations: MentionOption[] = (locationsList.data ?? []).map((location) => ({
      key: `location-${location.id}`,
      kind: 'location',
      tag: location.name.replace(/\s+/g, ''),
      label: location.name,
      hint: `${location.state_name}, ${location.country_name}`,
    }))
    // A venue sits a level more precise than a city ("The Pillars, Wynyard"
    // vs. just "Sydney") — its own kind so the suggestion list still shows
    // which city it's in, rather than colliding with the location entries.
    const fromVenues: MentionOption[] = (venuesList.data ?? []).map((venue) => ({
      key: `venue-${venue.id}`,
      kind: 'venue',
      tag: venue.name.replace(/\s+/g, ''),
      label: venue.name,
      hint: venue.location_name,
    }))
    // A job is identified by its role, not the company — "@Deloitte" already
    // means the company. An application and the listing behind it are the
    // same job, so they'd produce the same tag; keep whichever came first
    // (applications, which carry your stage) rather than listing it twice.
    const fromApplications: MentionOption[] = (applicationsList.data ?? []).map((application) => {
      const label = application.role_names[0] ?? application.company_name
      return {
        key: `application-${application.id}`,
        kind: 'application',
        tag: label.replace(/\s+/g, ''),
        label,
        hint: `${application.company_name} · ${application.stage_display}`,
      }
    })
    const fromListings: MentionOption[] = (listingsList.data ?? []).map((listing) => ({
      key: `listing-${listing.id}`,
      kind: 'listing',
      tag: listing.role_name.replace(/\s+/g, ''),
      label: listing.role_name,
      hint: listing.company_name,
    }))
    const seen = new Set<string>()
    const jobs = [...fromApplications, ...fromListings].filter((option) => {
      if (seen.has(option.tag)) return false
      seen.add(option.tag)
      return true
    })

    return [...fromPeople, ...fromCompanies, ...jobs, ...fromLocations, ...fromVenues]
  }, [
    peopleList.data,
    companiesList.data,
    locationsList.data,
    venuesList.data,
    applicationsList.data,
    listingsList.data,
  ])
}

/** The "@word" token touching the caret, or null if the caret isn't inside
    one. Stops at whitespace or another "@" — a mention never spans either. */
function activeMention(text: string, caret: number): { start: number; query: string } | null {
  let i = caret - 1
  while (i >= 0 && text[i] !== '@' && !/\s/.test(text[i])) i--
  if (i < 0 || text[i] !== '@') return null
  return { start: i, query: text.slice(i + 1, caret) }
}

type MentionField = HTMLTextAreaElement | HTMLInputElement

/**
 * The whole @mention behaviour, independent of which element renders it —
 * a textarea (notes, minutes, takeaways) and a single-line input (a title, a
 * location) get identical typing, filtering and keyboard handling from here.
 *
 * Positioning the dropdown at the caret (not just under the field) uses the
 * standard "mirror div" trick: an offscreen div with identical font/padding/
 * wrapping renders the text up to the caret, and the pixel position of its
 * last character is the caret's position.
 */
function useMention({
  value,
  onChange,
  fieldRef,
  multiline,
}: {
  value: string
  onChange: (value: string) => void
  fieldRef: React.RefObject<MentionField | null>
  multiline: boolean
}) {
  const mirrorRef = useRef<HTMLDivElement>(null)
  const options = useMentionOptions()

  const [mentionStart, setMentionStart] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [caretPos, setCaretPos] = useState({ top: 0, left: 0 })
  // Set right before a programmatic caret move so the next selection-based
  // recheck doesn't immediately reopen the menu it was just told to close.
  const suppressNextCheck = useRef(false)

  const matches = useMemo(() => {
    if (mentionStart === null) return []
    const needle = query.trim().toLowerCase()
    if (needle) {
      return options
        .filter((option) => option.label.toLowerCase().includes(needle))
        .slice(0, MAX_SUGGESTIONS)
    }
    // Nothing typed yet: take one from each kind in turn rather than the
    // first eight of a people-first list. Otherwise a well-connected account
    // shows eight contacts and nothing else, and there's no way to discover
    // that companies, jobs and places are taggable too.
    const byKind = new Map<MentionOption['kind'], MentionOption[]>()
    for (const option of options) {
      const bucket = byKind.get(option.kind)
      if (bucket) bucket.push(option)
      else byKind.set(option.kind, [option])
    }
    const buckets = [...byKind.values()]
    const spread: MentionOption[] = []
    for (let depth = 0; spread.length < MAX_SUGGESTIONS; depth++) {
      if (!buckets.some((bucket) => bucket.length > depth)) break
      for (const bucket of buckets) {
        if (bucket[depth] && spread.length < MAX_SUGGESTIONS) spread.push(bucket[depth])
      }
    }
    return spread
  }, [options, mentionStart, query])

  const open = mentionStart !== null && matches.length > 0

  /** Mirrors the field's box model so text lays out identically — anything
      that would change layout (font, padding, width) must match exactly. */
  const syncMirrorBox = useCallback(() => {
    const field = fieldRef.current
    const mirror = mirrorRef.current
    if (!field || !mirror) return
    const style = window.getComputedStyle(field)
    for (const prop of [
      'boxSizing',
      'fontFamily',
      'fontSize',
      'fontWeight',
      'lineHeight',
      'letterSpacing',
      'paddingTop',
      'paddingRight',
      'paddingBottom',
      'paddingLeft',
      'borderTopWidth',
      'borderRightWidth',
      'borderBottomWidth',
      'borderLeftWidth',
    ] as const) {
      mirror.style[prop] = style[prop]
    }
    // A single-line input never wraps, so its mirror must not either —
    // otherwise the caret measurement drifts as soon as the text is long
    // enough that the mirror would have wrapped it.
    mirror.style.whiteSpace = multiline ? style.whiteSpace : 'pre'
    mirror.style.wordWrap = multiline ? style.wordWrap : 'normal'
    mirror.style.width = multiline ? `${field.clientWidth}px` : 'auto'
  }, [fieldRef, multiline])

  const recheck = useCallback(
    (caret: number, text: string) => {
      if (suppressNextCheck.current) {
        suppressNextCheck.current = false
        return
      }
      const mention = activeMention(text, caret)
      if (!mention) {
        setMentionStart(null)
        return
      }
      setMentionStart(mention.start)
      setQuery(mention.query)
      setActiveIndex(0)

      syncMirrorBox()
      const mirror = mirrorRef.current
      const field = fieldRef.current
      if (!mirror || !field) return
      // Render everything up to the caret, then a marker to read its position off.
      mirror.textContent = text.slice(0, caret)
      const marker = document.createElement('span')
      marker.textContent = '​'
      mirror.appendChild(marker)
      const lineHeight = parseFloat(window.getComputedStyle(field).lineHeight) || 18
      setCaretPos(
        multiline
          ? {
              top: marker.offsetTop + lineHeight - field.scrollTop,
              left: Math.min(marker.offsetLeft, field.clientWidth - 4),
            }
          : {
              // One line means there's nothing to count down from — the menu
              // always hangs directly under the field.
              top: field.offsetHeight,
              left: Math.max(
                0,
                Math.min(marker.offsetLeft - field.scrollLeft, field.clientWidth - 4),
              ),
            },
      )
    },
    [fieldRef, multiline, syncMirrorBox],
  )

  function insert(option: MentionOption) {
    const field = fieldRef.current
    if (!field || mentionStart === null) return
    const caret = field.selectionStart ?? value.length
    const before = value.slice(0, mentionStart)
    const after = value.slice(caret)
    const tag = `@${option.tag} `
    const next = `${before}${tag}${after}`
    const nextCaret = before.length + tag.length

    suppressNextCheck.current = true
    setMentionStart(null)
    onChange(next)
    // The value prop updates asynchronously (it's owned by the parent), so
    // the caret can only be repositioned after that re-render lands.
    requestAnimationFrame(() => {
      field.setSelectionRange(nextCaret, nextCaret)
      field.focus()
    })
  }

  function handleKeyDown(event: React.KeyboardEvent<MentionField>) {
    if (!open) return false
    // stopPropagation matters here, not just preventDefault: the surrounding
    // Modal listens for Escape on `document`, so without it Escape-to-close-
    // the-menu also closes the whole dialog underneath — losing whatever was
    // typed — and Enter/Tab could still submit or move focus even though
    // this handled them.
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      event.stopPropagation()
      setActiveIndex((i) => (i + 1) % matches.length)
      return true
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      event.stopPropagation()
      setActiveIndex((i) => (i - 1 + matches.length) % matches.length)
      return true
    }
    if (event.key === 'Tab' || event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      insert(matches[activeIndex])
      return true
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      setMentionStart(null)
      return true
    }
    return false
  }

  // A click or arrow-key move can land the caret inside/outside a mention
  // token without any character changing, so selection changes need their
  // own recheck alongside onChange.
  useEffect(() => {
    const field = fieldRef.current
    if (!field) return
    const onSelectionChange = () => {
      if (document.activeElement !== field) return
      recheck(field.selectionStart ?? 0, field.value)
    }
    document.addEventListener('selectionchange', onSelectionChange)
    return () => document.removeEventListener('selectionchange', onSelectionChange)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, options])

  return {
    open,
    matches,
    activeIndex,
    setActiveIndex,
    caretPos,
    handleKeyDown,
    recheck,
    insert,
    close: () => setMentionStart(null),
    // Rendered by the hook rather than handed back as a ref, so the ref
    // itself never crosses out of here — measuring scratch space is an
    // implementation detail of the caret maths, not something a caller uses.
    mirror: (
      // Offscreen — never painted, only measured.
      <div
        ref={mirrorRef}
        aria-hidden="true"
        className={cx(
          'pointer-events-none absolute left-0 top-0 -z-10 overflow-hidden opacity-0',
          !multiline && 'whitespace-pre',
        )}
      />
    ),
  }
}

type Edit = { value: string; start: number; end: number }

/** Wraps (or unwraps) the selection in a marker pair. With nothing selected
    it drops the pair in and puts the caret between them, so you can turn
    formatting on and keep typing. */
function toggleWrap(value: string, start: number, end: number, marker: string): Edit {
  const selected = value.slice(start, end)
  const len = marker.length

  // Already wrapped, either inside the selection or just outside it.
  if (selected.length >= len * 2 && selected.startsWith(marker) && selected.endsWith(marker)) {
    const inner = selected.slice(len, -len)
    return {
      value: value.slice(0, start) + inner + value.slice(end),
      start,
      end: start + inner.length,
    }
  }
  if (value.slice(start - len, start) === marker && value.slice(end, end + len) === marker) {
    return {
      value: value.slice(0, start - len) + selected + value.slice(end + len),
      start: start - len,
      end: end - len,
    }
  }

  const wrapped = `${marker}${selected}${marker}`
  return {
    value: value.slice(0, start) + wrapped + value.slice(end),
    start: start + len,
    end: start + len + selected.length,
  }
}

/** Adds or removes a list prefix on every line the selection touches. */
function toggleLines(
  value: string,
  start: number,
  end: number,
  kind: 'bullet' | 'number',
): Edit {
  const from = value.lastIndexOf('\n', start - 1) + 1
  const toRaw = value.indexOf('\n', end)
  const to = toRaw === -1 ? value.length : toRaw
  const lines = value.slice(from, to).split('\n')
  const prefixOf = (index: number) => (kind === 'bullet' ? '- ' : `${index + 1}. `)
  const matches = (line: string) =>
    kind === 'bullet' ? line.startsWith('- ') : /^\d+\.\s/.test(line)

  // Only strip when every line already has it — a partly-listed selection
  // reads as "make all of these a list", not "unlist the ones that are".
  const allListed = lines.every((line) => !line.trim() || matches(line))
  const next = lines
    .map((line, index) => {
      if (!line.trim()) return line
      if (allListed) return line.replace(kind === 'bullet' ? /^- / : /^\d+\.\s/, '')
      return matches(line) ? line : prefixOf(index) + line
    })
    .join('\n')

  return { value: value.slice(0, from) + next + value.slice(to), start: from, end: from + next.length }
}

const TOOLS = [
  { key: 'bold', label: 'Bold', shortcut: 'b', icon: 'bold', marker: MARKERS.bold },
  { key: 'italic', label: 'Italic', shortcut: 'i', icon: 'italic', marker: MARKERS.italic },
  { key: 'underline', label: 'Underline', shortcut: 'u', icon: 'underline', marker: MARKERS.underline },
  { key: 'strike', label: 'Strikethrough', icon: 'strikethrough', marker: MARKERS.strike },
  { key: 'bullet', label: 'Bulleted list', icon: 'list', list: 'bullet' },
  { key: 'number', label: 'Numbered list', icon: 'listOrdered', list: 'number' },
] as const

function FormatToolbar({ onApply }: { onApply: (tool: (typeof TOOLS)[number]) => void }) {
  return (
    <div className="mb-1.5 flex flex-wrap items-center gap-0.5">
      {TOOLS.map((tool) => (
        <button
          key={tool.key}
          type="button"
          // mousedown, not click — the textarea keeps focus and its selection,
          // which is the whole input to the edit.
          onMouseDown={(event) => {
            event.preventDefault()
            onApply(tool)
          }}
          title={
            'shortcut' in tool ? `${tool.label} (⌘/Ctrl+${tool.shortcut.toUpperCase()})` : tool.label
          }
          aria-label={tool.label}
          className="grid size-7 place-items-center rounded-md text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <Icon name={tool.icon} size={14} />
        </button>
      ))}
    </div>
  )
}

/** The shared dropdown — identical for both field shapes. */
function MentionMenu({
  matches,
  activeIndex,
  caretPos,
  onPick,
  onHover,
}: {
  matches: MentionOption[]
  activeIndex: number
  caretPos: { top: number; left: number }
  onPick: (option: MentionOption) => void
  onHover: (index: number) => void
}) {
  return (
    <ul
      role="listbox"
      aria-label="Mention suggestions"
      className="scrollbar-thin absolute z-30 max-h-52 w-64 overflow-y-auto rounded-xl border border-line bg-surface-solid p-1 shadow-xl"
      style={{ top: caretPos.top, left: caretPos.left }}
    >
      {matches.map((option, index) => (
        <li key={option.key} role="option" aria-selected={index === activeIndex}>
          <button
            type="button"
            // mousedown, not click — fires before the field's blur, so the
            // mention state is still there to read.
            onMouseDown={(event) => {
              event.preventDefault()
              onPick(option)
            }}
            onMouseEnter={() => onHover(index)}
            className={cx(
              'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px]',
              index === activeIndex ? 'bg-brand-soft text-brand-strong' : 'text-ink',
            )}
          >
            <Icon
              name={MENTION_ICON[option.kind]}
              size={13}
              className={index === activeIndex ? 'text-brand-strong' : 'text-ink-3'}
            />
            <span className="min-w-0 flex-1 truncate">{option.label}</span>
            {option.hint ? (
              <span className="shrink-0 truncate text-[11px] text-ink-3">{option.hint}</span>
            ) : null}
          </button>
        </li>
      ))}
    </ul>
  )
}

type SharedProps = {
  label?: string
  error?: string
  help?: string
  wrapperClassName?: string
  value: string
  onChange: (value: string) => void
}

type MentionTextareaProps = Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  'value' | 'onChange'
> &
  SharedProps & {
    /** Formatting buttons above the field. On by default — every use of this
        component is a notes field. */
    toolbar?: boolean
    /** Ceiling for the auto-grow, past which it scrolls instead of pushing
        the rest of the form off screen. */
    maxHeight?: number
  }

/**
 * A `Textarea` that offers @mention autocomplete over the account's own
 * people, companies, cities and venues — type `@`, keep typing to narrow the
 * list, then Tab/Enter to accept the highlighted match or Arrow keys to move
 * through it.
 *
 * Deliberately plain-text: accepting a suggestion inserts `@TheirName` as
 * literal characters, the same way Slack or Notion's "@" quick-mention
 * inserts a name before you've necessarily linked anything — this isn't a
 * relational field, and the note stays a normal string everywhere else in
 * the app reads it.
 */
export function MentionTextarea({
  label,
  error,
  help,
  wrapperClassName,
  className,
  value,
  onChange,
  id: providedId,
  onKeyDown,
  toolbar = true,
  maxHeight = 520,
  ...rest
}: MentionTextareaProps) {
  const generatedId = useId()
  const id = providedId ?? generatedId
  const fieldRef = useRef<HTMLTextAreaElement>(null)
  const mention = useMention({ value, onChange, fieldRef, multiline: true })

  // Grow with the text instead of making you scroll a three-line window —
  // notes routinely run long. Height is read back off scrollHeight rather
  // than counted from the string, so wrapped lines stay honest. Past
  // `maxHeight` it scrolls (overflow-y-auto) rather than pushing the rest of
  // the form off screen. Still `resize-y`, so a manual drag wins until the
  // next keystroke.
  useEffect(() => {
    const field = fieldRef.current
    if (!field) return
    field.style.height = 'auto'
    field.style.height = `${Math.min(field.scrollHeight, maxHeight)}px`
  }, [value, maxHeight])

  /** Runs a toolbar action against the live selection, then restores it so
      you can keep typing (or hit the same button again to toggle back). */
  function applyTool(tool: (typeof TOOLS)[number]) {
    const field = fieldRef.current
    if (!field) return
    const { selectionStart: start, selectionEnd: end } = field
    const edit =
      'list' in tool
        ? toggleLines(value, start, end, tool.list)
        : toggleWrap(value, start, end, tool.marker)
    onChange(edit.value)
    requestAnimationFrame(() => {
      field.focus()
      field.setSelectionRange(edit.start, edit.end)
    })
  }

  return (
    <FieldShell label={label} error={error} help={help} id={id} className={wrapperClassName}>
      {toolbar ? <FormatToolbar onApply={applyTool} /> : null}
      <div className="relative">
        <textarea
          ref={fieldRef}
          id={id}
          rows={3}
          aria-invalid={error ? true : undefined}
          value={value}
          onChange={(event) => {
            onChange(event.target.value)
            mention.recheck(event.target.selectionStart, event.target.value)
          }}
          onKeyDown={(event) => {
            if (mention.handleKeyDown(event)) return
            if (toolbar && (event.metaKey || event.ctrlKey)) {
              const tool = TOOLS.find(
                (candidate) =>
                  'shortcut' in candidate && candidate.shortcut === event.key.toLowerCase(),
              )
              if (tool) {
                event.preventDefault()
                applyTool(tool)
                return
              }
            }
            onKeyDown?.(event)
          }}
          onBlur={mention.close}
          className={cx(
            'w-full resize-y overflow-y-auto rounded-lg border border-line bg-surface px-3 py-2 text-[13.5px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-brand-ring',
            error && 'border-critical',
            className,
          )}
          {...rest}
        />

        {mention.mirror}

        {mention.open ? (
          <MentionMenu
            matches={mention.matches}
            activeIndex={mention.activeIndex}
            caretPos={mention.caretPos}
            onPick={mention.insert}
            onHover={mention.setActiveIndex}
          />
        ) : null}
      </div>
    </FieldShell>
  )
}

type MentionInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> &
  SharedProps

/**
 * The single-line twin of `MentionTextarea` — same `@` behaviour, for the
 * fields that are one line by nature (a title, a place, a label). Kept as a
 * separate component rather than a mode flag so call sites read like the
 * plain `Input` they replace.
 */
export function MentionInput({
  label,
  error,
  help,
  wrapperClassName,
  className,
  value,
  onChange,
  id: providedId,
  onKeyDown,
  ...rest
}: MentionInputProps) {
  const generatedId = useId()
  const id = providedId ?? generatedId
  const fieldRef = useRef<HTMLInputElement>(null)
  const mention = useMention({ value, onChange, fieldRef, multiline: false })

  return (
    <FieldShell label={label} error={error} help={help} id={id} className={wrapperClassName}>
      <div className="relative">
        <input
          ref={fieldRef}
          id={id}
          type="text"
          aria-invalid={error ? true : undefined}
          value={value}
          onChange={(event) => {
            onChange(event.target.value)
            mention.recheck(event.target.selectionStart ?? 0, event.target.value)
          }}
          onKeyDown={(event) => {
            if (mention.handleKeyDown(event)) return
            onKeyDown?.(event)
          }}
          onBlur={mention.close}
          className={cx(
            'h-10 w-full rounded-lg border border-line bg-surface px-3 text-[13.5px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-brand-ring',
            error && 'border-critical',
            className,
          )}
          {...rest}
        />

        {mention.mirror}

        {mention.open ? (
          <MentionMenu
            matches={mention.matches}
            activeIndex={mention.activeIndex}
            caretPos={mention.caretPos}
            onPick={mention.insert}
            onHover={mention.setActiveIndex}
          />
        ) : null}
      </div>
    </FieldShell>
  )
}
