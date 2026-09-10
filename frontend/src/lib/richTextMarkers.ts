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
