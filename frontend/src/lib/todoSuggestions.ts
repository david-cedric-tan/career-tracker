import { useCallback, useEffect, useState } from 'react'

const ENABLED_KEY = 'career-tracker:todo-suggestions'
const EXPANDED_KEY = 'career-tracker:todo-suggestions-expanded'
const HIDDEN_KEY = 'career-tracker:todo-suggestions-hidden'
const ENABLED_EVENT = 'todo-suggestions-change'
const EXPANDED_EVENT = 'todo-suggestions-expanded-change'
const HIDDEN_EVENT = 'todo-suggestions-hidden-change'

function readEnabled(): boolean {
  try {
    const raw = localStorage.getItem(ENABLED_KEY)
    // Default on — suggestions are useful until someone turns them off.
    if (raw === null) return true
    return raw === '1'
  } catch {
    return true
  }
}

function readExpanded(): boolean {
  try {
    const raw = localStorage.getItem(EXPANDED_KEY)
    // First visit / no preference: show the full list.
    if (raw === null) return true
    return raw === '1'
  } catch {
    return true
  }
}

function readHidden(): boolean {
  try {
    const raw = localStorage.getItem(HIDDEN_KEY)
    // First visit / no preference: show the suggestions card.
    if (raw === null) return false
    return raw === '1'
  } catch {
    return false
  }
}

/**
 * Whether the Todos page should surface suggested follow-ups.
 *
 * Per-browser like developer mode: a preference about how busy the page feels,
 * not something that needs to follow the account.
 */
export function useTodoSuggestionsSetting(): [boolean, (value: boolean) => void] {
  const [enabled, setEnabled] = useState(readEnabled)

  useEffect(() => {
    const sync = () => setEnabled(readEnabled())
    window.addEventListener(ENABLED_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(ENABLED_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const set = useCallback((value: boolean) => {
    try {
      localStorage.setItem(ENABLED_KEY, value ? '1' : '0')
    } catch {
      /* in-memory still applies for this session */
    }
    setEnabled(value)
    window.dispatchEvent(new Event(ENABLED_EVENT))
  }, [])

  return [enabled, set]
}

/**
 * Whether the suggestions card lists every item or only the first few.
 *
 * Survives leaving Todos and coming back. Defaults to expanded.
 */
export function useTodoSuggestionsExpanded(): [boolean, (value: boolean) => void] {
  const [expanded, setExpanded] = useState(readExpanded)

  useEffect(() => {
    const sync = () => setExpanded(readExpanded())
    window.addEventListener(EXPANDED_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(EXPANDED_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const set = useCallback((value: boolean) => {
    try {
      localStorage.setItem(EXPANDED_KEY, value ? '1' : '0')
    } catch {
      /* in-memory still applies for this session */
    }
    setExpanded(value)
    window.dispatchEvent(new Event(EXPANDED_EVENT))
  }, [])

  return [expanded, set]
}

/**
 * Whether the suggestions card is tucked away behind the "Suggestions" chip.
 *
 * Survives leaving Todos, coming back, and signing in again on this browser.
 * Defaults to visible — only hides after the user dismisses the card.
 */
export function useTodoSuggestionsHidden(): [boolean, (value: boolean) => void] {
  const [hidden, setHidden] = useState(readHidden)

  useEffect(() => {
    const sync = () => setHidden(readHidden())
    window.addEventListener(HIDDEN_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(HIDDEN_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const set = useCallback((value: boolean) => {
    try {
      localStorage.setItem(HIDDEN_KEY, value ? '1' : '0')
    } catch {
      /* in-memory still applies for this session */
    }
    setHidden(value)
    window.dispatchEvent(new Event(HIDDEN_EVENT))
  }, [])

  return [hidden, set]
}
