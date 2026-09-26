import { getToken } from '../api/client'

/**
 * Fetch an authenticated file endpoint and trigger a browser save.
 *
 * A plain `<a href>` can't carry the auth token, so the response is fetched
 * as a blob and handed to the browser via a throwaway object URL — the same
 * trick every one of this app's exports (backup, calendar) needs.
 */
export async function downloadFile(url: string, fallbackName: string): Promise<void> {
  const response = await fetch(url, {
    headers: { Authorization: `Token ${getToken() ?? ''}` },
  })
  if (!response.ok) {
    // Prefer the server's own explanation (e.g. "run migrate") when it sent one.
    const detail = await response
      .json()
      .then((body: { detail?: unknown }) => (typeof body.detail === 'string' ? body.detail : ''))
      .catch(() => '')
    throw new Error(detail || `Download failed (${response.status})`)
  }

  const blob = await response.blob()
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download =
    response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] ??
    fallbackName
  link.click()
  URL.revokeObjectURL(objectUrl)
}

/** "cv" + "resume-40-abc.pdf" -> "cv.pdf" — the label, with the file's extension. */
export function downloadName(label: string, source: string | null | undefined): string {
  const bare = (source ?? '').split('?')[0] ?? ''
  const dot = bare.lastIndexOf('.')
  const ext = dot >= 0 ? bare.slice(dot).toLowerCase() : ''
  const safe = label.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ') || 'document'
  return safe.toLowerCase().endsWith(ext) ? safe : `${safe}${ext}`
}

/**
 * Save a media file under a chosen name. A plain `<a download>` is ignored
 * for cross-origin URLs (the API on :8000 while the page is on :5173), so
 * the bytes are fetched and handed back through an object URL instead.
 */
export async function saveFileAs(url: string, filename: string): Promise<void> {
  const response = await fetch(url, { credentials: 'include' })
  if (!response.ok) throw new Error(`Download failed (${response.status})`)
  const blob = await response.blob()
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
}
