/** Shared shape for in-app document preview (application docs + resumes). */
export type PreviewSource = {
  file: string
  title: string
  file_kind?: string | null
  /** When known — application docs set this; resumes usually omit. */
  kind?: 'image' | 'document' | string | null
  original_name?: string | null
  file_name?: string | null
  description?: string
  created_at?: string
}

export type DocumentPreviewMode = 'image' | 'pdf' | 'text' | 'html' | 'unsupported'

/** Extension from the original upload name, falling back to the stored URL. */
export function documentExtension(source: {
  original_name?: string | null
  file_name?: string | null
  file: string
}): string {
  const name = source.original_name || source.file_name || source.file
  const bare = name.split('?')[0] ?? name
  const slash = bare.lastIndexOf('/')
  const base = slash >= 0 ? bare.slice(slash + 1) : bare
  const dot = base.lastIndexOf('.')
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : ''
}

/** How this file can be previewed in the browser. */
export function documentPreviewMode(source: {
  kind?: string | null
  file_kind?: string | null
  original_name?: string | null
  file_name?: string | null
  file: string
}): DocumentPreviewMode {
  if (source.kind === 'image') return 'image'

  switch (documentExtension(source)) {
    case 'pdf':
      return 'pdf'
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
    case 'avif':
      return 'image'
    case 'txt':
    case 'rtf':
    case 'md':
    case 'markdown':
      return 'text'
    case 'docx':
      return 'html'
    default:
      break
  }

  // Storage renames often drop the extension from the URL — fall back to the
  // human file_kind label the API already computed from the upload name.
  const label = (source.file_kind || '').toLowerCase()
  if (label === 'pdf') return 'pdf'
  if (label === 'word') return 'html'
  if (label === 'plain text' || label === 'rich text' || label === 'markdown') {
    return 'text'
  }
  return 'unsupported'
}

export function documentCanPreview(source: {
  kind?: string | null
  file_kind?: string | null
  original_name?: string | null
  file_name?: string | null
  file: string
}): boolean {
  return documentPreviewMode(source) !== 'unsupported'
}

/** Read = monochrome / calm typography; Original = colours & richer formatting. */
export type DocumentFormatMode = 'read' | 'original'

const FORMAT_MODE_KEY = 'career-tracker:document-format-mode'

export function readDocumentFormatMode(): DocumentFormatMode {
  try {
    const raw = localStorage.getItem(FORMAT_MODE_KEY)
    if (raw === 'original' || raw === 'read') return raw
  } catch {
    /* ignore */
  }
  return 'read'
}

export function writeDocumentFormatMode(mode: DocumentFormatMode) {
  try {
    localStorage.setItem(FORMAT_MODE_KEY, mode)
  } catch {
    /* ignore */
  }
}
