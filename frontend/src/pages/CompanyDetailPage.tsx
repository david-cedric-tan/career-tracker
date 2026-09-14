import { useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { formatApiError } from '../api/client'
import { applications as applicationsApi, companies, jobListings, people } from '../api/resources'
import type { JobListing } from '../api/types'
import { PageHeader } from '../components/layout/PageHeader'
import { Badge } from '../components/ui/Badge'
import { CompanyMark } from '../components/ui/CompanyMark'
import { Button } from '../components/ui/Button'
import { Card, CardHeader } from '../components/ui/Card'
import { ImagePicker } from '../components/ui/ImagePicker'
import { Icon } from '../components/ui/Icon'
import { Modal } from '../components/ui/Modal'
import { ErrorState, Loading } from '../components/ui/States'
import { useToast } from '../components/ui/toast-context'
import { useResource } from '../hooks/useResource'
import { formatDate } from '../lib/format'
import { OUTCOME_TONE, PERSON_STATUS_TONE } from '../lib/tones'
import { Avatar } from '../components/ui/Avatar'
import { MentionTextarea } from '../components/ui/Mention'
import { TaggedInPanel } from '../components/TaggedInPanel'
import { CompanyEditModal, ListingForm } from './JobDirectoryPage'

/**
 * A company's full profile — the same "click the row, land on a real page
 * with an Edit button" pattern as PersonDetailPage, rather than jumping
 * straight into an edit modal from the list.
 */
export function CompanyDetailPage() {
  const { id } = useParams()
  const companyId = Number(id)
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? null
  const { notify } = useToast()

  const [editing, setEditing] = useState(false)
  const [listingFormOpen, setListingFormOpen] = useState(false)
  const [editingListing, setEditingListing] = useState<JobListing | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const detail = useResource(() => companies.get(companyId), [companyId])
  const listings = useResource(() => jobListings.list({ company: companyId }), [companyId])
  const apps = useResource(() => applicationsApi.list({ company: companyId }), [companyId])
  const connections = useResource(() => people.list({ company: companyId }), [companyId])
  const note = useResource(() => companies.getNote(companyId), [companyId])

  if (detail.initial) return <Loading />
  if (!detail.data) {
    return <ErrorState message={detail.error || 'Company not found.'} onRetry={detail.reload} />
  }

  const company = detail.data

  async function remove() {
    try {
      await companies.remove(companyId)
      notify('Company deleted.')
      navigate('/job-directory', { replace: true })
    } catch (err) {
      notify(formatApiError(err), 'error')
    }
  }

  function openNewListing() {
    setEditingListing(null)
    setListingFormOpen(true)
  }

  return (
    <>
      <Link
        to={from ?? '/job-directory'}
        className="mb-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-3 transition-colors hover:text-ink"
      >
        <Icon name="chevronLeft" size={15} />
        {from ? 'Back' : 'Job Directory'}
      </Link>

      <PageHeader
        title={company.short_name || company.name}
        mark={<CompanyMark name={company.name} logo={company.logo} size={44} />}
        subtitle={
          <span className="flex flex-wrap items-center gap-1.5">
            {company.industry_names.map((name) => (
              <Badge key={name} tone="brand">
                {name}
              </Badge>
            ))}
            {company.region_names.map((name) => (
              <Badge key={name}>{name}</Badge>
            ))}
            {company.short_name ? <span className="text-ink-3">{company.name}</span> : null}
          </span>
        }
        action={
          <>
            <Button variant="primary" onClick={openNewListing} icon={<Icon name="plus" size={15} />}>
              New listing
            </Button>
            <Button onClick={() => setEditing(true)} icon={<Icon name="edit" size={15} />}>
              Edit
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card>
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
              <ImagePicker
                className="sm:w-60 sm:shrink-0"
                name={company.name}
                src={company.logo}
                size="lg"
                shape="square"
                label="logo"
                onUpload={async (file) => {
                  detail.setData(await companies.uploadLogo(company.id, file))
                  notify('Logo updated.')
                }}
                onRemove={
                  company.logo
                    ? async () => {
                        detail.setData(await companies.removeLogo(company.id))
                        notify('Logo removed.')
                      }
                    : undefined
                }
              />
              <dl className="grid flex-1 gap-x-6 gap-y-3 sm:grid-cols-2">
                <Detail label="Legal name" value={company.name} />
                <Detail label="Short name" value={company.short_name || '—'} />
                <Detail
                  label="Industries"
                  value={company.industry_names.length ? company.industry_names.join(', ') : '—'}
                />
                <Detail
                  label="Regions"
                  value={company.region_names.length ? company.region_names.join(', ') : '—'}
                />
              </dl>
            </div>
          </Card>

          <MyNotesCard companyId={companyId} note={note.data?.notes ?? ''} loading={note.initial} />

          <Card padded={false}>
            <div className="p-4 sm:p-5">
              <CardHeader
                title="Job Listings"
                subtitle={
                  listings.data?.length
                    ? `${listings.data.length} posting${listings.data.length === 1 ? '' : 's'} at this company`
                    : 'Postings for this company'
                }
              />
            </div>
            {listings.initial ? (
              <div className="px-5 pb-5">
                <Loading />
              </div>
            ) : !listings.data?.length ? (
              <p className="px-4 pb-5 text-[13px] text-ink-3 sm:px-5">
                No listings yet — add one above.
              </p>
            ) : (
              <ul className="divide-y divide-line border-t border-line">
                {listings.data.map((listing) => (
                  <li key={listing.id}>
                    <Link
                      to={`/job-directory/listings/${listing.id}`}
                      state={{ from: `${location.pathname}${location.search}` }}
                      className="flex w-full flex-col gap-1.5 px-4 py-3 text-left transition-colors hover:bg-surface-2 sm:px-5"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-medium text-ink">{listing.role_name}</span>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {listing.linkedin_application_count > 0 ? (
                            <span
                              title={`${listing.linkedin_application_count} application${listing.linkedin_application_count === 1 ? '' : 's'} via LinkedIn`}
                              className="inline-flex items-center gap-0.5 rounded-full bg-[#0a66c2]/10 px-1.5 py-0.5 text-[10.5px] font-semibold text-[#0a66c2]"
                            >
                              <Icon name="link" size={11} />
                              {listing.linkedin_application_count} via LinkedIn
                            </span>
                          ) : null}
                          {listing.job_url ? (
                            <a
                              href={listing.job_url}
                              target="_blank"
                              rel="noreferrer noopener"
                              onClick={(event) => event.stopPropagation()}
                              className="text-ink-3 transition-colors hover:text-brand"
                            >
                              <Icon name="link" size={13} />
                            </a>
                          ) : null}
                        </div>
                      </div>
                      <p className="flex flex-wrap gap-x-2 text-[12px] text-ink-3">
                        {listing.location_name ? <span>{listing.location_name}</span> : null}
                        {listing.work_arrangement_display ? (
                          <span>{listing.work_arrangement_display}</span>
                        ) : null}
                        {listing.closing_at ? <span>Closes {formatDate(listing.closing_at)}</span> : null}
                      </p>
                      {listing.description ? (
                        <p className="line-clamp-2 text-[12.5px] text-ink-2">{listing.description}</p>
                      ) : null}
                      {listing.skills_list.length ? (
                        <div className="flex flex-wrap gap-1">
                          {listing.skills_list.map((skill) => (
                            <span
                              key={skill}
                              className="rounded-full bg-brand-soft px-1.5 py-0.5 text-[10.5px] font-medium text-brand-strong"
                            >
                              {skill}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader
              title="Known Connections"
              subtitle={
                connections.data?.length
                  ? `${connections.data.length} of your contacts here`
                  : undefined
              }
              action={
                <Link
                  to="/network"
                  className="text-[12.5px] font-medium text-brand hover:underline"
                >
                  Network
                </Link>
              }
            />
            {!connections.data?.length ? (
              <p className="mt-3 text-[13px] text-ink-3">
                No contacts tied to this company yet.
              </p>
            ) : (
              <ul className="mt-2 divide-y divide-line">
                {connections.data.map((person) => (
                  <li key={person.id}>
                    <Link
                      to={`/network/${person.id}`}
                      state={{ from: `${location.pathname}${location.search}` }}
                      className="-mx-2 flex items-center gap-2.5 rounded-lg px-2 py-2 text-[13.5px] text-ink transition-colors hover:bg-surface-2"
                    >
                      <Avatar name={person.full_name} src={person.photo} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{person.full_name}</span>
                        {person.title ? (
                          <span className="block truncate text-[11.5px] text-ink-3">
                            {person.title}
                          </span>
                        ) : null}
                      </span>
                      <Badge tone={PERSON_STATUS_TONE[person.status] ?? 'neutral'}>
                        {person.status_display}
                      </Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Applications"
              action={
                <Link
                  to={`/applications?company=${company.id}`}
                  className="text-[12.5px] font-medium text-brand hover:underline"
                >
                  All Applications
                </Link>
              }
            />
            {!apps.data?.length ? (
              <p className="mt-3 text-[13px] text-ink-3">No applications logged yet.</p>
            ) : (
              <ul className="mt-2 divide-y divide-line">
                {apps.data.map((app) => (
                  <li key={app.id}>
                    <Link
                      to={`/applications/${app.id}`}
                      state={{ from: `${location.pathname}${location.search}` }}
                      className="-mx-2 flex items-center gap-2 rounded-lg px-2 py-2 text-[13.5px] text-ink transition-colors hover:bg-surface-2"
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {app.role_names.length ? app.role_names.join(', ') : formatDate(app.applied_at)}
                      </span>
                      <Badge tone={OUTCOME_TONE[app.outcome] ?? 'neutral'}>{app.outcome_display}</Badge>
                      <Icon name="chevronRight" size={15} className="text-ink-3" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <TaggedInPanel tag={(company.short_name || company.name).replace(/\s+/g, '')} />

          <Card>
            <CardHeader title="Danger Zone" />
            <Button
              variant="danger"
              className="mt-3 w-full"
              onClick={() => setConfirmDelete(true)}
              icon={<Icon name="trash" size={15} />}
            >
              Delete company
            </Button>
          </Card>
        </div>
      </div>

      <CompanyEditModal
        company={company}
        open={editing}
        onClose={() => {
          setEditing(false)
          detail.reload()
        }}
        onSaved={() => detail.reload()}
      />

      <ListingForm
        open={listingFormOpen}
        listing={editingListing}
        defaultCompany={company.id}
        onClose={() => setListingFormOpen(false)}
        onSaved={listings.reload}
      />

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this company?"
        description="Its listings and logo go with it. Applications that reference it block the delete instead of silently losing their company."
        footer={
          <>
            <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button variant="danger" onClick={() => void remove()}>
              Delete
            </Button>
          </>
        }
      >
        <p className="text-[13.5px] text-ink-2">
          You’re about to remove <strong>{company.name}</strong> from the Job Directory.
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

/**
 * Private to this user — a company is shared reference data, but "recruiter
 * said follow up in March" is one person's read on it, not a fact everyone
 * tracking that company should see (see backend `CompanyNote`).
 *
 * Explicit Save rather than autosave: a note field with `@` mentions is
 * exactly the kind of text where losing focus mid-thought (to click a
 * suggestion) shouldn't trigger a network write on every keystroke.
 */
function MyNotesCard({
  companyId,
  note,
  loading,
}: {
  companyId: number
  note: string
  loading: boolean
}) {
  const { notify } = useToast()
  const [value, setValue] = useState(note)
  const [saving, setSaving] = useState(false)

  const [syncedFor, setSyncedFor] = useState<string | null>(null)
  if (!loading && syncedFor !== `${companyId}:${note}`) {
    setSyncedFor(`${companyId}:${note}`)
    setValue(note)
  }

  const dirty = value !== note

  async function save() {
    setSaving(true)
    try {
      await companies.setNote(companyId, value)
      notify('Note saved.')
    } catch (err) {
      notify(formatApiError(err), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader
        title="My Notes"
        subtitle="Private to you — not shared with anyone else tracking this company."
      />
      <div className="mt-3">
        <MentionTextarea
          value={value}
          onChange={setValue}
          rows={4}
          placeholder="Recruiter said follow up in March… (@ to tag a contact, company or place)"
        />
      </div>
      {dirty ? (
        <div className="mt-2 flex justify-end">
          <Button size="sm" variant="primary" loading={saving} onClick={() => void save()}>
            Save note
          </Button>
        </div>
      ) : null}
    </Card>
  )
}
