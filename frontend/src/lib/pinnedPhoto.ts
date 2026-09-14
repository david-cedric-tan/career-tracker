/**
 * One-time rescue of a desk photo that only lived in this browser.
 *
 * New pins go to the account (see /api/auth/me/pinned-photo/). This module
 * only exists so a photo pinned before that change can be uploaded once and
 * then forgotten — two accounts on one machine must not share a key anymore.
 */

const DB_NAME = 'career-tracker'
const STORE = 'pinned-photo'
const LEGACY_IDB_KEY = 'current'
const LEGACY_LS_KEY = 'career-tracker:pinned-photo'
const CLAIM_KEY = 'career-tracker:pinned-photo-claim'

export const MAX_BYTES = 48 * 1024 * 1024

export type LocalPinnedPhoto = { caption: string; blob?: Blob; url?: string }

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function transact<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const request = run(db.transaction(STORE, mode).objectStore(STORE))
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      }),
  )
}

function userKey(userId: number): string {
  return `user:${userId}`
}

function readClaim(): string | null {
  try {
    return localStorage.getItem(CLAIM_KEY)
  } catch {
    return null
  }
}

function writeClaim(userId: number): void {
  try {
    localStorage.setItem(CLAIM_KEY, String(userId))
  } catch {
    // Fine — still migrate for this visit.
  }
}

/**
 * A leftover browser-only pin for this account, if any.
 *
 * The brief per-browser keying could copy one person's photo into another's
 * slot on a shared PC. A claim flag records who owns the pre-server photo so
 * the other account gets an empty pin instead of uploading the wrong image.
 */
export async function takeLocalPinnedPhoto(userId: number): Promise<LocalPinnedPhoto | null> {
  const claimed = readClaim()

  try {
    const personal = await transact<LocalPinnedPhoto | undefined>('readonly', (store) =>
      store.get(userKey(userId)),
    )
    if (personal?.blob || personal?.url) {
      await transact('readwrite', (store) => store.delete(userKey(userId)))
      // Another account already claimed the old shared photo — this slot is
      // almost certainly that same image, not theirs.
      if (claimed && claimed !== String(userId)) return null
      writeClaim(userId)
      return personal
    }
  } catch {
    // IndexedDB unavailable.
  }

  if (claimed && claimed !== String(userId)) return null

  try {
    const shared = await transact<LocalPinnedPhoto | undefined>('readonly', (store) =>
      store.get(LEGACY_IDB_KEY),
    )
    if (shared?.blob || shared?.url) {
      writeClaim(userId)
      await transact('readwrite', (store) => store.delete(LEGACY_IDB_KEY))
      return shared
    }
  } catch {
    // Fall through.
  }

  try {
    const raw = localStorage.getItem(LEGACY_LS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { src?: string; caption?: string }
    if (!parsed.src) return null
    writeClaim(userId)
    localStorage.removeItem(LEGACY_LS_KEY)
    const caption = parsed.caption ?? ''
    if (parsed.src.startsWith('data:')) {
      return { caption, blob: await fetch(parsed.src).then((response) => response.blob()) }
    }
    return { caption, url: parsed.src }
  } catch {
    return null
  }
}

export async function clearLocalPinnedPhotos(userId: number): Promise<void> {
  try {
    await transact('readwrite', (store) => store.delete(userKey(userId)))
  } catch {
    // Nothing to clean up.
  }
}
