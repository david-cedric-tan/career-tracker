import { LinkButton } from '../components/ui/Button'
import { EmptyState } from '../components/ui/States'

export function NotFoundPage() {
  return (
    <EmptyState
      icon="search"
      title="Page not found"
      description="That link doesn’t point anywhere in the app."
      action={
        <LinkButton to="/" variant="primary">
          Back to dashboard
        </LinkButton>
      }
      className="min-h-[60dvh]"
    />
  )
}
