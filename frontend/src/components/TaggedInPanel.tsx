import { Link } from 'react-router-dom'
import { dashboard } from '../api/resources'
import { Card, CardHeader } from './ui/Card'
import { Icon } from './ui/Icon'
import { Loading } from './ui/States'
import { useResource } from '../hooks/useResource'

const DOMAIN_ICON: Record<string, string> = {
  todo: 'checklist',
  person_notes: 'users',
  catchup: 'coffee',
  company_note: 'building',
}

/**
 * "Tagged In" — every place this account's own notes `@mention` this person
 * or company, found by searching the free-text fields for the literal tag
 * (mentions are plain text, not a stored relation — see `MentionTextarea`).
 *
 * A generic panel rather than one per page: the same lookup and rendering
 * apply whether it's sitting under a contact's Tasks card or a company's Job
 * Listings — only the tag differs.
 */
export function TaggedInPanel({ tag }: { tag: string }) {
  const mentions = useResource(() => dashboard.mentions(tag), [tag])

  if (mentions.initial) {
    return (
      <Card>
        <CardHeader title="Tagged In" />
        <Loading />
      </Card>
    )
  }

  if (!mentions.data?.length) return null

  return (
    <Card>
      <CardHeader
        title="Tagged In"
        subtitle={`${mentions.data.length} mention${mentions.data.length === 1 ? '' : 's'} across your notes`}
      />
      <ul className="mt-2 flex flex-col gap-1">
        {mentions.data.map((mention) => (
          <li key={`${mention.domain}-${mention.id}`}>
            <Link
              to={mention.url}
              className="-mx-2 flex items-start gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-surface-2"
            >
              <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-lg bg-surface-2 text-ink-3">
                <Icon name={DOMAIN_ICON[mention.domain] ?? 'sparkles'} size={13} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-ink">
                  {mention.title}
                </span>
                <span className="block truncate text-[12px] text-ink-3">{mention.snippet}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  )
}
