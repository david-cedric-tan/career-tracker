/**
 * Rendered document thumbnails, keyed by file URL.
 *
 * Drawing a PDF's first page means downloading the whole file and running
 * pdf.js — fine once, wasteful every time a card scrolls into view. The
 * result is a small JPEG data URL, so it's kept in memory for the session and
 * in IndexedDB across reloads; a second look at any file is instant.
 *
 * Storage is best-effort: if IndexedDB is unavailable (private mode) the
 * in-memory map still works and nothing throws.
 */

const DB_NAME = 'career-tracker-thumbnails'
const STORE = 'thumbs'
const memory = new Map<string, string>()

let dbPromise: Promise<IDBDatabase | null> | null = null

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, 1)
      request.onupgradeneeded = () => request.result.createObjectStore(STORE)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return dbPromise
}

/** A file's URL is stable but its query string (signed URLs) may not be. */
function keyFor(url: string): string {
  return url.split('?')[0] ?? url
}

export function peekThumbnail(url: string): string | null {
  return memory.get(keyFor(url)) ?? null
}

export async function readThumbnail(url: string): Promise<string | null> {
  const key = keyFor(url)
  const hit = memory.get(key)
  if (hit) return hit
  const db = await openDb()
  if (!db) return null
  return new Promise((resolve) => {
    try {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(key)
      request.onsuccess = () => {
        const value = typeof request.result === 'string' ? request.result : null
        if (value) memory.set(key, value)
        resolve(value)
      }
      request.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

export async function writeThumbnail(url: string, dataUrl: string): Promise<void> {
  const key = keyFor(url)
  memory.set(key, dataUrl)
  const db = await openDb()
  if (!db) return
  try {
    db.transaction(STORE, 'readwrite').objectStore(STORE).put(dataUrl, key)
  } catch {
    // Best effort — the in-memory copy still serves this session.
  }
}
