import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { cx } from '../../lib/format'
import { serializeRichDom } from '../../lib/richText'
import { Icon } from '../ui/Icon'

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

/**
 * Ticket Activity composer — grows with the message, shows real formatting
 * while typing (not `**bold**` markers), and serializes to the same plain-text
 * markers `RichText` renders in the timeline.
 */
export function TicketComposer({
  disabled,
  sending,
  hasAttachment,
  onSend,
  fileSlot,
  sendSlot,
}: {
  disabled?: boolean
  sending?: boolean
  hasAttachment?: boolean
  onSend: (body: string) => void | Promise<void>
  fileSlot: ReactNode
  sendSlot: (props: { disabled: boolean }) => ReactNode
}) {
  const editorRef = useRef<HTMLDivElement>(null)
  const [empty, setEmpty] = useState(true)

  function syncEmpty() {
    const el = editorRef.current
    if (!el) return
    const text = el.innerText.replace(/\u00a0/g, ' ').trim()
    const hasRule = Boolean(el.querySelector('hr'))
    setEmpty(!text && !hasRule)
  }

  useEffect(() => {
    editorRef.current?.focus()
  }, [])

  function run(command: string) {
    editorRef.current?.focus()
    document.execCommand(command, false)
    syncEmpty()
  }

  function insertRule(kind: 'dashed' | 'dotted') {
    editorRef.current?.focus()
    const hr =
      kind === 'dotted'
        ? '<hr data-rule="dotted" class="ticket-rule ticket-rule-dotted">'
        : '<hr data-rule="dashed" class="ticket-rule ticket-rule-dashed">'
    document.execCommand('insertHTML', false, `${hr}<p><br></p>`)
    syncEmpty()
  }

  function clear() {
    const el = editorRef.current
    if (!el) return
    el.innerHTML = ''
    setEmpty(true)
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault()
    const el = editorRef.current
    if (!el || disabled || sending) return
    const body = serializeRichDom(el)
    if (!body && !hasAttachment) return
    const before = el.innerHTML
    try {
      await onSend(body)
      clear()
    } catch {
      // Parent toasts; keep the draft so a failed send isn't lost.
      if (editorRef.current && !editorRef.current.innerHTML) {
        editorRef.current.innerHTML = before
        syncEmpty()
      }
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if ((event.metaKey || event.ctrlKey) && !event.altKey) {
      const tool = TOOLS.find(
        (candidate) =>
          'shortcut' in candidate && candidate.shortcut === event.key.toLowerCase(),
      )
      if (tool && 'command' in tool) {
        event.preventDefault()
        run(tool.command)
        return
      }
    }
    // Enter sends; Shift+Enter keeps a newline. Inside a list, Enter adds
    // another bullet / number the way people expect.
    if (event.key === 'Enter' && !event.shiftKey) {
      const node = document.getSelection()?.anchorNode
      const el =
        node instanceof Element ? node : node?.parentElement ?? null
      if (el?.closest('li')) return
      event.preventDefault()
      void submit()
    }
  }

  function onPaste(event: ClipboardEvent<HTMLDivElement>) {
    // Keep paste as text so we don't drag in foreign HTML styles.
    event.preventDefault()
    const text = event.clipboardData.getData('text/plain')
    document.execCommand('insertText', false, text)
    syncEmpty()
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="rounded-xl border border-line/80 bg-surface-2/40 focus-within:border-brand-ring"
    >
      <div className="flex flex-wrap items-center gap-0.5 border-b border-line/60 px-1.5 py-1">
        {TOOLS.map((tool) => (
          <button
            key={tool.key}
            type="button"
            disabled={disabled || sending}
            onMouseDown={(event) => {
              event.preventDefault()
              if ('rule' in tool) insertRule(tool.rule)
              else run(tool.command)
            }}
            title={
              'shortcut' in tool
                ? `${tool.label} (⌘/Ctrl+${tool.shortcut.toUpperCase()})`
                : tool.label
            }
            aria-label={tool.label}
            className="grid size-7 place-items-center rounded-md text-ink-3 transition-colors hover:bg-surface/70 hover:text-ink disabled:opacity-40"
          >
            <Icon name={tool.icon} size={14} />
          </button>
        ))}
      </div>

      <div
        ref={editorRef}
        role="textbox"
        aria-multiline="true"
        aria-label="Ticket message"
        aria-placeholder="Type your message here…"
        contentEditable={!disabled && !sending}
        suppressContentEditableWarning
        data-empty={empty ? 'true' : 'false'}
        onInput={syncEmpty}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        className={cx(
          'ticket-composer max-h-40 min-h-[2.5rem] overflow-y-auto px-2.5 py-2 text-[12.5px] leading-relaxed text-ink outline-none',
          '[&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5',
          '[&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-5',
          '[&_b]:font-semibold [&_strong]:font-semibold',
          '[&_i]:italic [&_em]:italic',
          '[&_u]:underline',
          '[&_s]:line-through [&_strike]:line-through',
          'data-[empty=true]:before:pointer-events-none data-[empty=true]:before:text-ink-3 data-[empty=true]:before:content-[attr(aria-placeholder)]',
        )}
      />

      <div className="flex items-center gap-1.5 border-t border-line/60 px-1.5 py-1.5">
        {fileSlot}
        <div className="min-w-0 flex-1" />
        {sendSlot({ disabled: Boolean(disabled || sending || (empty && !hasAttachment)) })}
      </div>
    </form>
  )
}
