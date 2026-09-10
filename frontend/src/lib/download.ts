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
  if (!response.ok) throw new Error(`Download failed (${response.status})`)

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
