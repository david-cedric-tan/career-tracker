import { useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { formatApiError } from '../api/client'
import { applications as applicationsApi, jobListings } from '../api/resources'
import { PageHeader } from '../components/layout/PageHeader'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, CardHeader } from '../components/ui/Card'
import { Icon } from '../components/ui/Icon'
import { Modal } from '../components/ui/Modal'
import { ErrorState, Loading } from '../components/ui/States'
import { useToast } from '../components/ui/toast-context'
import { useResource } from '../hooks/useResource'
import { formatDate } from '../lib/format'
import { OUTCOME_TONE } from '../lib/tones'
import { ListingForm } from './JobDirectoryPage'

/**
 * A job listing's full profile — the same "click through, land on a real
 * page with an Edit button" pattern as Company and Person, rather than the
 * edit modal being the only place to see the whole thing.
 */
export function JobListingDetailPage() {
  const { id } = useParams()
  const listingId = Number(id)
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? null
  const { notify } = useToast()

  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  const detail = useResource(() => jobListings.get(listingId), [listingId])
  const apps = useResource(() => applicationsApi.list({ listing: listingId }), [listingId])

  if (detail.initial) return <Loading />
  if (!detail.data) {
    return <ErrorState message={detail.error || 'Listing not found.'} onRetry={detail.reload} />
  }

  const listing = detail.data

  async function remove() {
    setDeleting(true)
    setDeleteError('')
    try {
      await jobListings.remove(listingId)
      notify('Listing deleted.')
      navigate(from ?? '/job-directory?tab=listings', { replace: true })
    } catch (err) {
      // A listing with applications referencing it is blocked server-side
      // (PROTECT) — surface that reason rather than a generic failure.
      setDeleteError(formatApiError(err))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <Link
        to={from ?? '/job-directory?tab=listings'}
        className="mb-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-3 transition-colors hover:text-ink"
      >
        <Icon name="chevronLeft" size={15} />
        {from ? 'Back' : 'Job Directory'}
      </Link>

      <PageHeader
        title={listing.role_name}
        subtitle={
          <span className="flex flex-wrap items-center gap-1.5">
            <Link
              to={`/job-directory/companies/${listing.company}`}
              state={{ from: `${location.pathname}${location.search}` }}
              className="text-brand hover:underline"
            >
              {listing.company_name}
            </Link>
            {listing.location_name ? (
              <span className="text-ink-3">· {listing.location_name}</span>
            ) : null}
            {listing.linkedin_application_count > 0 ? (
              <span
                title={`${listing.linkedin_application_count} application${listing.linkedin_application_count === 1 ? '' : 's'} via LinkedIn`}
                className="inline-flex items-center gap-0.5 rounded-full bg-[#0a66c2]/10 px-1.5 py-0.5 text-[10.5px] font-semibold text-[#0a66c2]"
              >
                <Icon name="link" size={11} />
                {listing.linkedin_application_count} via LinkedIn
              </span>
            ) : null}
          </span>
        }
        action={
          <>
            {listing.job_url ? (
              <Button
                onClick={() => window.open(listing.job_url ?? undefined, '_blank', 'noreferrer')}
                icon={<Icon name="link" size={15} />}
              >
                View posting
              </Button>
            ) : null}
            <Button onClick={() => setEditing(true)} icon={<Icon name="edit" size={15} />}>
              Edit
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card>
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <Detail label="Role type" value={listing.role_type_display || '—'} />
              <Detail label="Work arrangement" value={listing.work_arrangement_display || '—'} />
              <Detail label="Opens" value={listing.opened_at ? formatDate(listing.opened_at) : '—'} />
              <Detail label="Closes" value={listing.closing_at ? formatDate(listing.closing_at) : '—'} />
            </dl>

            {listing.skills_list.length ? (
              <div className="mt-4 border-t border-line pt-4">
                <p className="mb-2 text-[11.5px] font-medium uppercase tracking-wide text-ink-3">
                  Skills
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {listing.skills_list.map((skill) => (
                    <span
                      key={skill}
                      className="rounded-full bg-brand-soft px-2 py-0.5 text-[12px] font-medium text-brand-strong"
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {listing.description ? (
              <div className="mt-4 border-t border-line pt-4">
                <p className="mb-1 text-[11.5px] font-medium uppercase tracking-wide text-ink-3">
                  Description
                </p>
                <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink-2">
                  {listing.description}
                </p>
              </div>
            ) : null}
          </Card>

          <Card>
            <CardHeader title="Danger Zone" />
            {deleteError ? (
              <p role="alert" className="mt-2 text-[12.5px] text-critical">
                {deleteError}
              </p>
            ) : null}
            <Button
              variant="danger"
              className="mt-3 w-full"
              onClick={() => setConfirmDelete(true)}
              icon={<Icon name="trash" size={15} />}
            >
              Delete listing
            </Button>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader
              title="Linked Applications"
              subtitle={
                apps.data?.length
                  ? `${apps.data.length} application${apps.data.length === 1 ? '' : 's'} cover this role`
                  : undefined
              }
            />
            {!apps.data?.length ? (
              <p className="mt-3 text-[13px] text-ink-3">
                No applications reference this listing yet.
              </p>
            ) : (
              <ul className="mt-2 divide-y divide-line">
                {apps.data.map((app) => (
                  <li key={app.id}>
                    <Link
                      to={`/applications/${app.id}`}
                      state={{ from: `${location.pathname}${location.search}` }}
                      className="-mx-2 flex items-center gap-2 rounded-lg px-2 py-2 text-[13.5px] text-ink transition-colors hover:bg-surface-2"
                    >
                      <span className="min-w-0 flex-1 truncate">{formatDate(app.applied_at)}</span>
                      <Badge tone={OUTCOME_TONE[app.outcome] ?? 'neutral'}>{app.outcome_display}</Badge>
                      <Icon name="chevronRight" size={15} className="text-ink-3" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <ListingForm
        open={editing}
        listing={listing}
        onClose={() => setEditing(false)}
        onSaved={() => detail.reload()}
      />

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this listing?"
        description="Applications that link to it block the delete instead of silently losing it."
        footer={
          <>
            <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button variant="danger" loading={deleting} onClick={() => void remove()}>
              Delete
            </Button>
          </>
        }
      >
        <p className="text-[13.5px] text-ink-2">
          You’re about to remove <strong>{listing.role_name}</strong> at{' '}
          <strong>{listing.company_name}</strong> from the Job Directory.
        </p>
      </Modal>
    </>
  )
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11.5px] font-medium uppercase tracking-wide text-ink-3">{label}</dt>
      <dd className="mt-0.5 text-[13.5px] text-ink">{value}</dd>
    </div>
  )
}
