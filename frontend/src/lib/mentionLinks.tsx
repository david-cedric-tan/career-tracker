import { useMemo, type ReactNode } from 'react'
import { applications, companies, locations, people, venues } from '../api/resources'
import { useResource } from '../hooks/useResource'

import { MentionResolverContext, type MentionResolver, type MentionTarget } from './mentionLinksContext'

/** Tags are the label with whitespace removed — the same rule the mention
    editor uses when it inserts one, so the two always agree. */
function tagOf(label: string): string {
  return label.replace(/\s+/g, '').toLowerCase()
}

/**
 * Turns `@Mentions` in rendered notes into links.
 *
 * Loads the catalogs a mention can point at once for the whole app, then
 * answers "what does @ThePillars,Wynyard mean?" from memory — so every
 * rendered note gets clickable tags without each one fetching anything.
 */
export function MentionLinksProvider({ children }: { children: ReactNode }) {
  const peopleList = useResource(() => people.list(), [])
  const companyList = useResource(() => companies.list(), [])
  const locationList = useResource(() => locations.list(), [])
  const venueList = useResource(() => venues.list(), [])
  const applicationList = useResource(() => applications.list(), [])

  const resolve = useMemo<MentionResolver>(() => {
    const index = new Map<string, MentionTarget>()
    // Later kinds never overwrite earlier ones, so a person and a company
    // with the same tag resolve the way the editor's suggestion order does.
    const add = (label: string, target: MentionTarget) => {
      const key = tagOf(label)
      if (!index.has(key)) index.set(key, target)
    }
    for (const person of peopleList.data ?? []) {
      add(person.full_name, {
        kind: 'person',
        label: person.full_name,
        href: `/network/${person.id}`,
        image: person.photo,
      })
    }
    for (const company of companyList.data ?? []) {
      const label = company.short_name || company.name
      const target: MentionTarget = {
        kind: 'company',
        label,
        href: `/job-directory/companies/${company.id}`,
        image: company.logo,
      }
      add(label, target)
      add(company.name, target)
    }
    for (const venue of venueList.data ?? []) {
      add(venue.name, {
        kind: 'venue',
        label: venue.name,
        href: '/job-directory?tab=places',
        image: null,
      })
    }
    for (const location of locationList.data ?? []) {
      add(location.name, {
        kind: 'location',
        label: location.name,
        href: '/job-directory?tab=places',
        image: null,
      })
    }
    for (const application of applicationList.data ?? []) {
      const label = application.role_names[0] ?? application.company_name
      add(label, {
        kind: 'application',
        label,
        href: `/applications/${application.id}`,
        image: application.company_logo,
      })
    }
    return (tag) => index.get(tagOf(tag.replace(/^@/, ''))) ?? null
  }, [peopleList.data, companyList.data, locationList.data, venueList.data, applicationList.data])

  return (
    <MentionResolverContext.Provider value={resolve}>{children}</MentionResolverContext.Provider>
  )
}
