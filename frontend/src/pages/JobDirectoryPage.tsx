import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { formatApiError } from '../api/client'
import {
  companies,
  countries,
  industries,
  jobListings,
  locations,
  roles,
  states,
  venues,
} from '../api/resources'
import { applications } from '../api/resources'
import type {
  Company,
  Country,
  Industry,
  JobListing,
  Location,
  Role,
  State,
  Venue,
} from '../api/types'
import { IndustryBubbleView } from '../components/catalog/IndustryBubbleView'
import { ImportListingModal } from '../components/ImportListingModal'
import { PageHeader } from '../components/layout/PageHeader'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, CardHeader } from '../components/ui/Card'
import { Combobox, MultiSelect } from '../components/ui/Combobox'
import { CompanyMark } from '../components/ui/CompanyMark'
import { Input, Select, Textarea } from '../components/ui/Field'
import { Icon } from '../components/ui/Icon'
import { ImagePicker } from '../components/ui/ImagePicker'
import { Modal } from '../components/ui/Modal'
import { EmptyState, Loading } from '../components/ui/States'
import { useToast } from '../components/ui/toast-context'
import { useAutoOpenFromQuery } from '../hooks/useAutoOpenFromQuery'
import { useResource } from '../hooks/useResource'
import { cx, formatDate } from '../lib/format'
import { countryFlag } from '../lib/countryFlag'
import { rememberList, rememberViewState, readViewState } from '../lib/listState'

const TABS = [
  { value: 'companies', label: 'Companies' },
  { value: 'listings', label: 'Job listings' },
  { value: 'roles', label: 'Roles' },
  { value: 'places', label: 'Places' },
] as const

type Tab = (typeof TABS)[number]['value']

function isTab(value: string | null): value is Tab {
  return TABS.some((option) => option.value === value)
}

/**
 * A section title that explains itself on hover.
 *
 * The explanation used to sit behind an "i" bubble beside every heading —
 * four of them on this page, each a small piece of permanent furniture for a
 * sentence you read once. The title itself carries it now: the app's tooltip
 * layer styles plain `title` attributes, so the hint is one hover away and
 * nothing extra is drawn.
 */
function TitleWithHint({ title, hint }: { title: string; hint: string }) {
  return (
    <span title={hint} className="cursor-help">
      {title}
    </span>
  )
}

