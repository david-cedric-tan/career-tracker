import { Fragment, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Avatar } from '../components/ui/Avatar'
import { Icon } from '../components/ui/Icon'
import { useMentionResolver, type MentionTarget } from './mentionLinksContext'

import { MARKERS, RULE_MARKERS } from './richTextMarkers'

/**
 * Lightweight markdown for notes — the formatting the toolbar can produce,
 * and nothing else.
 *
 * Notes are stored as plain text on purpose, not HTML: `@mentions` are
 * literal characters (see `Mention.tsx`), the "Tagged In" lookup finds them
 * with a substring search, the backend's search does the same, and an export
 * stays readable in a spreadsheet. Formatting therefore has to survive as
 * markers in that same plain text, and this is the half that turns them back
 * into elements for display.
 *
 * Hand-rolled rather than a markdown library plus a sanitiser: the input is
 * escaped before a single tag is introduced, so there's no path for raw HTML
 * in a note to reach the DOM, and the supported set stays exactly what the
 * toolbar writes.
 */

const BULLET = '- '
const NUMBERED = /^(\d+)\.\s/
const DASHED_RULE = /^\s*-{3,}\s*$/
const DOTTED_RULE = /^\s*[.·]{3,}\s*$/

/** Ordered longest-first so `**` is consumed before `*`, and `__` before `_`. */
const INLINE: { marker: string; render: (children: ReactNode, key: string) => ReactNode }[] = [
  { marker: MARKERS.bold, render: (c, k) => <strong key={k}>{c}</strong> },
  { marker: MARKERS.underline, render: (c, k) => <u key={k}>{c}</u> },
  { marker: MARKERS.strike, render: (c, k) => <s key={k}>{c}</s> },
  { marker: MARKERS.italic, render: (c, k) => <em key={k}>{c}</em> },
]

/** A mention rendered as a chip, so tags stand out the way they do while
    typing. Internal punctuation is part of the name ("@J.R.Smith"), but a
    trailing one is the sentence's, not the tag's. */
