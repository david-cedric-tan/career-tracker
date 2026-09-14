/**
 * The plain-text markers the notes toolbar writes and `RichText` reads back.
 *
 * Split from `richText.tsx` so both the editor and the renderer can import
 * them without either pulling in the other's module.
 */
export const MARKERS = {
  bold: '**',
  italic: '*',
  // Not markdown's own meaning (there, `__` is bold) — but underline has no
  // markdown syntax at all, and this is the convention chat apps settled on.
  underline: '__',
  strike: '~~',
} as const

/** A whole line of these becomes a horizontal rule in `RichText`. */
export const RULE_MARKERS = {
  dashed: '---',
  dotted: '···',
} as const

/** The text with markers stripped — for a clipped preview, where chips and
    bold would only get in the way of the first few lines. */
export function plainText(text: string): string {
  return text
    .replace(/\*\*|__|~~|(?<!\w)[*_](?!\s)|(?<!\s)[*_](?!\w)/g, '')
    .replace(/^\s*(?:-{3,}|[.·]{3,})\s*$/gm, '')
    .replace(/^\s*(?:-|\d+\.)\s+/gm, '')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

