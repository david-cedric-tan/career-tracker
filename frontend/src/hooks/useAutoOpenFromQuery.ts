import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

/**
 * Consumes a query param (e.g. `?new=1`, `?event=12`) exactly once — calls
 * `onTrigger` with its value, then strips just that param (leaving any
 * others, like Calendar's own view/month/day state, untouched) so it doesn't
 * refire on reload or linger in the address bar.
 *
 * Built for the onboarding tour's "try it" actions: the tour just navigates
 * to `<page>?new=1`, and the page opens its own create form — it never has
 * to know a tour exists. Runs in an effect rather than during render: some
 * triggers (a file-input ref click) need the DOM to have actually committed
 * first, which render-time code can't guarantee.
 */
export function useAutoOpenFromQuery(
  param: string,
  onTrigger: (value: string) => void,
): void {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  // Any non-empty value triggers, so the same hook covers a flag (`?new=1`)
  // and a target (`?event=12`) without a second near-identical copy.
  const requested = params.get(param) || ''

  useEffect(() => {
    if (!requested) return
    onTrigger(requested)
    const next = new URLSearchParams(params)
    next.delete(param)
    navigate({ search: next.toString() }, { replace: true })
    // Deliberately just `[requested]` — `params`/`navigate`/`onTrigger` are
    // fresh every render, and including them would refire this on every
    // keystroke elsewhere in the URL rather than only when `requested` flips.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requested])
}
