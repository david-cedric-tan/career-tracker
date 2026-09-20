/**
 * A minimal RTF → plain text converter.
 *
 * `documentPreviewMode` has treated `.rtf` as a "text" preview for a while,
 * but the viewer was just dumping the raw file — an RTF's actual bytes are
 * `{\rtf1\ansi\deff0{\fonttbl...}...\par Hello}`, control words and all, so
 * "preview" showed markup soup instead of the document. This walks that
 * syntax well enough for a preview: skips the font/colour/style tables and
 * document metadata destinations, turns `\par`/`\line` into newlines and
 * `\tab` into tabs, and decodes `\'hh` (cp1252) and `\uNNNN` (Unicode)
 * escapes. It isn't a full RTF renderer — no tables, no embedded images,
 * no attempt at bold/italic — just enough to read what the document says.
 */

// cp1252 has ASCII in 0x00–0x7F; this only needs the extended half, since a
// `\'hh` escape below 0x80 is already a plain ASCII character.
const CP1252_HIGH: Record<number, string> = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡',
  0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž', 0x91: '‘',
  0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x98: '˜',
  0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ',
}

/** Destinations whose contents are never document text — the font table,
    colour table, style sheet, and similar bookkeeping groups. */
const SKIP_DESTINATIONS = new Set([
  'fonttbl', 'colortbl', 'stylesheet', 'info', 'generator', 'pict',
  'object', 'objdata', 'themedata', 'colorschememapping', 'latentstyles',
  'rsidtbl', 'listtable', 'listoverridetable', 'datastore', 'xmlnstbl',
])

export function looksLikeRtf(text: string): boolean {
  return /^\s*\{\\rtf1/.test(text)
}

export function rtfToPlainText(source: string): string {
  if (!looksLikeRtf(source)) return source

  let out = ''
  let i = 0
  const len = source.length
  // One skip-depth per nested group, so a skipped destination's own nested
  // groups (e.g. a font table entry containing `{\*\falt ...}`) stay skipped
  // until the whole destination closes, not just its first sub-group.
  const skipStack: boolean[] = [false]
  // How many characters after a \uN to drop — Word always follows a unicode
  // escape with an ANSI fallback of some width, most commonly one character.
  let unicodeSkip = 0

  function currentlySkipping(): boolean {
    return skipStack[skipStack.length - 1]
  }

  while (i < len) {
    const ch = source[i]

    if (ch === '{') {
      skipStack.push(currentlySkipping())
      i++
      continue
    }
    if (ch === '}') {
      if (skipStack.length > 1) skipStack.pop()
      i++
      continue
    }
    if (ch === '\\') {
      // \'hh — a single escaped byte in the document's codepage.
      if (source[i + 1] === "'") {
        const hex = source.slice(i + 2, i + 4)
        i += 4
        if (!currentlySkipping()) {
          const code = parseInt(hex, 16)
          if (Number.isFinite(code)) {
            out += code < 0x80 ? String.fromCharCode(code) : (CP1252_HIGH[code] ?? '')
          }
        }
        continue
      }

      // A control word: backslash, letters, optional signed digits, then one
      // optional separating space that's part of the control word itself.
      const match = /^\\([a-zA-Z]+)(-?\d+)?(\s)?/.exec(source.slice(i))
      if (match) {
        const [whole, word, param] = match
        i += whole.length

        if (word === 'par' || word === 'line') {
          if (!currentlySkipping()) out += '\n'
          continue
        }
        if (word === 'tab') {
          if (!currentlySkipping()) out += '\t'
          continue
        }
        if (word === 'u') {
          const code = param ? parseInt(param, 10) : NaN
          if (!currentlySkipping() && Number.isFinite(code)) {
            // RTF's \u is a signed 16-bit value; negative means the code
            // point was above 32767 and stored as its two's-complement.
            out += String.fromCharCode(code < 0 ? code + 65536 : code)
          }
          unicodeSkip = unicodeSkip || 1
          continue
        }
        // A destination this converter has no use for — mark its group (the
        // one just pushed by the '{' immediately before it, or the current
        // one for a plain \* prefix) as skipped.
        if (SKIP_DESTINATIONS.has(word)) {
          skipStack[skipStack.length - 1] = true
          continue
        }
        // Any other control word (\b, \i, \f0, \fs24, …) — formatting this
        // preview doesn't attempt to render, just consumed and dropped.
        continue
      }

      // \* (destination marker) or an escaped literal brace/backslash.
      if (source[i + 1] === '*') {
        i += 2
        continue
      }
      if (source[i + 1] === '\\' || source[i + 1] === '{' || source[i + 1] === '}') {
        if (!currentlySkipping()) out += source[i + 1]
        i += 2
        continue
      }
      // An unrecognised backslash escape — skip just the backslash so a
      // stray one can't wedge the loop.
      i++
      continue
    }

    // Plain character. A run of ASCII fallback text right after \uN is
    // exactly `unicodeSkip` characters Word inserted for non-Unicode
    // readers, not part of the document.
    if (unicodeSkip > 0 && ch !== '\r' && ch !== '\n') {
      unicodeSkip--
      i++
      continue
    }
    if (!currentlySkipping() && ch !== '\r' && ch !== '\n') out += ch
    i++
  }

  // Runs of blank lines and trailing space are artefacts of dropped
  // formatting groups, not intentional spacing in the source document.
  return out
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
