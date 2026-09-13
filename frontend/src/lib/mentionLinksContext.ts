import { createContext, useContext } from 'react'

export type MentionTarget = {
  kind: 'person' | 'company' | 'location' | 'venue' | 'application'
  label: string
  href: string
  /** A face or logo to show on the chip, when there is one. */
  image: string | null
}

export type MentionResolver = (tag: string) => MentionTarget | null

export const MentionResolverContext = createContext<MentionResolver>(() => null)

export function useMentionResolver(): MentionResolver {
  return useContext(MentionResolverContext)
}
