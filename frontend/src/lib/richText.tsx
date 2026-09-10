import { Fragment, type ReactNode } from 'react'

import { MARKERS } from './richTextMarkers'

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
const MENTION = /(@[\p{L}\p{N}_]+(?:[.'-][\p{L}\p{N}_]+)*)/u

function renderMentions(text: string, keyPrefix: string): ReactNode[] {
  return text.split(MENTION).map((part, index) => {
    const key = `${keyPrefix}-m${index}`
    if (!part.startsWith('@') || part.length < 2) return <Fragment key={key}>{part}</Fragment>
    return (
      <span key={key} className="rounded bg-brand-soft px-1 font-medium text-brand-strong">
        {part}
      </span>
    )
  })
}

/**
 * Applies one inline marker across a string, recursing so `**bold *and
 * italic* **` nests. Splits on the marker and treats every odd segment as
 * wrapped — an unpaired marker just stays literal text.
 */
function renderInline(text: string, depth: number, keyPrefix: string): ReactNode[] {
  const rule = INLINE[depth]
  if (!rule) return renderMentions(text, keyPrefix)

  const parts = text.split(rule.marker)
  // No pair found — nothing to do at this level.
  if (parts.length < 3) return renderInline(text, depth + 1, keyPrefix)

  const out: ReactNode[] = []
  parts.forEach((part, index) => {
    const key = `${keyPrefix}-${depth}-${index}`
    // An odd index sits between two markers; a trailing unpaired marker means
    // the last segment isn't really wrapped, so put its marker back.
    const wrapped = index % 2 === 1
    const unpairedTail = wrapped && index === parts.length - 1
    if (wrapped && !unpairedTail) {
      out.push(rule.render(renderInline(part, depth + 1, key), key))
    } else {
      const literal = unpairedTail ? `${rule.marker}${part}` : part
      out.push(<Fragment key={key}>{renderInline(literal, depth + 1, key)}</Fragment>)
    }
  })
  return out
}

type Block =
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[]; start: number }
  | { kind: 'p'; lines: string[] }

/** Groups consecutive lines into lists and paragraphs. */
function toBlocks(text: string): Block[] {
  const blocks: Block[] = []
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.trimEnd()
    const numbered = line.match(NUMBERED)
    const last = blocks[blocks.length - 1]

    if (line.startsWith(BULLET)) {
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
  if (!text.trim()) return null

  const blocks = toBlocks(text)

  return (
    <div className={className}>
      {blocks.map((block, index) => {
        if (block.kind === 'ul') {
          return (
            <ul key={index} className="my-1 list-disc space-y-0.5 pl-5">
              {block.items.map((item, i) => (
                <li key={i}>{renderInline(item, 0, `${index}-${i}`)}</li>
              ))}
            </ul>
          )
        }
        if (block.kind === 'ol') {
          return (
            <ol key={index} start={block.start} className="my-1 list-decimal space-y-0.5 pl-5">
              {block.items.map((item, i) => (
                <li key={i}>{renderInline(item, 0, `${index}-${i}`)}</li>
              ))}
            </ol>
          )
        }
        return (
          <p key={index} className="my-1 first:mt-0 last:mb-0">
            {block.lines.map((line, i) => (
              <Fragment key={i}>
                {i > 0 ? <br /> : null}
                {renderInline(line, 0, `${index}-${i}`)}
              </Fragment>
            ))}
          </p>
        )
      })}
    </div>
  )
}