// Internal punctuation is part of the tag — "@J.R.Smith", and the comma a
// venue keeps from its name ("@ThePillars,Wynyard") — but a trailing one is
// ordinary sentence punctuation.
const MENTION = /(@[\p{L}\p{N}_]+(?:[.'\-,][\p{L}\p{N}_]+)*)/u

type MentionRender = (tag: string, key: string) => ReactNode

/** A tag that points at a record becomes a link; anything else stays a chip. */
function MentionChip({ tag, target, from }: { tag: string; target: MentionTarget | null; from: string }) {
  const chip = 'inline-flex items-center gap-1 rounded bg-brand-soft px-1 font-medium text-brand-strong'
  if (!target) return <span className={chip}>{tag}</span>
  return (
    <Link to={target.href} state={{ from }} className={`${chip} hover:underline`} title={target.label}>
      {target.kind === 'person' ? (
        <Avatar name={target.label} src={target.image} size="xxs" className="!size-4 !text-[8px]" />
      ) : target.kind === 'company' || target.kind === 'application' ? (
        <Avatar name={target.label} src={target.image} size="xxs" shape="square" className="!size-4 !text-[8px]" />
      ) : (
        <Icon name="mapPin" size={11} />
      )}
      {tag}
    </Link>
  )
}

/** Plain text, with line breaks kept — inline markers are matched across a
    whole paragraph, so the text reaching here can still span lines. */
function renderText(text: string, keyPrefix: string): ReactNode {
  const lines = text.split('\n')
  if (lines.length === 1) return text
  return lines.map((line, index) => (
    <Fragment key={`${keyPrefix}-l${index}`}>
      {index > 0 ? <br /> : null}
      {line}
    </Fragment>
  ))
}

function renderMentions(text: string, keyPrefix: string, mention: MentionRender): ReactNode[] {
  return text.split(MENTION).map((part, index) => {
    const key = `${keyPrefix}-m${index}`
    if (!part.startsWith('@') || part.length < 2) {
      return <Fragment key={key}>{renderText(part, key)}</Fragment>
    }
    return <Fragment key={key}>{mention(part, key)}</Fragment>
  })
}

/**
 * Applies one inline marker across a string, recursing so `**bold *and
 * italic* **` nests. Splits on the marker and treats every odd segment as
 * wrapped — an unpaired marker just stays literal text.
 */
function renderInline(
  text: string,
  depth: number,
  keyPrefix: string,
  mention: MentionRender,
): ReactNode[] {
  const rule = INLINE[depth]
  if (!rule) return renderMentions(text, keyPrefix, mention)

  const parts = text.split(rule.marker)
  // No pair found — nothing to do at this level.
  if (parts.length < 3) return renderInline(text, depth + 1, keyPrefix, mention)

  const out: ReactNode[] = []
  parts.forEach((part, index) => {
    const key = `${keyPrefix}-${depth}-${index}`
    // An odd index sits between two markers; a trailing unpaired marker means
    // the last segment isn't really wrapped, so put its marker back.
    const wrapped = index % 2 === 1
    const unpairedTail = wrapped && index === parts.length - 1
    if (wrapped && !unpairedTail) {
      out.push(rule.render(renderInline(part, depth + 1, key, mention), key))
    } else {
      const literal = unpairedTail ? `${rule.marker}${part}` : part
      out.push(<Fragment key={key}>{renderInline(literal, depth + 1, key, mention)}</Fragment>)
    }
  })
  return out
}

type Block =
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[]; start: number }
  | { kind: 'hr'; style: 'dashed' | 'dotted' }
  | { kind: 'p'; lines: string[] }

/** Groups consecutive lines into lists, rules and paragraphs. */
function toBlocks(text: string): Block[] {
  const blocks: Block[] = []
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.trimEnd()
    const numbered = line.match(NUMBERED)
    const last = blocks[blocks.length - 1]

    if (DASHED_RULE.test(line) || line.trim() === RULE_MARKERS.dashed) {
      blocks.push({ kind: 'hr', style: 'dashed' })
    } else if (DOTTED_RULE.test(line) || line.trim() === RULE_MARKERS.dotted) {
      blocks.push({ kind: 'hr', style: 'dotted' })
    } else if (line.startsWith(BULLET)) {
      const item = line.slice(BULLET.length)
      if (last?.kind === 'ul') last.items.push(item)
      else blocks.push({ kind: 'ul', items: [item] })
    } else if (numbered) {
      const item = line.slice(numbered[0].length)
      if (last?.kind === 'ol') last.items.push(item)
      else blocks.push({ kind: 'ol', items: [item], start: Number(numbered[1]) || 1 })
    } else if (!line.trim()) {
      // A blank line ends whatever block was open.
      if (last?.kind === 'p') blocks.push({ kind: 'p', lines: [] })
    } else if (last?.kind === 'p') {
      last.lines.push(line)
    } else {
      blocks.push({ kind: 'p', lines: [line] })
    }
  }
  return blocks.filter((block) => (block.kind === 'p' ? block.lines.length > 0 : true))
}

/**
 * Renders a note. Returns null for empty text so callers can fall back to
 * their own placeholder.
 */
export function RichText({ text, className }: { text: string; className?: string }) {
  const resolve = useMentionResolver()
  const location = useLocation()
  const from = `${location.pathname}${location.search}`
  const mention: MentionRender = (tag, key) => (
    <MentionChip key={key} tag={tag} target={resolve(tag)} from={from} />
  )

  if (!text.trim()) return null

  const blocks = toBlocks(text)

  return (
    <div className={className}>
      {blocks.map((block, index) => {
        if (block.kind === 'ul') {
          return (
            <ul key={index} className="my-1 list-disc space-y-0.5 pl-5">
              {block.items.map((item, i) => (
                <li key={i}>{renderInline(item, 0, `${index}-${i}`, mention)}</li>
              ))}
            </ul>
          )
        }
        if (block.kind === 'ol') {
          return (
            <ol key={index} start={block.start} className="my-1 list-decimal space-y-0.5 pl-5">
              {block.items.map((item, i) => (
                <li key={i}>{renderInline(item, 0, `${index}-${i}`, mention)}</li>
              ))}
            </ol>
          )
        }
        if (block.kind === 'hr') {
          return (
            <hr
              key={index}
              className={
                block.style === 'dotted'
                  ? 'my-2.5 border-0 border-t-2 border-dotted border-current opacity-45'
                  : 'my-2.5 border-0 border-t border-dashed border-current opacity-45'
              }
            />
          )
        }
        // The whole paragraph at once, not line by line: the editor happily
        // bolds a selection that crosses a line break, which stores as
        // `**first line\nsecond**` — per-line matching never paired those and
        // showed the markers raw.
        return (
          <p key={index} className="my-1 first:mt-0 last:mb-0">
            {renderInline(block.lines.join('\n'), 0, `${index}`, mention)}
          </p>
        )
      })}
    </div>
  )
}

/**
 * Turn a contentEditable subtree into the same marker plain text `RichText`
 * reads — so the ticket composer can look formatted while storage stays plain.
 */
export function serializeRichDom(root: HTMLElement): string {
  const parts: string[] = []

  function wrap(inner: string, marker: string) {
    if (!inner) return ''
    return `${marker}${inner}${marker}`
  }

  function walk(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
    if (node.nodeType !== Node.ELEMENT_NODE) return ''

    const el = node as HTMLElement
    const tag = el.tagName.toLowerCase()
    const kids = Array.from(el.childNodes).map(walk).join('')

    if (tag === 'br') return '\n'
    if (tag === 'hr') {
      return el.dataset.rule === 'dotted'
        ? `\n${RULE_MARKERS.dotted}\n`
        : `\n${RULE_MARKERS.dashed}\n`
    }
    if (tag === 'strong' || tag === 'b') return wrap(kids, MARKERS.bold)
    if (tag === 'em' || tag === 'i') return wrap(kids, MARKERS.italic)
    if (tag === 'u') return wrap(kids, MARKERS.underline)
    if (tag === 's' || tag === 'strike' || tag === 'del') return wrap(kids, MARKERS.strike)
    if (tag === 'ul') {
      return (
        Array.from(el.children)
          .map((li) => `- ${walk(li).replace(/\n+/g, ' ').trim()}`)
          .filter(Boolean)
          .join('\n') + '\n'
      )
    }
    if (tag === 'ol') {
      return (
        Array.from(el.children)
          .map((li, index) => `${index + 1}. ${walk(li).replace(/\n+/g, ' ').trim()}`)
          .filter(Boolean)
          .join('\n') + '\n'
      )
    }
    if (tag === 'li') return kids
    if (tag === 'div' || tag === 'p' || tag === 'blockquote') {
      const body = kids.replace(/\n+$/, '')
      return body ? `${body}\n` : '\n'
    }
    return kids
  }

  for (const child of Array.from(root.childNodes)) {
    parts.push(walk(child))
  }

  return parts
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Marker → HTML for a contentEditable surface (inverse of `serializeRichDom`). */
function inlineMarkersToHtml(text: string, depth = 0): string {
  const rule = INLINE[depth]
  if (!rule) return escapeHtml(text)

  const parts = text.split(rule.marker)
  if (parts.length < 3) return inlineMarkersToHtml(text, depth + 1)

  let out = ''
  parts.forEach((part, index) => {
    const wrapped = index % 2 === 1
    const unpairedTail = wrapped && index === parts.length - 1
    if (wrapped && !unpairedTail) {
      const tag =
        rule.marker === MARKERS.bold
          ? 'strong'
          : rule.marker === MARKERS.underline
            ? 'u'
            : rule.marker === MARKERS.strike
              ? 's'
              : 'em'
      out += `<${tag}>${inlineMarkersToHtml(part, depth + 1)}</${tag}>`
    } else {
      const literal = unpairedTail ? `${rule.marker}${part}` : part
      out += inlineMarkersToHtml(literal, depth + 1)
    }
  })
  return out
}

/**
 * Turn stored marker plain text into HTML the notes editor can show with
 * real bold / lists / rules — kept in sync with `serializeRichDom`.
 */
export function markersToHtml(text: string): string {
  if (!text.trim()) return ''
  return toBlocks(text)
    .map((block) => {
      if (block.kind === 'ul') {
        return `<ul>${block.items
          .map((item) => `<li>${inlineMarkersToHtml(item)}</li>`)
          .join('')}</ul>`
      }
      if (block.kind === 'ol') {
        return `<ol start="${block.start}">${block.items
          .map((item) => `<li>${inlineMarkersToHtml(item)}</li>`)
          .join('')}</ol>`
      }
      if (block.kind === 'hr') {
        return block.style === 'dotted'
          ? '<hr data-rule="dotted" class="ticket-rule ticket-rule-dotted">'
          : '<hr data-rule="dashed" class="ticket-rule ticket-rule-dashed">'
      }
      return `<p>${block.lines.map((line) => inlineMarkersToHtml(line)).join('<br>')}</p>`
    })
    .join('')
}
