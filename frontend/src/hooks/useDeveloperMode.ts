import { useCallback, useEffect, useState } from 'react'

const KEY = 'career-tracker:developer-mode'
const EVENT = 'developer-mode-change'

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    // Private windows and blocked site data throw on access rather than
    // returning null, so the mode simply stays off.
    return false
  }
}

/**
 * Developer mode: a per-browser preference, not account data.
 *
 * Kept in localStorage rather than on the profile because it's a workspace
 * setting — you want the log open on the machine you're testing on, not
 * following you onto a phone. The custom event keeps every hook instance in
 * step, since `storage` only fires in *other* tabs.
 */
export function useDeveloperMode(): [boolean, (value: boolean) => void] {
  const [enabled, setEnabled] = useState(read)

  useEffect(() => {
    const sync = () => setEnabled(read())
    window.addEventListener(EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const set = useCallback((value: boolean) => {
    try {
      localStorage.setItem(KEY, value ? '1' : '0')
    } catch {
      // Not persisting is survivable; the in-memory state below still works
      // for this session.
    }
    setEnabled(value)
    window.dispatchEvent(new Event(EVENT))
  }, [])

  return [enabled, set]
}