export function JobDirectoryPage() {
  const [params, setParams] = useSearchParams()
  const [tab, setTab] = useState<Tab>(() => {
    const requested = params.get('tab')
    return isTab(requested) ? requested : 'companies'
  })

  // The tour's "try it" action arrives as `?tab=listings` on a page that may
  // already be mounted (its own per-step nav already put you on /catalog) —
  // a lazy useState initializer only runs once, so it'd miss that. Ordinary
  // in-page tab clicks write the URL below, so this only reacts to outside
  // navigations that change the param.
  const [lastTabParam, setLastTabParam] = useState(params.get('tab'))
  if (params.get('tab') !== lastTabParam) {
    setLastTabParam(params.get('tab'))
    if (isTab(params.get('tab'))) setTab(params.get('tab') as Tab)
  }

  function selectTab(next: Tab) {
    setTab(next)
    const url = new URLSearchParams(params)
    if (next === 'companies') url.delete('tab')
    else url.set('tab', next)
    setParams(url, { replace: true })
  }

  useEffect(() => {
    rememberList('job-directory', params.toString() ? `?${params}` : '')
  }, [params])

  const companyCount = useResource(() => companies.list().then((rows) => rows.length), [])

  return (
    <>
      <PageHeader
        title={
          <span
            title="Shared reference data — companies, roles, listings and locations."
            className="cursor-help"
          >
            Job Directory
          </span>
        }
        subtitle={
          companyCount.data == null
            ? undefined
            : `${companyCount.data} ${companyCount.data === 1 ? 'company' : 'companies'} logged so far`
        }
      />

      <div className="mb-4 inline-flex flex-wrap rounded-lg border border-line bg-surface p-0.5">
        {TABS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => selectTab(option.value)}
            aria-pressed={tab === option.value}
            className={cx(
              'rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors',
              tab === option.value
                ? 'bg-brand-soft text-brand-strong'
                : 'text-ink-2 hover:text-ink',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      {tab === 'companies' ? <CompaniesTab /> : null}
      {tab === 'listings' ? <ListingsTab /> : null}
      {tab === 'roles' ? <RolesTab /> : null}
      {tab === 'places' ? <PlacesTab /> : null}
    </>
  )
}

/**
 * Generic rename-or-delete modal for the name-only reference entities (Role,
 * Location) — the same click-the-row-to-edit pattern as Network and
 * Applications, just without the extra fields Company/Listing need.
 */
function EditNameModal({
  open,
  onClose,
  title,
  label,
  name,
  onSave,
  onDelete,
}: {
  open: boolean
  onClose: () => void
  title: string
  label: string
  name: string
  onSave: (name: string) => Promise<void>
  onDelete: () => Promise<void>
}) {
  const { notify } = useToast()
  const [value, setValue] = useState(name)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const [lastOpen, setLastOpen] = useState(open)
  if (open !== lastOpen) {
    setLastOpen(open)
    if (open) {
      setValue(name)
      setConfirmDelete(false)
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!value.trim()) return
    setSaving(true)
    try {
      await onSave(value.trim())
      onClose()
    } catch (err) {
      notify(formatApiError(err), 'error')
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    setDeleting(true)
    try {
      await onDelete()
      onClose()
    } catch (err) {
      notify(formatApiError(err), 'error')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        confirmDelete ? (
          <>
            <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button variant="danger" onClick={remove} loading={deleting}>
              Confirm delete
            </Button>
          </>
        ) : (
          <>
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>
              Delete
            </Button>
            <Button type="submit" form="edit-name-form" variant="primary" loading={saving}>
              Save
            </Button>
          </>
        )
      }
    >
      <form id="edit-name-form" onSubmit={save}>
        <Input label={label} required value={value} onChange={(event) => setValue(event.target.value)} />
      </form>
    </Modal>
  )
}

/** A name-only catalog with inline add — Roles use it directly. Each badge is
    a click-to-edit trigger for the same entity, not a static label. */
function SimpleCatalog<T extends { id: number; name: string }>({
  title,
  hint,
  placeholder,
  load,
  ensure,
  update,
  remove,
}: {
  title: string
  hint: string
  placeholder: string
  load: () => Promise<T[]>
  ensure: (name: string) => Promise<T>
  update: (id: number, name: string) => Promise<T>
  remove: (id: number) => Promise<void>
}) {
  const { notify } = useToast()
  const list = useResource(load, [])
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState<T | null>(null)
  const singular = title.replace(/s$/, '')

  async function add(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    try {
      await ensure(name.trim())
      setName('')
      list.reload()
      notify(`${singular} saved.`)
    } catch (err) {
      notify(formatApiError(err), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader title={<TitleWithHint title={title} hint={hint} />} />
      <form onSubmit={add} className="mt-3 flex gap-2">
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={placeholder}
          aria-label={`New ${title.toLowerCase()}`}
          wrapperClassName="flex-1"
        />
        <Button type="submit" variant="primary" loading={saving} icon={<Icon name="plus" size={15} />}>
          Add
        </Button>
      </form>

      {list.initial ? (
        <Loading />
      ) : !list.data?.length ? (
        <p className="py-6 text-center text-[13px] text-ink-3">Nothing here yet.</p>
      ) : (
        <ul className="mt-4 flex flex-wrap gap-1.5">
          {list.data.map((entry) => (
            <li key={entry.id}>
              <button type="button" onClick={() => setEditing(entry)}>
                <Badge className="cursor-pointer transition-colors hover:bg-brand-soft hover:text-brand-strong">
                  {entry.name}
                </Badge>
              </button>
            </li>
          ))}
        </ul>
      )}

      {editing ? (
        <EditNameModal
          open={editing !== null}
          onClose={() => setEditing(null)}
          title={`Edit ${singular.toLowerCase()}`}
          label={singular}
          name={editing.name}
          onSave={async (value) => {
            await update(editing.id, value)
            list.reload()
            notify(`${singular} saved.`)
          }}
          onDelete={async () => {
            await remove(editing.id)
            list.reload()
            notify(`${singular} deleted.`)
          }}
        />
      ) : null}
    </Card>
  )
}

function RolesTab() {
  return (
    <SimpleCatalog<Role>
      title="Roles"
      hint="Role names shared across every company's listings."
      placeholder="Graduate Software Engineer"
      load={() => roles.list()}
      ensure={(name) => roles.ensure({ name })}
      update={(id, name) => roles.update(id, { name })}
      remove={(id) => roles.remove(id)}
    />
  )
}

const COMPANY_VIEWS = [
  { value: 'bubbles', label: 'Bubbles', icon: 'sparkles' },
  { value: 'list', label: 'List', icon: 'table' },
] as const
type CompanyView = (typeof COMPANY_VIEWS)[number]['value']

function CompaniesTab() {
  const { notify } = useToast()
  const list = useResource(() => companies.list(), [])
  const industryList = useResource(() => industries.list(), [])
  const listingsList = useResource(() => jobListings.list(), [])
  const saved = readViewState<{
    search?: string
    industryFilter?: number | null
    view?: CompanyView
  }>('job-directory-companies')
  const [search, setSearch] = useState(saved?.search ?? '')
  const [industryFilter, setIndustryFilter] = useState<number | null>(
    saved?.industryFilter ?? null,
  )
  const [adding, setAdding] = useState(false)
  const [addingIndustry, setAddingIndustry] = useState(false)
  const [managingIndustries, setManagingIndustries] = useState(false)
  const [editingIndustry, setEditingIndustry] = useState<Industry | null>(null)
  // Bubbles first: the rings show industry, size and logos at a glance, which
  // is what this tab is usually opened to survey. The list is a click away.
  const [view, setView] = useState<CompanyView>(saved?.view ?? 'bubbles')

  useEffect(() => {
    rememberViewState('job-directory-companies', { search, industryFilter, view })
  }, [search, industryFilter, view])

  const filtered = (list.data ?? []).filter((company) => {
    const needle = search.trim().toLowerCase()
    const matchesName =
      !needle ||
      company.name.toLowerCase().includes(needle) ||
      company.short_name.toLowerCase().includes(needle)
    const matchesIndustry = industryFilter === null || company.industries.includes(industryFilter)
    return matchesName && matchesIndustry
  })

  const filtering = search.trim() !== '' || industryFilter !== null

  return (
    <>
      {/* Same shape as Network and Applications: a toolbar straight on the
          page, then the rings — no card wrapped around the whole tab. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search company name…"
          aria-label="Search companies"
          wrapperClassName="min-w-[14rem] flex-1"
        />
        <Combobox
          value={industryFilter}
          onChange={setIndustryFilter}
          options={(industryList.data ?? []).map((entry) => ({
            id: entry.id,
            label: entry.name,
          }))}
          placeholder="All Industries"
          className="w-full sm:w-56"
        />
        <div className="inline-flex shrink-0 rounded-lg border border-line bg-surface p-0.5">
          {COMPANY_VIEWS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setView(option.value)}
              aria-pressed={view === option.value}
              title={`${option.label} view`}
              className={cx(
                'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors',
                view === option.value
                  ? 'bg-brand-soft text-brand-strong'
                  : 'text-ink-2 hover:text-ink',
              )}
            >
              <Icon name={option.icon} size={15} />
              <span className="hidden sm:inline">{option.label}</span>
            </button>
          ))}
        </div>
        <Button onClick={() => setManagingIndustries(true)} icon={<Icon name="settings" size={15} />}>
          Industries
        </Button>
        <Button
          variant="primary"
          onClick={() => setAdding(true)}
          icon={<Icon name="plus" size={15} />}
        >
          Add company
        </Button>
      </div>

      {filtering ? (
        <div className="mb-3 flex items-center gap-2 text-[12px] text-ink-2">
          <span>
            {filtered.length} of {list.data?.length ?? 0}
          </span>
          <button
            type="button"
            onClick={() => {
              setSearch('')
              setIndustryFilter(null)
            }}
            className="font-medium text-brand hover:underline"
          >
            Clear filters
          </button>
        </div>
      ) : null}

      {list.initial ? (
        <Loading />
      ) : !list.data?.length ? (
        <Card padded={false}>
          <EmptyState icon="building" title="No companies yet" />
        </Card>
      ) : filtered.length === 0 ? (
        <Card padded={false}>
          <EmptyState icon="search" title="No company matches those filters" />
        </Card>
      ) : view === 'bubbles' ? (
        <IndustryBubbleView
          companies={filtered}
          listings={listingsList.data ?? []}
          industries={industryList.data ?? []}
        />
      ) : (
        <Card padded={false}>
          <ul className="divide-y divide-line">
            {filtered.map((company: Company) => (
              <li key={company.id}>
                <div className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2 sm:px-5">
                  <CompanyLogoButton company={company} onSaved={list.reload} />
                  <CompanyEditTrigger company={company} onSaved={list.reload} />
                  <div className="flex flex-wrap gap-1">
                    {company.industry_names.map((name) => (
                      <Badge key={name}>{name}</Badge>
                    ))}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Modal
        open={managingIndustries}
        onClose={() => setManagingIndustries(false)}
        title="Industries"
        description="Optional grouping for companies — click one to filter the list by it."
        footer={
          <>
            <Button onClick={() => setAddingIndustry(true)} icon={<Icon name="plus" size={14} />}>
              Add industry
            </Button>
            <Button variant="primary" onClick={() => setManagingIndustries(false)}>
              Done
            </Button>
          </>
        }
      >
        {industryList.initial ? (
          <Loading />
        ) : !industryList.data?.length ? (
          <p className="text-[13px] text-ink-3">None yet — add your first one below.</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {industryList.data.map((entry) => (
              <li key={entry.id}>
                {/* Two jobs, two targets: the name filters the list, the
                    pencil renames or deletes. Same split the city chips use
                    under Places. */}
                <span
                  className={cx(
                    'inline-flex items-center gap-0.5 rounded-full border py-1 pl-1 pr-1 text-[12.5px] transition-colors',
                    industryFilter === entry.id
                      ? 'border-brand-ring bg-brand-soft text-brand-strong'
                      : 'border-line bg-surface-2 text-ink-2',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setIndustryFilter((current) => (current === entry.id ? null : entry.id))
                      setManagingIndustries(false)
                    }}
                    title={industryFilter === entry.id ? 'Clear filter' : `Filter by ${entry.name}`}
                    className="rounded-full px-2 py-0.5 hover:text-brand-strong"
                  >
                    {entry.name}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingIndustry(entry)}
                    aria-label={`Edit ${entry.name}`}
                    className="rounded-full p-1 text-ink-3 hover:bg-surface hover:text-ink"
                  >
                    <Icon name="edit" size={11} />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Modal>

      {editingIndustry ? (
        <EditNameModal
          open={editingIndustry !== null}
          onClose={() => setEditingIndustry(null)}
          title="Edit industry"
          label="Industry"
          name={editingIndustry.name}
          onSave={async (value) => {
            await industries.update(editingIndustry.id, { name: value })
            industryList.reload()
            notify('Industry saved.')
          }}
          onDelete={async () => {
            await industries.remove(editingIndustry.id)
            // A deleted industry can't stay as the active filter.
            setIndustryFilter((current) => (current === editingIndustry.id ? null : current))
            industryList.reload()
            list.reload()
            notify('Industry deleted.')
          }}
        />
      ) : null}

      <AddIndustryModal
        open={addingIndustry}
        onClose={() => setAddingIndustry(false)}
        onSaved={industryList.reload}
      />

      <AddCompanyModal
        open={adding}
        onClose={() => setAdding(false)}
        industries={industryList.data ?? []}
        onSaved={list.reload}
      />
    </>
  )
}

/** Creating a company, with the details that used to be inline on the tab —
    plus the regions and short name that previously needed a second trip
    through the edit modal. */
function AddCompanyModal({
  open,
  onClose,
  industries: industryOptions,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  industries: Industry[]
  onSaved: () => void
}) {
  const { notify } = useToast()
  const countryList = useResource(() => countries.list(), [])
  const [name, setName] = useState('')
  const [shortName, setShortName] = useState('')
  const [industryIds, setIndustryIds] = useState<number[]>([])
  const [regionIds, setRegionIds] = useState<number[]>([])
  const [saving, setSaving] = useState(false)
  // A logo picked before the company exists. Uploading needs an id, so it's
  // held here and sent as soon as the company is created — rather than making
  // you save, reopen and edit just to add the mark.
  const [pendingLogo, setPendingLogo] = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)

  const [lastOpen, setLastOpen] = useState(open)
  if (open !== lastOpen) {
    setLastOpen(open)
    if (open) {
      setName('')
      setShortName('')
      setIndustryIds([])
      setRegionIds([])
      setPendingLogo(null)
      setLogoPreview(null)
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    try {
      const created = await companies.ensure({ name: name.trim() })
      // `ensure` is get-or-create by name only, so everything else goes on
      // in a follow-up patch.
      if (shortName.trim() || regionIds.length || industryIds.length) {
        await companies.update(created.id, {
          short_name: shortName.trim(),
          regions: regionIds,
          industries: industryIds,
        })
      }
      if (pendingLogo) await companies.uploadLogo(created.id, pendingLogo)
      notify('Company saved.')
      onSaved()
      onClose()
    } catch (err) {
      notify(formatApiError(err), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a company"
      description="Shared reference data — everyone's applications can point at it."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form="add-company-form" variant="primary" loading={saving}>
            Add company
          </Button>
        </>
      }
    >
      <form id="add-company-form" onSubmit={save} className="flex flex-col gap-4">
        {/* The mark can be chosen now and is uploaded once the company has an
            id to attach it to — no save-then-reopen round trip. */}
        <ImagePicker
          name={name || 'New company'}
          src={logoPreview}
          size="lg"
          shape="square"
          label="logo"
          helpText="Optional — drop an image here or pick one. Added when you save."
          onUpload={async (file) => {
            setPendingLogo(file)
            setLogoPreview(URL.createObjectURL(file))
          }}
          onRemove={async () => {
            setPendingLogo(null)
            setLogoPreview(null)
          }}
        />
        <Input
          label="Name"
          required
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Atlassian"
        />
        <Input
          label="Short name"
          value={shortName}
          onChange={(event) => setShortName(event.target.value)}
          placeholder="e.g. IBM"
          help="Optional — shown instead of the full name in tight spaces."
        />
        <MultiSelect
          label="Industries"
          value={industryIds}
          onChange={setIndustryIds}
          options={industryOptions.map((entry) => ({ id: entry.id, label: entry.name }))}
          emptyText="None yet — add one from the Industries panel on the right."
          help="Optional — a company can span more than one, e.g. a bank's tech arm."
        />
        <MultiSelect
          label="Regions"
          value={regionIds}
          onChange={setRegionIds}
          options={(countryList.data ?? []).map((entry) => ({ id: entry.id, label: entry.name }))}
          emptyText="No countries in the Job Directory yet — add one from the Places tab."
          help="Optional — where this company operates. Powers the dashboard's region map."
        />
      </form>
    </Modal>
  )
}

/** Industries are otherwise only creatable in passing, from a company form —
    this makes the catalog itself editable on its own terms. */
function AddIndustryModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const { notify } = useToast()
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)

  const [lastOpen, setLastOpen] = useState(open)
  if (open !== lastOpen) {
    setLastOpen(open)
    if (open) setName('')
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    try {
      await industries.ensure({ name: name.trim() })
      notify('Industry saved.')
      onSaved()
      onClose()
    } catch (err) {
      notify(formatApiError(err), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add an industry"
      description="A grouping companies can be filed under."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form="add-industry-form" variant="primary" loading={saving}>
            Add industry
          </Button>
        </>
      }
    >
      <form id="add-industry-form" onSubmit={save}>
        <Input
          label="Name"
          required
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Professional services"
        />
      </form>
    </Modal>
  )
}

function ListingsTab() {
  const navigate = useNavigate()
  const [formOpen, setFormOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const list = useResource(() => jobListings.list(), [])
  const listingChoices = useResource(() => applications.choices(), [])
  const saved = readViewState<{
    search?: string
    roleType?: string
    arrangement?: string
    openOnly?: boolean
  }>('job-directory-listings')
  const [search, setSearch] = useState(saved?.search ?? '')
  const [roleType, setRoleType] = useState(saved?.roleType ?? '')
  const [arrangement, setArrangement] = useState(saved?.arrangement ?? '')
  // Closed postings are history; the useful default is what you can still
  // apply to. Remembered per browser once you change it.
  const [openOnly, setOpenOnly] = useState(saved?.openOnly ?? true)

  useEffect(() => {
    rememberViewState('job-directory-listings', { search, roleType, arrangement, openOnly })
  }, [search, roleType, arrangement, openOnly])

  // The onboarding tour's "try it" action for this tab — `?new=1` opens the
  // same form the "New job listing" button does.
  useAutoOpenFromQuery('new', () => setFormOpen(true))

  const today = new Date().toISOString().slice(0, 10)
  const filtered = (list.data ?? []).filter((listing: JobListing) => {
    const needle = search.trim().toLowerCase()
    const matchesSearch =
      !needle ||
      [
        listing.role_name,
        listing.company_name,
        listing.location_name ?? '',
        listing.skills,
      ].some((field) => field.toLowerCase().includes(needle))
    const matchesRoleType = !roleType || listing.role_type === roleType
    const matchesArrangement = !arrangement || listing.work_arrangement === arrangement
    // A listing with no closing date never expires, so it counts as open.
    const matchesOpen = !openOnly || !listing.closing_at || listing.closing_at >= today
    return matchesSearch && matchesRoleType && matchesArrangement && matchesOpen
  })

  return (
    <>
      <Card padded={false}>
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5">
          <CardHeader
            title={
              <TitleWithHint
                title="Job Listings"
                hint="Concrete postings — a role at a company, in a location."
              />
            }
          />
          <div className="flex shrink-0 items-center gap-2">
            <Button onClick={() => setImportOpen(true)} icon={<Icon name="sparkles" size={15} />}>
              Import listing
            </Button>
            <Button
              variant="primary"
              onClick={() => setFormOpen(true)}
              icon={<Icon name="plus" size={15} />}
            >
              New listing
            </Button>
          </div>
        </div>

        <div className="grid gap-2 px-4 pb-4 sm:grid-cols-[1fr_11rem_11rem_auto] sm:px-5">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search role, company, location or skill…"
            aria-label="Search job listings"
          />
          <Select
            value={roleType}
            onChange={(event) => setRoleType(event.target.value)}
            aria-label="Filter by role type"
          >
            <option value="">All Role Types</option>
            {(listingChoices.data?.role_type ?? []).map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </Select>
          <Select
            value={arrangement}
            onChange={(event) => setArrangement(event.target.value)}
            aria-label="Filter by work arrangement"
          >
            <option value="">All Arrangements</option>
            {(listingChoices.data?.work_arrangement ?? []).map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </Select>
          <button
            type="button"
            onClick={() => setOpenOnly((value) => !value)}
            aria-pressed={openOnly}
            title={openOnly ? 'Showing only listings still open' : 'Showing every listing'}
            className={cx(
              'inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-lg border px-4 text-sm font-medium transition-colors',
              openOnly
                ? 'border-brand bg-brand-soft text-brand-strong'
                : 'border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink',
            )}
          >
            <Icon name={openOnly ? 'check' : 'clock'} size={15} />
            Still open
          </button>
        </div>

        {list.initial ? (
          <Loading />
        ) : !list.data?.length ? (
          <EmptyState
            icon="briefcase"
            title="No listings yet"
            description="Listings can also be created straight from the application form."
          />
        ) : !filtered.length ? (
          <EmptyState
            icon="search"
            title="Nothing matches those filters"
            description="Try a different search term or clear the filters."
          />
        ) : (
          <div className="overflow-x-auto border-t border-line">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2 text-left text-[12px] uppercase tracking-wide text-ink-3">
                  <th className="px-4 py-2.5 font-medium">Role</th>
                  <th className="px-4 py-2.5 font-medium">Company</th>
                  <th className="px-4 py-2.5 font-medium">Location</th>
                  <th className="px-4 py-2.5 font-medium">Type</th>
                  <th className="px-4 py-2.5 font-medium">Closes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filtered.map((listing: JobListing) => (
                  <tr
                    key={listing.id}
                    onClick={() =>
                      navigate(`/job-directory/listings/${listing.id}`, {
                        state: { from: '/job-directory?tab=listings' },
                      })
                    }
                    className="cursor-pointer transition-colors hover:bg-surface-2"
                  >
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5">
                        {/* The name is plain text — the row itself already
                            opens the listing, and colouring the whole title as
                            a link made it hard to read. Only the icon goes out
                            to the posting. */}
                        <span className="font-medium text-ink">{listing.role_name}</span>
                        {listing.job_url ? (
                          <a
                            href={listing.job_url}
                            target="_blank"
                            rel="noreferrer noopener"
                            onClick={(event) => event.stopPropagation()}
                            title="Open the original posting"
                            aria-label={`Open the original posting for ${listing.role_name}`}
                            className="inline-flex shrink-0 items-center rounded p-0.5 text-ink-3 transition-colors hover:text-brand"
                          >
                            <Icon name="link" size={13} />
                          </a>
                        ) : null}
                        {listing.linkedin_application_count > 0 ? (
                          <span
                            title={`${listing.linkedin_application_count} LinkedIn application${listing.linkedin_application_count === 1 ? '' : 's'}`}
                            className="inline-flex items-center gap-0.5 rounded-full bg-[#0a66c2]/10 px-1.5 py-0.5 text-[10.5px] font-semibold text-[#0a66c2]"
                          >
                            <Icon name="link" size={11} />
                            {listing.linkedin_application_count}
                          </span>
                        ) : null}
                      </div>
                      {listing.skills_list.length ? (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {listing.skills_list.slice(0, 4).map((skill) => (
                            <span
                              key={skill}
                              className="rounded-full bg-brand-soft px-1.5 py-0.5 text-[10.5px] font-medium text-brand-strong"
                            >
                              {skill}
                            </span>
                          ))}
                          {listing.skills_list.length > 4 ? (
                            <span className="text-[10.5px] text-ink-3">
                              +{listing.skills_list.length - 4}
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5 text-ink-2">
                      {/* Its own link, so the row still opens the listing but
                          the company takes you to the company. */}
                      <Link
                        to={`/job-directory/companies/${listing.company}`}
                        state={{ from: '/job-directory?tab=listings' }}
                        onClick={(event) => event.stopPropagation()}
                        title={`Open ${listing.company_name}`}
                        className="flex items-center gap-2 rounded-md transition-colors hover:text-brand"
                      >
                        <CompanyMark
                          name={listing.company_name}
                          logo={listing.company_logo}
                          size={22}
                          className="rounded-md shadow-none"
                        />
                        <span className="truncate hover:underline">{listing.company_name}</span>
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-ink-2">{listing.location_name ?? '—'}</td>
                    <td className="px-4 py-2.5 text-ink-2">
                      {listing.role_type_display || '—'}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-ink-2">
                      {listing.closing_at ? formatDate(listing.closing_at) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ListingForm open={formOpen} listing={null} onClose={() => setFormOpen(false)} onSaved={list.reload} />
      <ImportListingModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={list.reload}
      />
    </>
  )
}

type ListingFormProps = {
  open: boolean
  /** null creates a new listing; a listing pre-fills the form and PATCHes it instead. */
  listing: JobListing | null
  /** Pre-selects (and locks in, visually) the company when creating fresh
      from that company's own profile page — irrelevant once editing. */
  defaultCompany?: number
  onClose: () => void
  onSaved: () => void
}

/** Body mounts only while open, so its fields reset on every close. */
export function ListingForm(props: ListingFormProps) {
  if (!props.open) return null
  return <ListingFormBody {...props} />
}

function ListingFormBody({ open, listing, defaultCompany, onClose, onSaved }: ListingFormProps) {
  const { notify } = useToast()
  const choices = useResource(() => applications.choices(), [])
  const [companyOptions, setCompanyOptions] = useState<Company[]>([])
  const [roleOptions, setRoleOptions] = useState<Role[]>([])
  const [locationOptions, setLocationOptions] = useState<Location[]>([])

  const [company, setCompany] = useState<number | null>(
    listing?.company ?? defaultCompany ?? null,
  )
  const [role, setRole] = useState<number | null>(listing?.role ?? null)
  const [location, setLocation] = useState<number | null>(listing?.location ?? null)
  const [roleType, setRoleType] = useState(listing?.role_type ?? '')
  const [arrangement, setArrangement] = useState(listing?.work_arrangement ?? '')
  const [openedAt, setOpenedAt] = useState(listing?.opened_at ?? '')
  const [closingAt, setClosingAt] = useState(listing?.closing_at ?? '')
  const [url, setUrl] = useState(listing?.job_url ?? '')
  const [description, setDescription] = useState(listing?.description ?? '')
  const [skills, setSkills] = useState(listing?.skills ?? '')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    void Promise.all([companies.list(), roles.list(), locations.list()]).then(
      ([companyRows, roleRows, locationRows]) => {
        setCompanyOptions(companyRows)
        setRoleOptions(roleRows)
        setLocationOptions(locationRows)
      },
    )
  }, [])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!company || !role) {
      setError('Pick a company and a role.')
      return
    }
    setSaving(true)
    setError('')
    const body = {
      company,
      role,
      location,
      role_type: roleType,
      work_arrangement: arrangement,
      opened_at: openedAt || null,
      closing_at: closingAt || null,
      job_url: url || null,
      description,
      skills,
    }
    try {
      if (listing) {
        await jobListings.update(listing.id, body)
        notify('Listing saved.')
      } else {
        await jobListings.create(body)
        notify('Listing created.')
      }
      onSaved()
      onClose()
    } catch (err) {
      setError(formatApiError(err))
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!listing) return
    setDeleting(true)
    try {
      await jobListings.remove(listing.id)
      notify('Listing deleted.')
      onSaved()
      onClose()
    } catch (err) {
      setError(formatApiError(err))
      setConfirmDelete(false)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={listing ? 'Edit job listing' : 'New job listing'}
      description="A posting for one role at one company."
      footer={
        confirmDelete ? (
          <>
            <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button variant="danger" onClick={remove} loading={deleting}>
              Confirm delete
            </Button>
          </>
        ) : (
          <>
            {listing ? (
              <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            ) : (
              <Button onClick={onClose}>Cancel</Button>
            )}
            <Button type="submit" form="listing-form" variant="primary" loading={saving}>
              {listing ? 'Save' : 'Create listing'}
            </Button>
          </>
        )
      }
    >
      <form id="listing-form" onSubmit={submit} className="flex flex-col gap-4">
        {error ? (
          <p role="alert" className="rounded-lg border border-critical/25 bg-critical/10 px-3 py-2 text-[13px] text-ink">
            {error}
          </p>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Combobox
            label="Company"
            required
            value={company}
            onChange={setCompany}
            options={companyOptions.map((entry) => ({ id: entry.id, label: entry.name }))}
            onCreate={async (name) => {
              const created = await companies.ensure({ name })
              setCompanyOptions((prev) => [...prev, created])
              return { id: created.id, label: created.name }
            }}
          />
          <Combobox
            label="Role"
            required
            value={role}
            onChange={setRole}
            options={roleOptions.map((entry) => ({ id: entry.id, label: entry.name }))}
            onCreate={async (name) => {
              const created = await roles.ensure({ name })
              setRoleOptions((prev) => [...prev, created])
              return { id: created.id, label: created.name }
            }}
          />
        </div>

        <Combobox
          label="Location"
          value={location}
          onChange={setLocation}
          options={locationOptions.map((entry) => ({
            id: entry.id,
            label: entry.full_name,
          }))}
          placeholder="Optional — add places in the Places tab"
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Role type"
            value={roleType}
            onChange={(event) => setRoleType(event.target.value)}
          >
            <option value="">—</option>
            {choices.data?.role_type.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </Select>
          <Select
            label="Work arrangement"
            value={arrangement}
            onChange={(event) => setArrangement(event.target.value)}
          >
            <option value="">—</option>
            {choices.data?.work_arrangement.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </Select>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Opens"
            type="date"
            value={openedAt}
            onChange={(event) => setOpenedAt(event.target.value)}
          />
          <Input
            label="Closes"
            type="date"
            value={closingAt}
            onChange={(event) => setClosingAt(event.target.value)}
            help="Must not be before the opening date."
          />
        </div>

        <Input
          label="Job URL"
          type="url"
          placeholder="https://…"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          help="Optional, but unique — it prevents duplicate postings."
        />

        <Textarea
          label="Description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={4}
          placeholder="What the posting actually says about the role…"
        />

        <Input
          label="Skills"
          value={skills}
          onChange={(event) => setSkills(event.target.value)}
          placeholder="React, TypeScript, SQL"
          help="Comma-separated — shown as highlighted tags wherever this listing appears."
        />
      </form>
    </Modal>
  )
}

const PLACE_VIEWS = [
  { value: 'all', label: 'All Places', icon: 'table' },
  { value: 'browse', label: 'Browse', icon: 'search' },
] as const
type PlaceView = (typeof PLACE_VIEWS)[number]['value']

/**
 * Everything registered, in one flat list — the Browse view answers "add a
 * place under this state", but not "what have I actually got?", which needs
 * seeing cities and venues together with their whole chain.
 */
/**
 * A country's flag, falling back to a map pin for anything the platform
 * doesn't recognise as a country — so the row always has a mark, and the
 * mark is never a wrong flag.
 */
function CountryMark({ name }: { name: string }) {
  const flag = countryFlag(name)
  if (!flag) return <Icon name="mapPin" size={12} className="text-ink-3" />
  return (
    <span aria-hidden="true" className="text-[13px] leading-none">
      {flag}
    </span>
  )
}

function AllPlacesView() {
  const cityList = useResource(() => locations.list(), [])
  const venueList = useResource(() => venues.list(), [])
  const [search, setSearch] = useState('')
  // The country/state/city tables arrive seeded, so most rows are geography
  // nobody asked for. What belongs here is the handful of places that mean
  // something to you — a venue you actually went to, a city you actually
  // applied in — with the rest kept behind a toggle for when you need to
  // find one to add a venue under.
  const [showAll, setShowAll] = useState(false)

  if (cityList.initial || venueList.initial) return <Loading />

  const cities = cityList.data ?? []
  const allVenues = venueList.data ?? []
  const needle = search.trim().toLowerCase()

  const inUse = (city: Location) => city.venue_count > 0 || city.listing_count > 0
  const unusedCount = cities.filter((city) => !inUse(city)).length

  // Grouped by country → state so the hierarchy stays legible, with each
  // city carrying whatever venues sit under it.
  const rows = cities
    .map((city) => ({
      city,
      venues: allVenues.filter((venue) => venue.location === city.id),
    }))
    // A search looks everywhere — if you're hunting for a city by name you
    // want it found whether you've used it yet or not.
    .filter(({ city }) => showAll || needle || inUse(city))
    .filter(({ city, venues: cityVenues }) => {
      if (!needle) return true
      return (
        city.full_name.toLowerCase().includes(needle) ||
        cityVenues.some((venue) => venue.name.toLowerCase().includes(needle))
      )
    })

  const byRegion = new Map<string, typeof rows>()
  for (const row of rows) {
    const key = `${row.city.country_name} — ${row.city.state_name}`
    byRegion.set(key, [...(byRegion.get(key) ?? []), row])
  }

  return (
    <>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search any country, state, city or venue…"
          wrapperClassName="min-w-[14rem] flex-1"
        />
        {unusedCount > 0 && !needle ? (
          <button
            type="button"
            onClick={() => setShowAll((value) => !value)}
            aria-pressed={showAll}
            className={cx(
              'h-10 shrink-0 rounded-lg border px-3 text-[12.5px] font-medium transition-colors',
              showAll
                ? 'border-brand bg-brand-soft text-brand-strong'
                : 'border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink',
            )}
          >
            {showAll ? 'Hide unused' : `Show all (${unusedCount} unused)`}
          </button>
        ) : null}
      </div>

      {!rows.length ? (
        <p className="mt-5 text-[13px] text-ink-3">
          {needle
            ? 'Nothing matches that search.'
            : cities.length
              ? 'No venues or applied-in cities yet — add one from Browse.'
              : 'No places registered yet.'}
        </p>
      ) : (
        <div className="mt-4 flex flex-col gap-4">
          {[...byRegion.entries()].map(([region, regionRows]) => (
            <div key={region}>
              <p className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium uppercase tracking-wide text-ink-3">
                <CountryMark name={regionRows[0]?.city.country_name ?? ''} />
                {region}
              </p>
              <ul className="divide-y divide-line rounded-lg border border-line">
                {regionRows.map(({ city, venues: cityVenues }) => (
                  <li key={city.id} className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <Icon name="building" size={14} className="text-ink-3" />
                      <span className="text-[13.5px] font-medium text-ink">{city.name}</span>
                      {cityVenues.length ? (
                        <Badge>{cityVenues.length}</Badge>
                      ) : null}
                    </div>
                    {cityVenues.length ? (
                      <ul className="mt-1.5 flex flex-wrap gap-1.5 pl-6">
                        {cityVenues.map((venue) => (
                          <li key={venue.id}>
                            <Badge>
                              <Icon name="mapPin" size={11} className="mr-1 inline text-ink-3" />
                              {venue.name}
                            </Badge>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

function PlacesTab() {
  const { notify } = useToast()
  // The flat list first: "what have I got?" is the usual question. Browse is
  // for adding, and the choice sticks the way the other tabs' views do.
  const [view, setView] = useState<PlaceView>(
    () => readViewState<{ view?: PlaceView }>('job-directory-places')?.view ?? 'all',
  )
  useEffect(() => {
    rememberViewState('job-directory-places', { view })
  }, [view])
  const countryList = useResource(() => countries.list(), [])
  const [country, setCountry] = useState<number | null>(null)
  const stateList = useResource(
    () => (country ? states.list({ country }) : Promise.resolve([] as State[])),
    [country],
  )
  const [stateId, setStateId] = useState<number | null>(null)
  const locationList = useResource(
    () => (stateId ? locations.list({ state: stateId }) : Promise.resolve([] as Location[])),
    [stateId],
  )
  const [city, setCity] = useState('')
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState<Location | null>(null)

  // A place more precise than a city — "The Pillars, Wynyard" rather than
  // just "Sydney" — so picking a city here is a selection, not just a click
  // target for renaming it (that moved to the small edit icon on the chip).
  const [selectedCityId, setSelectedCityId] = useState<number | null>(null)
  // Reset the selection during render, not an effect, when the state
  // changes underneath it — same "track the last seen value" idiom as the
  // modals below, which avoids the extra render an effect-based reset costs.
  const [lastStateId, setLastStateId] = useState(stateId)
  if (stateId !== lastStateId) {
    setLastStateId(stateId)
    setSelectedCityId(null)
  }
  const venueList = useResource(
    () => (selectedCityId ? venues.list({ location: selectedCityId }) : Promise.resolve([] as Venue[])),
    [selectedCityId],
  )
  const [venueName, setVenueName] = useState('')
  const [savingVenue, setSavingVenue] = useState(false)
  const [editingVenue, setEditingVenue] = useState<Venue | null>(null)
  const selectedCity = locationList.data?.find((entry) => entry.id === selectedCityId)

  async function addCity(event: FormEvent) {
    event.preventDefault()
    if (!stateId || !city.trim()) return
    setSaving(true)
    try {
      await locations.ensure({ name: city.trim(), state: stateId })
      setCity('')
      locationList.reload()
      notify('Location saved.')
    } catch (err) {
      notify(formatApiError(err), 'error')
    } finally {
      setSaving(false)
    }
  }

  async function addVenue(event: FormEvent) {
    event.preventDefault()
    if (!selectedCityId || !venueName.trim()) return
    setSavingVenue(true)
    try {
      await venues.ensure({ name: venueName.trim(), location: selectedCityId })
      setVenueName('')
      venueList.reload()
      notify('Venue saved.')
    } catch (err) {
      notify(formatApiError(err), 'error')
    } finally {
      setSavingVenue(false)
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <CardHeader
          title={
            <TitleWithHint
              title="Places"
              hint={
                view === 'browse'
                  ? 'Country → state → city → venue. Pick a level to add the one below it.'
                  : 'Everything you have registered, city by city.'
              }
            />
          }
        />
        <div className="inline-flex shrink-0 rounded-lg border border-line bg-surface p-0.5">
          {PLACE_VIEWS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setView(option.value)}
              aria-pressed={view === option.value}
              title={`${option.label} view`}
              className={cx(
                'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors',
                view === option.value
                  ? 'bg-brand-soft text-brand-strong'
                  : 'text-ink-2 hover:text-ink',
              )}
            >
              <Icon name={option.icon} size={15} />
              <span className="hidden sm:inline">{option.label}</span>
            </button>
          ))}
        </div>
      </div>

      {view === 'all' ? <AllPlacesView /> : null}

      {view === 'browse' ? (
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Combobox
          label="Country"
          value={country}
          onChange={(id) => {
            setCountry(id)
            setStateId(null)
          }}
          options={(countryList.data ?? []).map((entry: Country) => ({
            id: entry.id,
            label: entry.name,
          }))}
          onCreate={async (name) => {
            const created = await countries.ensure({ name })
            countryList.reload()
            return { id: created.id, label: created.name }
          }}
          placeholder="Search or add…"
        />

        <Combobox
          label="State"
          value={stateId}
          onChange={setStateId}
          disabled={!country}
          options={(stateList.data ?? []).map((entry) => ({
            id: entry.id,
            label: entry.name,
          }))}
          onCreate={
            country
              ? async (name) => {
                  const created = await states.ensure({ name, country })
                  stateList.reload()
                  return { id: created.id, label: created.name }
                }
              : undefined
          }
          placeholder={country ? 'Search or add…' : 'Pick a country first'}
        />

        <form onSubmit={addCity} className="flex items-end gap-2">
          <Input
            label="City"
            value={city}
            onChange={(event) => setCity(event.target.value)}
            disabled={!stateId}
            placeholder={stateId ? 'Sydney' : 'Pick a state first'}
            wrapperClassName="flex-1"
          />
          <Button
            type="submit"
            variant="primary"
            loading={saving}
            disabled={!stateId || !city.trim()}
            icon={<Icon name="plus" size={15} />}
          >
            Add
          </Button>
        </form>
      </div>
      ) : null}

      {view === 'browse' && stateId ? (
        locationList.initial ? (
          <Loading />
        ) : !locationList.data?.length ? (
          <p className="mt-5 text-[13px] text-ink-3">No cities in this state yet.</p>
        ) : (
          <>
            <p className="mb-1.5 mt-5 text-[13px] font-medium text-ink">
              Cities — pick one to add venues under it
            </p>
            <ul className="flex flex-wrap gap-1.5">
              {locationList.data.map((entry) => (
                <li key={entry.id}>
                  <span
                    className={cx(
                      'inline-flex items-center gap-0.5 rounded-full border py-1 pl-1 pr-1 text-[12.5px] transition-colors',
                      selectedCityId === entry.id
                        ? 'border-brand-ring bg-brand-soft text-brand-strong'
                        : 'border-line bg-surface-2 text-ink-2',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedCityId(entry.id)}
                      className="rounded-full px-2 py-0.5 hover:text-brand-strong"
                    >
                      {entry.name}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditing(entry)}
                      aria-label={`Edit ${entry.name}`}
                      className="rounded-full p-1 text-ink-3 hover:bg-surface hover:text-ink"
                    >
                      <Icon name="edit" size={11} />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )
      ) : null}

      {view === 'browse' && selectedCity ? (
        <div className="mt-5 border-t border-line pt-4">
          <p className="mb-1.5 text-[13px] font-medium text-ink">
            Venues in {selectedCity.name}
          </p>
          <p className="mb-3 text-[12px] text-ink-3">
            A specific place within the city — a café, an office, a bar — for when the city
            alone isn't precise enough. Still carries the full country/state/city chain.
          </p>

          <form onSubmit={addVenue} className="flex items-end gap-2">
            <Input
              label="Venue"
              value={venueName}
              onChange={(event) => setVenueName(event.target.value)}
              placeholder="The Pillars, Wynyard"
              wrapperClassName="flex-1"
            />
            <Button
              type="submit"
              variant="primary"
              loading={savingVenue}
              disabled={!venueName.trim()}
              icon={<Icon name="plus" size={15} />}
            >
              Add
            </Button>
          </form>

          {venueList.initial ? (
            <Loading />
          ) : !venueList.data?.length ? (
            <p className="mt-4 text-[13px] text-ink-3">No venues in this city yet.</p>
          ) : (
            <ul className="mt-4 flex flex-wrap gap-1.5">
              {venueList.data.map((entry) => (
                <li key={entry.id}>
                  <button type="button" onClick={() => setEditingVenue(entry)}>
                    <Badge className="cursor-pointer transition-colors hover:bg-brand-soft hover:text-brand-strong">
                      <Icon name="mapPin" size={11} className="mr-1 inline text-ink-3" />
                      {entry.name}
                    </Badge>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {editing ? (
        <EditNameModal
          open={editing !== null}
          onClose={() => setEditing(null)}
          title="Edit city"
          label="City"
          name={editing.name}
          onSave={async (value) => {
            await locations.update(editing.id, { name: value })
            locationList.reload()
            notify('Location saved.')
          }}
          onDelete={async () => {
            await locations.remove(editing.id)
            locationList.reload()
            notify('Location deleted.')
            if (selectedCityId === editing.id) setSelectedCityId(null)
          }}
        />
      ) : null}

      {editingVenue ? (
        <EditNameModal
          open={editingVenue !== null}
          onClose={() => setEditingVenue(null)}
          title="Edit venue"
          label="Venue"
          name={editingVenue.name}
          onSave={async (value) => {
            await venues.update(editingVenue.id, { name: value })
            venueList.reload()
            notify('Venue saved.')
          }}
          onDelete={async () => {
            await venues.remove(editingVenue.id)
            venueList.reload()
            notify('Venue deleted.')
          }}
        />
      ) : null}
    </Card>
  )
}

/**
 * Row label — the row itself only ever shows what it's sure of (the short
 * name once set, else the full name), never an inline input asking for one.
 * Clicking it opens the company's full profile page (like a network contact),
 * where editing happens through its own Edit button rather than straight
 * from the list.
 */
function CompanyEditTrigger({ company }: { company: Company; onSaved: () => void }) {
  return (
    <Link
      to={`/job-directory/companies/${company.id}`}
      className="min-w-0 flex-1 truncate text-left text-[13.5px] text-ink hover:underline"
      title={company.short_name ? `${company.name} (${company.short_name})` : company.name}
    >
      {company.short_name || company.name}
    </Link>
  )
}

export function CompanyEditModal({
  company,
  open,
  onClose,
  onSaved,
}: {
  company: Company
  open: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const { notify } = useToast()
  const industryList = useResource(() => industries.list(), [])
  const countryList = useResource(() => countries.list(), [])
  const [name, setName] = useState(company.name)
  const [shortName, setShortName] = useState(company.short_name)
  const [industryIds, setIndustryIds] = useState<number[]>(company.industries)
  const [regionIds, setRegionIds] = useState<number[]>(company.regions)
  const [current, setCurrent] = useState(company)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Re-sync from the (possibly-changed) prop each time the modal opens,
  // rather than once at mount — the same row's modal is reused across opens.
  const [lastOpen, setLastOpen] = useState(open)
  if (open !== lastOpen) {
    setLastOpen(open)
    if (open) {
      setName(company.name)
      setShortName(company.short_name)
      setIndustryIds(company.industries)
      setRegionIds(company.regions)
      setCurrent(company)
      setConfirmDelete(false)
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    try {
      await companies.update(company.id, {
        name: name.trim(),
        short_name: shortName.trim(),
        industries: industryIds,
        regions: regionIds,
      })
      notify('Company saved.')
      onSaved()
      onClose()
    } catch (err) {
      notify(formatApiError(err), 'error')
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    setDeleting(true)
    try {
      await companies.remove(company.id)
      notify('Company deleted.')
      onSaved()
      onClose()
    } catch (err) {
      notify(formatApiError(err), 'error')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={company.name}
      description="Shared reference data — changes apply everywhere this company is used."
      footer={
        confirmDelete ? (
          <>
            <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button variant="danger" onClick={remove} loading={deleting}>
              Confirm delete
            </Button>
          </>
        ) : (
          <>
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>
              Delete
            </Button>
            <Button type="submit" form="company-edit-form" variant="primary" loading={saving}>
              Save
            </Button>
          </>
        )
      }
    >
      <form id="company-edit-form" onSubmit={save} className="flex flex-col gap-4">
        <ImagePicker
          name={current.name}
          src={current.logo}
          label="logo"
          shape="square"
          helpText="Kept at its original proportions — wordmarks aren’t cropped."
          onUpload={async (file) => {
            setCurrent(await companies.uploadLogo(current.id, file))
          }}
          onRemove={
            current.logo
              ? async () => {
                  setCurrent(await companies.removeLogo(current.id))
                }
              : undefined
          }
        />
        <Input
          label="Name"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <Input
          label="Short name"
          value={shortName}
          onChange={(event) => setShortName(event.target.value)}
          placeholder="e.g. IBM"
          help="Shown instead of the full name in tight spaces, like the dashboard's company panel."
        />
        <MultiSelect
          label="Regions"
          value={regionIds}
          onChange={setRegionIds}
          options={(countryList.data ?? []).map((entry) => ({ id: entry.id, label: entry.name }))}
          emptyText="No countries in the Job Directory yet — add one from the Places tab."
          help="Optional — where this company operates. Powers the dashboard's region map."
        />
        <MultiSelect
          label="Industries"
          value={industryIds}
          onChange={setIndustryIds}
          options={(industryList.data ?? []).map((entry) => ({ id: entry.id, label: entry.name }))}
          emptyText="None yet — add one from the Companies tab."
          help="Optional — a company can span more than one, e.g. a bank's tech arm."
        />
      </form>
    </Modal>
  )
}

/**
 * Per-row logo control. Company logos are shared reference data, so they show
 * up for everyone — and they're what the network bubble view draws as hubs.
 */
function CompanyLogoButton({
  company,
  onSaved,
}: {
  company: Company
  onSaved: () => void
}) {
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState(company)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={current.logo ? `Change ${current.name} logo` : `Add a ${current.name} logo`}
        title={current.logo ? 'Change logo' : 'Add a logo'}
        className={cx(
          'grid size-9 shrink-0 place-items-center overflow-hidden rounded-lg border transition-colors',
          current.logo
            ? 'border-line bg-surface hover:border-line-strong'
            : 'border-dashed border-line-strong text-ink-3 hover:bg-surface-2 hover:text-ink',
        )}
      >
        {current.logo ? (
          <img
            src={current.logo}
            alt=""
            loading="lazy"
            decoding="async"
            className="size-full object-contain p-1"
          />
        ) : (
          <Icon name="plus" size={15} />
        )}
      </button>

      <Modal
        open={open}
        onClose={() => {
          setOpen(false)
          onSaved()
        }}
        title={`${current.name} logo`}
        description="Used on company hubs in the network bubble view."
        footer={
          <Button
            onClick={() => {
              setOpen(false)
              onSaved()
            }}
          >
            Done
          </Button>
        }
      >
        <ImagePicker
          name={current.name}
          src={current.logo}
          label="logo"
          shape="square"
          helpText="Kept at its original proportions — wordmarks aren’t cropped."
          onUpload={async (file) => {
            setCurrent(await companies.uploadLogo(current.id, file))
          }}
          onRemove={
            current.logo
              ? async () => {
                  setCurrent(await companies.removeLogo(current.id))
                }
              : undefined
          }
        />
      </Modal>
    </>
  )
}
