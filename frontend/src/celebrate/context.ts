import { createContext, useContext } from 'react'

/** What was achieved — lets the effect vary its colour and intensity. */
export type CelebrationKind =
  | 'application'
  | 'stage'
  | 'catchup'
  | 'connection'
  | 'todo'
  | 'experience'

export const CelebrationContext = createContext<{
  celebrate: (kind: CelebrationKind) => void
  enabled: boolean
  setEnabled: (enabled: boolean) => void
} | null>(null)

export function useCelebrate() {
  const ctx = useContext(CelebrationContext)
  if (!ctx) throw new Error('useCelebrate must be used within CelebrationProvider')
  return ctx.celebrate
}

/** The Settings toggle reads/writes through this rather than `useCelebrate`,
    so most call sites never need to know the setting exists. */
export function useCelebrationSettings() {
  const ctx = useContext(CelebrationContext)
  if (!ctx) throw new Error('useCelebrationSettings must be used within CelebrationProvider')
  return { enabled: ctx.enabled, setEnabled: ctx.setEnabled }
}
