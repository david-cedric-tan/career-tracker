import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type InputHTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
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
import { markersToHtml, serializeRichDom } from '../../lib/richText'
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

/** Toolbar actions for the WYSIWYG notes editor. */
const TOOLS = [
  { key: 'bold', label: 'Bold', shortcut: 'b', icon: 'bold', command: 'bold' },
  { key: 'italic', label: 'Italic', shortcut: 'i', icon: 'italic', command: 'italic' },
  { key: 'underline', label: 'Underline', shortcut: 'u', icon: 'underline', command: 'underline' },
  { key: 'strike', label: 'Strikethrough', icon: 'strikethrough', command: 'strikeThrough' },
  { key: 'bullet', label: 'Bulleted list', icon: 'list', command: 'insertUnorderedList' },
  { key: 'number', label: 'Numbered list', icon: 'listOrdered', command: 'insertOrderedList' },
  { key: 'dashed', label: 'Dashed line', icon: 'lineDashed', rule: 'dashed' as const },
  { key: 'dotted', label: 'Dotted line', icon: 'lineDotted', rule: 'dotted' as const },
] as const

function FormatToolbar({ onApply }: { onApply: (tool: (typeof TOOLS)[number]) => void }) {
  return (
    <div className="mb-1.5 flex flex-wrap items-center gap-0.5">
      {TOOLS.map((tool) => (
        <button
          key={tool.key}
          type="button"
          // mousedown, not click — the editor keeps focus and its selection,
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

type MentionTextareaProps = SharedProps & {
  /** Formatting buttons above the field. On by default — every use of this
      component is a notes field. */
  toolbar?: boolean
  /** Ceiling for the auto-grow, past which it scrolls instead of pushing
      the rest of the form off screen. */
  maxHeight?: number
  rows?: number
  placeholder?: string
  disabled?: boolean
  id?: string
  className?: string
  onKeyDown?: (event: ReactKeyboardEvent<HTMLDivElement>) => void
}

function caretPlainContext(root: HTMLElement): { text: string; caret: number } | null {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return null
  const range = sel.getRangeAt(0)
  if (!root.contains(range.startContainer)) return null
  const before = range.cloneRange()
  before.selectNodeContents(root)
  before.setEnd(range.startContainer, range.startOffset)
  const prefix = before.toString()
  return { text: root.innerText.replace(/\u00a0/g, ' '), caret: prefix.length }
}

/**
 * A notes field that shows formatting live (bold, lists, rules) while still
 * storing the same marker plain text `RichText` reads back — and keeps `@`
 * mentions as literal tags.
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
  rows = 3,
  placeholder,
  disabled,
}: MentionTextareaProps) {
  const generatedId = useId()
  const id = providedId ?? generatedId
  const editorRef = useRef<HTMLDivElement>(null)
  const lastEmitted = useRef(value)
  const suppressMention = useRef(false)
  const options = useMentionOptions()

  const [empty, setEmpty] = useState(!value.trim())
  const [mentionStart, setMentionStart] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [caretPos, setCaretPos] = useState({ top: 0, left: 0 })

  const matches = useMemo(() => {
    if (mentionStart === null) return []
    const needle = query.trim().toLowerCase()
    if (needle) {
      return options
        .filter((option) => option.label.toLowerCase().includes(needle))
        .slice(0, MAX_SUGGESTIONS)
    }
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

  const mentionOpen = mentionStart !== null && matches.length > 0

  function paint(next: string) {
    const el = editorRef.current
    if (!el) return
    el.innerHTML = markersToHtml(next) || ''
    const text = el.innerText.replace(/\u00a0/g, ' ').trim()
    setEmpty(!text && !el.querySelector('hr'))
  }

  // External value changes (form reset / load) — not our own keystrokes.
  useEffect(() => {
    if (value === lastEmitted.current) return
    lastEmitted.current = value
    paint(value)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- paint closes over editorRef
  }, [value])

  useEffect(() => {
    paint(value)
    // initial mount only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const el = editorRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(Math.max(el.scrollHeight, rows * 24), maxHeight)}px`
  }, [value, maxHeight, rows, empty])

  const recheckMention = useCallback(() => {
    if (suppressMention.current) {
      suppressMention.current = false
      return
    }
    const el = editorRef.current
    if (!el) return
    const ctx = caretPlainContext(el)
    if (!ctx) {
      setMentionStart(null)
      return
    }
    const mention = activeMention(ctx.text, ctx.caret)
    if (!mention) {
      setMentionStart(null)
      return
    }
    setMentionStart(mention.start)
    setQuery(mention.query)
    setActiveIndex(0)

    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return
    const rect = sel.getRangeAt(0).getBoundingClientRect()
    const box = el.getBoundingClientRect()
    setCaretPos({
      top: rect.bottom - box.top + el.scrollTop + 4,
      left: Math.min(Math.max(0, rect.left - box.left), el.clientWidth - 8),
    })
  }, [])

  function emit() {
    const el = editorRef.current
    if (!el) return
    const next = serializeRichDom(el)
    lastEmitted.current = next
    const text = el.innerText.replace(/\u00a0/g, ' ').trim()
    setEmpty(!text && !el.querySelector('hr'))
    onChange(next)
    recheckMention()
  }

  function insertMention(option: MentionOption) {
    const el = editorRef.current
    if (!el || mentionStart === null) return
    const ctx = caretPlainContext(el)
    if (!ctx) return
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return

    // Replace "@query" by deleting backward from the caret, then insert the tag.
    const deleteCount = ctx.caret - mentionStart
    for (let i = 0; i < deleteCount; i++) {
      document.execCommand('delete', false)
    }
    suppressMention.current = true
    setMentionStart(null)
    document.execCommand('insertText', false, `@${option.tag} `)
    emit()
    el.focus()
  }

  function applyTool(tool: (typeof TOOLS)[number]) {
    const el = editorRef.current
    if (!el || disabled) return
    el.focus()
    if ('rule' in tool) {
      const hr =
        tool.rule === 'dotted'
          ? '<hr data-rule="dotted" class="ticket-rule ticket-rule-dotted">'
          : '<hr data-rule="dashed" class="ticket-rule ticket-rule-dashed">'
      document.execCommand('insertHTML', false, `${hr}<p><br></p>`)
    } else {
      document.execCommand(tool.command, false)
    }
    emit()
  }

  function onPaste(event: ClipboardEvent<HTMLDivElement>) {
    event.preventDefault()
    const html = event.clipboardData.getData('text/html')
    const plain = event.clipboardData.getData('text/plain')

    function insertPlain(text: string) {
      const escaped = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
      const blocks = escaped
        .split(/\r\n|\r|\n/)
        .map((line) => `<p>${line || '<br>'}</p>`)
        .join('')
      document.execCommand('insertHTML', false, blocks || '<p><br></p>')
    }

    if (html) {
      const tmp = document.createElement('div')
      tmp.innerHTML = html
      const markers = serializeRichDom(tmp)
      const meaningful = markers.replace(/[\s*\-_#.·]/g, '')
      const plainMeaningful = plain.replace(/\s/g, '')
      // Word / Docs often paste a lone rule or nearly empty HTML — fall back
      // to the plain text so multi-line notes survive.
      if (safeEnough(meaningful, plainMeaningful)) {
        const safe = markersToHtml(markers)
        if (safe) document.execCommand('insertHTML', false, safe)
        else insertPlain(plain)
      } else if (plain) {
        insertPlain(plain)
      } else {
        const safe = markersToHtml(markers)
        if (safe) document.execCommand('insertHTML', false, safe)
      }
    } else if (plain) {
      insertPlain(plain)
    }
    emit()
  }

  function safeEnough(fromHtml: string, fromPlain: string) {
    if (!fromHtml) return false
    if (!fromPlain) return true
    return fromHtml.length >= Math.max(8, fromPlain.length * 0.35)
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (mentionOpen) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        event.stopPropagation()
        setActiveIndex((i) => (i + 1) % matches.length)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        event.stopPropagation()
        setActiveIndex((i) => (i - 1 + matches.length) % matches.length)
        return
      }
      if (event.key === 'Tab' || event.key === 'Enter') {
        event.preventDefault()
        event.stopPropagation()
        insertMention(matches[activeIndex])
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        setMentionStart(null)
        return
      }
    }

    if (toolbar && (event.metaKey || event.ctrlKey) && !event.altKey) {
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
  }

  useEffect(() => {
    const onSelectionChange = () => {
      const el = editorRef.current
      if (!el || document.activeElement !== el) return
      recheckMention()
    }
    document.addEventListener('selectionchange', onSelectionChange)
    return () => document.removeEventListener('selectionchange', onSelectionChange)
  }, [recheckMention])

  return (
    <FieldShell label={label} error={error} help={help} id={id} className={wrapperClassName}>
      {toolbar ? <FormatToolbar onApply={applyTool} /> : null}
      <div className="relative">
        <div
          ref={editorRef}
          id={id}
          role="textbox"
          aria-multiline="true"
          aria-invalid={error ? true : undefined}
          aria-label={label || placeholder || 'Notes'}
          aria-placeholder={placeholder}
          contentEditable={!disabled}
          suppressContentEditableWarning
          data-empty={empty ? 'true' : 'false'}
          onInput={emit}
          onKeyDown={handleKeyDown}
          onPaste={onPaste}
          onBlur={() => setMentionStart(null)}
          className={cx(
            'rich-notes-editor w-full resize-y overflow-y-auto rounded-lg border border-line bg-surface px-3 py-2 text-[13.5px] leading-relaxed text-ink outline-none transition-colors focus:border-brand-ring',
            '[&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5',
            '[&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-5',
            '[&_b]:font-semibold [&_strong]:font-semibold',
            '[&_i]:italic [&_em]:italic',
            '[&_u]:underline',
            '[&_s]:line-through [&_strike]:line-through',
            'data-[empty=true]:before:pointer-events-none data-[empty=true]:before:text-ink-3 data-[empty=true]:before:content-[attr(aria-placeholder)]',
            error && 'border-critical',
            disabled && 'cursor-not-allowed opacity-60',
            className,
          )}
          style={{ minHeight: `${Math.max(rows, 2) * 1.5}rem`, maxHeight }}
        />

        {mentionOpen ? (
          <MentionMenu
            matches={matches}
            activeIndex={activeIndex}
            caretPos={caretPos}
            onPick={insertMention}
            onHover={setActiveIndex}
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
