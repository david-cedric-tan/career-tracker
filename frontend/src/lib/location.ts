import { useCallback, useEffect, useState } from 'react'

/**
 * Per-account location consent for local weather and time.
 *
 * Completing the prompt means the *browser* permission was answered — allow
 * or deny — not just our in-app "Not now". Existing accounts that dismissed
 * the dialog without ever seeing the OS prompt are asked again.
 */

export type Coords = { lat: number; lon: number }

const ASKED_PREFIX = 'career-tracker:location-asked:'
const ENABLED_PREFIX = 'career-tracker:location-enabled:'
const SKIP_PREFIX = 'career-tracker:location-skip:'
const COORDS_KEY = 'dynamicThemeCoords'
export const LOCATION_EVENT = 'location-change'

let activeUserId: number | null = null

function askedKey(userId: number): string {
  return `${ASKED_PREFIX}${userId}`
}

function enabledKey(userId: number): string {
  return `${ENABLED_PREFIX}${userId}`
}

function skipKey(userId: number): string {
  return `${SKIP_PREFIX}${userId}`
}

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

function writeFlag(key: string, value: boolean): void {
  try {
    if (value) localStorage.setItem(key, '1')
    else localStorage.removeItem(key)
  } catch {
    // Private mode — the in-memory event still updates this visit.
  }
}

function emit(): void {
  window.dispatchEvent(new Event(LOCATION_EVENT))
}

export function bindLocationUser(userId: number | null): void {
  if (activeUserId === userId) return
  activeUserId = userId
  emit()
  if (userId != null) void reconcileLocationAccess(userId)
}

/**
 * If the browser already allowed location (e.g. from Dynamic theme before
 * this prompt existed) and this account never opted out, turn weather on.
 * Without this, permission=granted + enabled=false leaves a clock with no
 * weather and no dialog to fix it.
 */
export async function reconcileLocationAccess(userId: number): Promise<void> {
  if (isLocationEnabled(userId)) {
    emit()
    return
  }
  // Explicit decline in Settings / an answered deny — leave them alone.
  if (hasCompletedLocationPrompt(userId) && !isLocationEnabled(userId)) {
    return
  }

  const permission = await queryGeolocationPermission()
  if (permission === 'granted' || permission === 'unknown') {
    const cached = readCachedCoords()
    if (cached) {
      setLocationEnabled(userId, true)
      return
    }
    if (permission === 'granted') {
      await enableLocation(userId)
    }
  }
}

export function hasCompletedLocationPrompt(userId: number): boolean {
  return readFlag(askedKey(userId))
}

export function isLocationEnabled(userId: number): boolean {
  return readFlag(enabledKey(userId))
}

export function markLocationPromptDone(userId: number): void {
  writeFlag(askedKey(userId), true)
}

export function skipLocationPromptThisSession(userId: number): void {
  try {
    sessionStorage.setItem(skipKey(userId), '1')
  } catch {
    // Fine — they'll see it again this visit if storage is blocked.
  }
}

function skippedThisSession(userId: number): boolean {
  try {
    return sessionStorage.getItem(skipKey(userId)) === '1'
  } catch {
    return false
  }
}

export function setLocationEnabled(userId: number, enabled: boolean): void {
  writeFlag(enabledKey(userId), enabled)
  writeFlag(askedKey(userId), true)
  emit()
}

export function readCachedCoords(): Coords | null {
  try {
    const raw = localStorage.getItem(COORDS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<Coords>
    if (typeof parsed.lat === 'number' && typeof parsed.lon === 'number') return parsed as Coords
  } catch {
    // Private mode, corrupt value — just re-request.
  }
  return null
}

function writeCachedCoords(coords: Coords): void {
  try {
    localStorage.setItem(COORDS_KEY, JSON.stringify(coords))
  } catch {
    // Fine — geolocation just gets asked again next time.
  }
}

type GeoPermission = 'granted' | 'denied' | 'prompt' | 'unknown'

async function queryGeolocationPermission(): Promise<GeoPermission> {
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' })
    if (status.state === 'granted' || status.state === 'denied' || status.state === 'prompt') {
      return status.state
    }
  } catch {
    // Safari and some WebViews omit geolocation from the Permissions API.
  }
  return 'unknown'
}

/**
 * Ask the browser for coordinates. This is the only path that may show the
 * OS permission dialog. `maximumAge: 0` so a previous miss doesn't silently
 * reuse a failed result and skip the prompt.
 */
export function requestBrowserLocation(): Promise<Coords | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.resolve(null)
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const coords = { lat: position.coords.latitude, lon: position.coords.longitude }
        writeCachedCoords(coords)
        resolve(coords)
      },
      () => resolve(null),
      { timeout: 30_000, maximumAge: 0, enableHighAccuracy: false },
    )
  })
}

export function resolveCoords(): Promise<Coords | null> {
  if (activeUserId == null || !isLocationEnabled(activeUserId)) {
    return Promise.resolve(null)
  }
  const cached = readCachedCoords()
  if (cached) return Promise.resolve(cached)
  return requestBrowserLocation()
}

export async function enableLocation(userId: number): Promise<boolean> {
  const coords = await requestBrowserLocation()
  setLocationEnabled(userId, coords != null)
  return coords != null
}

export function disableLocation(userId: number): void {
  setLocationEnabled(userId, false)
}

/**
 * Whether to show the in-app location dialog.
 *
 * - Granted in the browser and the toggle is on: just use it, no dialog.
 * - Granted but the toggle is off: they turned it off in Settings, leave it.
 * - Denied in the browser: don't nag; Settings can retry.
 * - Still 'prompt': show the dialog even if our old "Not now" flag is set,
 *   because that never reached the browser.
 */
export async function shouldPromptForLocation(userId: number): Promise<boolean> {
  if (skippedThisSession(userId)) return false
  if (isLocationEnabled(userId) && readCachedCoords()) return false

  const permission = await queryGeolocationPermission()
  if (permission === 'granted') {
    // Browser already OK'd location — turn weather on unless they opted out.
    if (!hasCompletedLocationPrompt(userId) || isLocationEnabled(userId)) {
      await reconcileLocationAccess(userId)
    }
    return false
  }
  if (permission === 'denied') {
    markLocationPromptDone(userId)
    return false
  }
  // Still 'prompt' — the browser has never been asked, even if our in-app
  // dialog was dismissed earlier. Ask again.
  if (permission === 'prompt') return true
  // Permissions API unavailable: only ask if this account hasn't completed
  // a real allow/deny yet.
  return !hasCompletedLocationPrompt(userId)
}

export function useLocationEnabled(userId: number | undefined): [boolean, (next: boolean) => void] {
  const [enabled, setEnabled] = useState(() => (userId == null ? false : isLocationEnabled(userId)))

  useEffect(() => {
    const sync = () => setEnabled(userId == null ? false : isLocationEnabled(userId))
    sync()
    window.addEventListener(LOCATION_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(LOCATION_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [userId])

  const choose = useCallback(
    (next: boolean) => {
      if (userId == null) return
      if (!next) {
        disableLocation(userId)
        return
      }
      void enableLocation(userId)
    },
    [userId],
  )

  return [enabled, choose]
}
