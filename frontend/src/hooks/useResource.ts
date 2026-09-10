import { useCallback, useEffect, useRef, useState } from 'react'
import { formatApiError } from '../api/client'

type State<T> = {
  data: T | null
  error: string
  loading: boolean
  /** True only on the first load — refetches keep the previous render visible. */
  initial: boolean
}

/**
 * Fetch-on-mount with a manual `reload`.
 *
 * `deps` behaves like a useEffect dependency list, but it is serialised into a
 * single key so the effect keeps a literal dependency array. On a refetch the
 * previous data stays put (no skeleton flash); only `loading` flips.
 */
export function useResource<T>(
  fetcher: () => Promise<T>,
  deps: unknown[] = [],
): State<T> & { reload: () => void; setData: (value: T) => void } {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [initial, setInitial] = useState(true)
  const requestId = useRef(0)

  // The fetcher closure is rebuilt every render; only `deps` decides when to
  // refetch, so read it through a ref rather than making it a dependency.
  const fetcherRef = useRef(fetcher)
  useEffect(() => {
    fetcherRef.current = fetcher
  })

  const key = JSON.stringify(deps)

  const run = useCallback(() => {
    const id = ++requestId.current
    setLoading(true)
    fetcherRef
      .current()
      .then((result) => {
        // Ignore a slow response that a newer request has already superseded.
        if (id !== requestId.current) return
        setData(result)
        setError('')
      })
      .catch((err) => {
        if (id !== requestId.current) return
        setError(formatApiError(err))
      })
      .finally(() => {
        if (id !== requestId.current) return
        setLoading(false)
        setInitial(false)
      })
  }, [])

  useEffect(() => {
    // `run` flips `loading` on before awaiting the network. That is a
    // synchronous setState inside an effect by construction — kicking off a
    // request IS the external-system subscription this effect exists for, and
    // the alternative (deferring the flag) would render a stale "loaded" frame.
    // `key` stands in for the caller's dependency list.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    run()
  }, [key, run])

  return { data, error, loading, initial, reload: run, setData }
}

/** Debounce a fast-changing value (search boxes) before it hits the network. */
export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}
