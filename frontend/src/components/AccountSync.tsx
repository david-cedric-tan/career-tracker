import { useState } from 'react'
import { useAuth } from '../auth/context'
import { useCelebrationSettings } from '../celebrate/context'

/**
 * Adopts the signed-in account's own non-appearance preferences once per login.
 *
 * CelebrationProvider sits above AuthProvider (its canvas has to outlive any
 * route), so it can't read the user itself — this lives inside the auth tree
 * and pushes the account's answer down into it.
 *
 * Like AppearanceProvider's sync, every field is saved-value-*or-default*:
 * localStorage may still hold whoever last used this browser, and a second
 * account on the same machine must start from defaults, not their settings.
 */
export function AccountSync() {
  const { user } = useAuth()
  const { setEnabled } = useCelebrationSettings()
  const [syncedForUserId, setSyncedForUserId] = useState<number | null>(null)

  if (user && user.id !== syncedForUserId) {
    setSyncedForUserId(user.id)
    setEnabled(user.celebrations_enabled ?? true)
  }

  return null
}
