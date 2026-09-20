import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Navigate, useSearchParams } from 'react-router-dom'
import { fieldErrors, formatApiError } from '../api/client'
import {
  applications,
  companies,
  jobListings,
  libraryDocuments,
  resumes,
  roles,
} from '../api/resources'
import type {
  ApplicationSummary,
  Company,
  JobListing,
  LibraryDocument,
  Resume,
  Role,
} from '../api/types'
import { DocumentThumbnail } from '../components/applications/DocumentThumbnail'
import { DocumentViewer, type ViewerComments } from '../components/applications/DocumentViewer'
import { PageHeader } from '../components/layout/PageHeader'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Combobox, MultiSelect } from '../components/ui/Combobox'
import { FilterDrawer } from '../components/ui/FilterDrawer'
import { CompanyChip } from '../components/ui/CompanyChip'
import { CompanyMark } from '../components/ui/CompanyMark'
import { FilePicker } from '../components/ui/FilePicker'
import { Input, Label, Select, Textarea } from '../components/ui/Field'
import { Icon } from '../components/ui/Icon'
import { MentionTextarea } from '../components/ui/Mention'
import { Modal } from '../components/ui/Modal'
import { EmptyState, ErrorState, Loading, Refreshing } from '../components/ui/States'
import { Switch } from '../components/ui/Switch'
import { useToast } from '../components/ui/toast-context'
import { useAutoOpenFromQuery } from '../hooks/useAutoOpenFromQuery'
import { useFormDirty } from '../hooks/useFormDirty'
import { useDebounced, useResource } from '../hooks/useResource'
import { companyLabel, companyOption } from '../lib/company'
import type { PreviewSource } from '../lib/documentPreview'
import { downloadName, saveFileAs } from '../lib/download'
import { cx, formatDate } from '../lib/format'
import { rememberList } from '../lib/listState'

const TABS = [
  { value: 'all', label: 'All' },
  { value: 'applications', label: 'Application Files' },
  { value: 'resumes', label: 'Resume Files' },
] as const
type Tab = (typeof TABS)[number]['value']

const SORTS = [
  { value: 'recent', label: 'Recent' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'name', label: 'Name A–Z' },
] as const
type Sort = (typeof SORTS)[number]['value']

const RESUME_VARIANTS = [
  { value: 'general', label: 'General' },
  { value: 'company', label: 'Company-Specific' },
  { value: 'role', label: 'Role-Specific' },
] as const

const SCOPE_FILTERS = [
  { value: '', label: 'All' },
  { value: 'linked', label: 'Linked' },
  { value: 'general', label: 'General' },
] as const

const SEARCH_PLACEHOLDER: Record<Tab, string> = {
  all: 'Search all files — titles, companies, tags, notes…',
  applications: 'Search application files…',
  resumes: 'Search resume files…',
}

/** One card grid for every tab, so the page never re-flows when switching.
    `items-start` so each card hugs its own content — stretching them to the
    tallest in the row left a band of empty surface under the shorter ones. */
const GRID = 'grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'

function parseTab(raw: string | null): Tab {
  if (raw === 'resumes' || raw === 'applications') return raw
  return 'all'
}

function parseSort(raw: string | null): Sort {
  if (raw === 'oldest' || raw === 'name') return raw
  return 'recent'
}

function asPreview(doc: LibraryDocument): PreviewSource {
  return {
    file: doc.file,
    title: doc.title,
    file_kind: doc.file_kind,
    original_name: doc.original_name,
    kind: doc.kind,
    description: doc.description || undefined,
    created_at: doc.created_at,
  }
}

/**
 * Every format of a resume as preview sources, the one to show first at the
 * front: the PDF if there is one anywhere (it's what the thumbnail renders
 * and what gets sent), otherwise the primary document. Empty when nothing's
 * attached.
 */
function resumeFormats(resume: Resume): PreviewSource[] {
  const shared = {
    title: resume.label,
    description: resume.notes || undefined,
    created_at: resume.updated_at,
  }
  const all: PreviewSource[] = []
  if (resume.file) {
    all.push({
      ...shared,
      file: resume.file,
      file_kind: resume.file_kind,
      original_name: resume.file_name || null,
      file_name: resume.file_name || null,
    })
  }
  for (const entry of resume.files ?? []) {
    all.push({
      ...shared,
      file: entry.file,
      file_kind: entry.file_kind,
      original_name: entry.file_name || null,
      file_name: entry.file_name || null,
    })
  }
  const pdf = all.findIndex((entry) => (entry.file_kind || '').toLowerCase() === 'pdf')
  if (pdf > 0) all.unshift(...all.splice(pdf, 1))
  return all
}

function resumePreview(resume: Resume): PreviewSource | null {
  return resumeFormats(resume)[0] ?? null
}

/** Legacy /resumes bookmarks land on the Resume Files tab. */
export function ResumesRedirect() {
  return <Navigate to="/files?tab=resumes" replace />
}

/* ------------------------------------------------------------------------ Page */

type Item =
  | { type: 'application'; key: string; sortKey: string; name: string; doc: LibraryDocument }
  | { type: 'resume'; key: string; sortKey: string; name: string; resume: Resume }

export function FileDirectoryPage() {
  const [params, setParams] = useSearchParams()
  const tab = parseTab(params.get('tab'))
  const sort = parseSort(params.get('sort'))
  const scope = params.get('scope') ?? ''
  const tag = params.get('tag') ?? ''
  const variant = params.get('variant') ?? ''
  const archived = params.get('archived') === '1'

  const [search, setSearch] = useState(params.get('q') ?? '')
  const debouncedSearch = useDebounced(search)
  const [viewing, setViewing] = useState<PreviewSource | null>(null)
  const [viewingAlternates, setViewingAlternates] = useState<PreviewSource[]>([])
  const [viewingComments, setViewingComments] = useState<ViewerComments | undefined>(undefined)
  const [docForm, setDocForm] = useState<{ open: boolean; existing: LibraryDocument | null }>({
    open: false,
    existing: null,
  })
  const [resumeForm, setResumeForm] = useState<{ open: boolean; existing: Resume | null }>({
    open: false,
    existing: null,
  })

  // Search, sort and filters are worth remembering; the tab isn't. Coming
  // back to File Directory should show everything, not whichever slice you
  // happened to leave on.
  const remembered = new URLSearchParams(params)
  remembered.delete('tab')
  rememberList('files', remembered.toString() ? `?${remembered}` : '')

  // The search box is the only piece of state typed rather than clicked, so
  // it lives in React and is mirrored to `?q=` once it settles.
  useEffect(() => {
    const updated = new URLSearchParams(params)
    if (search) updated.set('q', search)
    else updated.delete('q')
    if (updated.toString() !== params.toString()) setParams(updated, { replace: true })
  }, [search]) // eslint-disable-line react-hooks/exhaustive-deps

  useAutoOpenFromQuery('new', () => {
    if (tab === 'resumes') setResumeForm({ open: true, existing: null })
    else setDocForm({ open: true, existing: null })
  })

  function setParam(key: string, value: string) {
    const updated = new URLSearchParams(params)
    if (value) updated.set(key, value)
    else updated.delete(key)
    setParams(updated, { replace: true })
  }

  function setTab(next: Tab) {
    const updated = new URLSearchParams(params)
    if (next === 'all') updated.delete('tab')
    else updated.set('tab', next)
    // Filters are per tab; search and sort follow you across.
    for (const key of ['new', 'scope', 'tag', 'variant', 'archived']) updated.delete(key)
    setParams(updated, { replace: true })
  }

  const showDocs = tab !== 'resumes'
  const showResumes = tab !== 'applications'

  const docs = useResource(
    () =>
      showDocs
        ? libraryDocuments.list({
            scope: scope || undefined,
            tag: tag || undefined,
            search: debouncedSearch || undefined,
          })
        : Promise.resolve([] as LibraryDocument[]),
    [showDocs, scope, tag, debouncedSearch],
  )
  const resumeList = useResource(
    () =>
      showResumes
        ? resumes.list({
            is_active: !archived,
            variant_type: variant || undefined,
            search: debouncedSearch || undefined,
          })
        : Promise.resolve([] as Resume[]),
    [showResumes, archived, variant, debouncedSearch],
  )

  const items = useMemo(() => {
    const merged: Item[] = [
      ...(docs.data ?? []).map((doc) => ({
        type: 'application' as const,
        key: `app-${doc.id}`,
        sortKey: doc.updated_at || doc.created_at,
        name: doc.title,
        doc,
      })),
      ...(resumeList.data ?? []).map((resume) => ({
        type: 'resume' as const,
        key: `resume-${resume.id}`,
        sortKey: resume.updated_at,
        name: resume.label,
        resume,
      })),
    ]
    merged.sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name)
      const delta = a.sortKey.localeCompare(b.sortKey)
      return sort === 'oldest' ? delta : -delta
    })
    return merged
  }, [docs.data, resumeList.data, sort])

  const allTags = useMemo(() => {
    const set = new Set<string>()
    for (const row of docs.data ?? []) for (const entry of row.tags ?? []) set.add(entry)
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [docs.data])

  const loading = docs.initial || resumeList.initial
  const refreshing = (docs.loading || resumeList.loading) && !loading
  const error = (!docs.data && docs.error) || (!resumeList.data && resumeList.error)
  const filtered = Boolean(debouncedSearch || scope || tag || variant || archived)

  const sortRow = (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-0.5 text-[11.5px] text-ink-3">Sort</span>
            {SORTS.map((option) => (
              <FilterChip
                key={option.value}
                active={sort === option.value}
                onClick={() => setParam('sort', option.value === 'recent' ? '' : option.value)}
              >
                {option.label}
              </FilterChip>
            ))}
          </div>
  )

  const addFile = (
    <Button
      variant="primary"
      onClick={() => setDocForm({ open: true, existing: null })}
      icon={<Icon name="plus" size={16} />}
    >
      Add file
    </Button>
  )
  const addResume = (
    <Button
      variant={tab === 'resumes' ? 'primary' : undefined}
      onClick={() => setResumeForm({ open: true, existing: null })}
      icon={<Icon name="plus" size={16} />}
    >
      Add resume
    </Button>
  )

  return (
    <>
      <PageHeader
        title="File Directory"
        subtitle={
          loading ? undefined : `${items.length} ${items.length === 1 ? 'file' : 'files'}`
        }
        action={
          <>
            <SegmentedTabs value={tab} onChange={setTab} />
            {tab !== 'resumes' ? addFile : null}
            {tab !== 'applications' ? addResume : null}
          </>
        }
      />

      <div className="mb-4 flex flex-col gap-3">
        <DirectorySearch
          value={search}
          onChange={setSearch}
          placeholder={SEARCH_PLACEHOLDER[tab]}
          label={SEARCH_PLACEHOLDER[tab]}
        />

        {/* The All tab has no filters of its own — just the sort row. */}
        {tab === 'all' ? (
          <div className="flex justify-end">{sortRow}</div>
        ) : (
        <FilterDrawer
          id={`files-${tab}`}
          activeCount={(scope ? 1 : 0) + (tag ? 1 : 0) + (variant ? 1 : 0) + (archived ? 1 : 0)}
          trailing={sortRow}
        >

            {tab === 'applications' ? (
              <>
                {SCOPE_FILTERS.map((option) => (
                  <FilterChip
                    key={option.value || 'all'}
                    active={scope === option.value}
                    onClick={() => setParam('scope', option.value)}
                  >
                    {option.label}
                  </FilterChip>
                ))}
                {allTags.length ? <span className="mx-1 w-px self-stretch bg-line" /> : null}
                {allTags.map((entry) => (
                  <FilterChip
                    key={entry}
                    active={tag === entry}
                    onClick={() => setParam('tag', tag === entry ? '' : entry)}
                  >
                    #{entry}
                  </FilterChip>
                ))}
              </>
            ) : tab === 'resumes' ? (
              <>
                <FilterChip
                  active={!archived && !variant}
                  onClick={() => {
                    const updated = new URLSearchParams(params)
                    updated.delete('archived')
                    updated.delete('variant')
                    setParams(updated, { replace: true })
                  }}
                >
                  Active
                </FilterChip>
                {RESUME_VARIANTS.map((option) => (
                  <FilterChip
                    key={option.value}
                    active={!archived && variant === option.value}
                    onClick={() => {
                      const updated = new URLSearchParams(params)
                      updated.delete('archived')
                      if (variant === option.value) updated.delete('variant')
                      else updated.set('variant', option.value)
                      setParams(updated, { replace: true })
                    }}
                  >
                    {option.label}
                  </FilterChip>
                ))}
                <FilterChip
                  active={archived}
                  onClick={() => {
                    const updated = new URLSearchParams(params)
                    updated.delete('variant')
                    if (archived) updated.delete('archived')
                    else updated.set('archived', '1')
                    setParams(updated, { replace: true })
                  }}
                >
                  Archived
                </FilterChip>
              </>
            ) : null}
        </FilterDrawer>
        )}
      </div>

      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorState
          message={String(docs.error || resumeList.error)}
          onRetry={() => {
            docs.reload()
            resumeList.reload()
          }}
        />
      ) : items.length === 0 ? (
        <Card padded={false}>
          <EmptyState
            icon="file"
            title={
              filtered
                ? 'No files match'
                : tab === 'resumes'
                  ? 'No resumes yet'
                  : tab === 'applications'
                    ? 'No application files yet'
                    : 'No files yet'
            }
            description={
              filtered
                ? 'Try a different search, or clear the filters.'
                : tab === 'resumes'
                  ? 'Add the versions you send out — general, company-tailored or role-tailored.'
                  : 'Upload cover letters, take-homes and offer PDFs — link them to an application or keep them general with tags.'
            }
            action={filtered ? undefined : tab === 'resumes' ? addResume : addFile}
          />
        </Card>
      ) : (
        <Refreshing active={refreshing}>
          <ul className={GRID}>
            {items.map((item) =>
              item.type === 'application' ? (
                <li key={item.key}>
                  <LibraryFileCard
                    document={item.doc}
                    showKind={tab === 'all'}
                    onPreview={() => {
                      setViewingComments({
                        value: item.doc.description,
                        onSave: async (text) => {
                          await libraryDocuments.update(item.doc.id, { description: text })
                          setViewingComments((current) => (current ? { ...current, value: text } : current))
                          docs.reload()
                        },
                      })
                      setViewingAlternates([])
                      setViewing(asPreview(item.doc))
                    }}
                    onEdit={() => setDocForm({ open: true, existing: item.doc })}
                    onRemove={() => docs.reload()}
                  />
                </li>
              ) : (
                <li key={item.key}>
                  <ResumeFileCard
                    resume={item.resume}
                    showKind={tab === 'all'}
                    onPreview={() => {
                      const [preview, ...rest] = resumeFormats(item.resume)
                      if (!preview) return
                      setViewingAlternates(rest)
                      setViewingComments({
                        value: item.resume.notes,
                        onSave: async (text) => {
                          await resumes.update(item.resume.id, { notes: text })
                          setViewingComments((current) => (current ? { ...current, value: text } : current))
                          resumeList.reload()
                        },
                      })
                      setViewing(preview)
                    }}
                    onEdit={() => setResumeForm({ open: true, existing: item.resume })}
                  />
                </li>
              ),
            )}
          </ul>
        </Refreshing>
      )}

      <LibraryFileForm
        open={docForm.open}
        existing={docForm.existing}
        onClose={() => setDocForm((prev) => ({ ...prev, open: false }))}
        onSaved={() => docs.reload()}
      />
      <ResumeForm
        open={resumeForm.open}
        existing={resumeForm.existing}
        onClose={() => setResumeForm((prev) => ({ ...prev, open: false }))}
        onSaved={() => resumeList.reload()}
      />

      {viewing ? (
        <DocumentViewer
          item={viewing}
          alternates={viewingAlternates}
          comments={viewingComments}
          onClose={() => {
            setViewing(null)
            setViewingAlternates([])
            setViewingComments(undefined)
          }}
        />
      ) : null}
    </>
  )
}

/* --------------------------------------------------------------------- Toolbar */

function SegmentedTabs({ value, onChange }: { value: Tab; onChange: (next: Tab) => void }) {
  return (
    <div className="inline-flex shrink-0 rounded-lg border border-line bg-surface p-0.5">
      {TABS.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          className={cx(
            'rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors',
            value === option.value
              ? 'bg-brand-soft text-brand-strong'
              : 'text-ink-2 hover:text-ink',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function DirectorySearch({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string
  onChange: (next: string) => void
  placeholder: string
  label: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  // "/" jumps to the search from anywhere on the page, the way it does on
  // GitHub — the box is the page's main control and shouldn't need the mouse.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return
      }
      event.preventDefault()
      inputRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="relative w-full">
      <Icon
        name="search"
        size={16}
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3"
      />
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className={cx(
          'h-10 w-full rounded-lg border border-line bg-surface pl-9 pr-16 text-sm text-ink',
          'placeholder:text-ink-3 transition-[border-color,box-shadow]',
          'hover:border-line-strong focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-ring',
          '[&::-webkit-search-cancel-button]:appearance-none',
        )}
      />
      <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
        {value ? (
          <button
            type="button"
            onClick={() => {
              onChange('')
              inputRef.current?.focus()
            }}
            aria-label="Clear search"
            className="rounded-md p-1 text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <Icon name="close" size={14} />
          </button>
        ) : (
          <kbd className="hidden rounded-md border border-line bg-surface-2 px-1.5 py-0.5 font-sans text-[10.5px] text-ink-3 sm:block">
            /
          </kbd>
        )}
      </div>
    </div>
  )
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        'rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors',
        active
          ? 'border-brand bg-brand-soft text-brand-strong'
          : 'border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink',
      )}
    >
      {children}
    </button>
  )
}

/* ----------------------------------------------------------------------- Cards */

/**
 * One shell for both file types, so the grid reads as a single set: a fixed
 * thumbnail on top, then title, meta, a chip row and hover-revealed actions.
 */
function FileCardShell({
  title,
  meta,
  kind,
  preview,
  onPreview,
  chips,
  actions,
  muted,
}: {
  title: string
  meta: string
  /** "App file" / "Resume" — only shown on the mixed tab, where it matters. */
  kind?: string
  preview: PreviewSource | null
  onPreview: () => void
  chips: ReactNode
  actions: ReactNode
  muted?: boolean
}) {
  return (
    <div
      className={cx(
        'group/doc glass-panel flex h-full flex-col rounded-card border border-line bg-surface transition-shadow hover:shadow-md',
        muted && 'opacity-70',
      )}
    >
      {preview ? (
        <button
          type="button"
          onClick={onPreview}
          className="relative block h-28 w-full overflow-hidden rounded-t-card border-b border-line bg-surface-2"
          aria-label={`Preview ${title}`}
        >
          <DocumentThumbnail document={preview} className="size-full" />
          {kind ? <KindBadge label={kind} /> : null}
        </button>
      ) : (
        <div className="relative grid h-28 place-items-center rounded-t-card border-b border-line bg-surface-2 text-[12px] text-ink-3">
          No file attached
          {kind ? <KindBadge label={kind} /> : null}
        </div>
      )}

      <div className="flex flex-1 flex-col p-2.5">
        <p className="truncate text-[13px] font-medium text-ink" title={title}>
          {title}
        </p>
        <p className="mt-0.5 text-[11px] text-ink-3">{meta}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">{chips}</div>
        <div className="mt-auto flex items-center gap-0.5 pt-2.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/doc:opacity-100">
          {actions}
        </div>
      </div>
    </div>
  )
}

function KindBadge({ label }: { label: string }) {
  return (
    <span className="pointer-events-none absolute right-1.5 top-1.5 rounded-md border border-line bg-surface-solid/90 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-2 shadow-sm backdrop-blur">
      {label}
    </span>
  )
}

function CardAction({
  icon,
  label,
  onClick,
  href,
  download,
  danger,
}: {
  icon: string
  label: string
  onClick?: () => void
  href?: string
  download?: string | boolean
  danger?: boolean
}) {
  const className = cx(
    'rounded-lg p-1.5 text-ink-3 transition-colors hover:bg-surface-2',
    danger ? 'hover:text-critical' : 'hover:text-brand',
  )
  if (href) {
    return (
      <a
        href={href}
        download={download}
        target="_blank"
        rel="noreferrer noopener"
        aria-label={label}
        title={label}
        className={className}
      >
        <Icon name={icon} size={14} />
      </a>
    )
  }
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className={className}>
      <Icon name={icon} size={14} />
    </button>
  )
}

function LibraryFileCard({
  document,
  showKind,
  onPreview,
  onEdit,
  onRemove,
}: {
  document: LibraryDocument
  showKind: boolean
  onPreview: () => void
  onEdit: () => void
  onRemove: () => void
}) {
  const { notify } = useToast()
  const preview = asPreview(document)

  return (
    <FileCardShell
      title={document.title}
      meta={`${document.file_kind ? `${document.file_kind} · ` : ''}${formatDate(document.created_at.slice(0, 10))}`}
      kind={showKind ? 'App file' : undefined}
      preview={preview}
      onPreview={onPreview}
      chips={
        <>
          {document.application ? (
            <CompanyChip
              size="sm"
              label={document.application_company ?? `App #${document.application}`}
              fullName={document.application_company_name}
              logo={document.application_company_logo}
              to={`/applications/${document.application}`}
              tone="brand"
            />
          ) : document.company ? (
            <CompanyChip
              size="sm"
              label={document.company_name ?? 'Company'}
              fullName={document.company_full_name}
              logo={document.company_logo}
              companyId={document.company}
            />
          ) : (
            <Badge>General</Badge>
          )}
          {(document.tags ?? []).map((entry) => (
            <Badge key={entry}>#{entry}</Badge>
          ))}
        </>
      }
      actions={
        <>
          <CardAction icon="file" label={`Read ${document.title}`} onClick={onPreview} />
          <CardAction
            icon="download"
            label={`Download ${document.title}`}
            onClick={() =>
              void saveFileAs(document.file, downloadName(document.title, document.original_name || document.file)).catch(
                (err) => notify(formatApiError(err), 'error'),
              )
            }
          />
          <CardAction icon="edit" label={`Edit ${document.title}`} onClick={onEdit} />
          <CardAction
            icon="trash"
            label={`Remove ${document.title}`}
            danger
            onClick={() => {
              void libraryDocuments
                .remove(document.id)
                .then(() => {
                  notify('File removed.')
                  onRemove()
                })
                .catch((err) => notify(formatApiError(err), 'error'))
            }}
          />
        </>
      }
    />
  )
}

function ResumeFileCard({
  resume,
  showKind,
  onPreview,
  onEdit,
}: {
  resume: Resume
  showKind: boolean
  onPreview: () => void
  onEdit: () => void
}) {
  const { notify } = useToast()
  const formats = resumeFormats(resume)
  const preview = formats[0] ?? null
  // "PDF · Word" when there's more than one format, so the card says so
  // without having to open it.
  const kinds = formats.map((entry) => entry.file_kind).filter(Boolean).join(' · ')
  const targetCompanies =
    resume.target_companies_info?.length > 0
      ? resume.target_companies_info
      : resume.target_company_names.map((name, index) => ({
          id: resume.target_companies[index] ?? index,
          name,
          short_name: name,
          logo: null as string | null,
        }))

  return (
    <FileCardShell
      title={resume.label}
      meta={`${kinds ? `${kinds} · ` : ''}Updated ${formatDate(resume.updated_at.slice(0, 10))}`}
      kind={showKind ? 'Resume' : undefined}
      preview={preview}
      onPreview={onPreview}
      muted={!resume.is_active}
      chips={
        <>
          <Badge tone="brand">{resume.variant_type_display}</Badge>
          {resume.is_active ? null : <Badge>Archived</Badge>}
          <CountTag
            groups={[
              {
                icon: 'paperclip',
                count: resume.application_count,
                noun: 'application',
                plural: 'applications',
                body: (
                  <ul className="flex flex-col gap-1">
                    {(resume.applications_info ?? []).map((row) => (
                      <li key={row.id} className="flex items-center gap-2">
                        <CompanyMark
                          name={row.company_name}
                          logo={row.company_logo}
                          size={20}
                          className="rounded-md shadow-none"
                        />
                        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink">
                          {row.company_name}
                        </span>
                        <span className="shrink-0 text-[11px] text-ink-3">{row.stage_display}</span>
                      </li>
                    ))}
                  </ul>
                ),
              },
              {
                icon: 'briefcase',
                count: resume.target_role_names.length,
                noun: 'role',
                plural: 'roles',
                body: (
                  <ul className="flex flex-col gap-1">
                    {resume.target_role_names.map((name) => (
                      <li key={name} className="flex items-center gap-2 text-[12px] text-ink">
                        <span className="grid size-5 shrink-0 place-items-center rounded-md bg-brand-soft text-brand-strong">
                          <Icon name="briefcase" size={11} />
                        </span>
                        <span className="truncate">{name}</span>
                      </li>
                    ))}
                  </ul>
                ),
              },
              {
                icon: 'building',
                count: targetCompanies.length,
                noun: 'company',
                plural: 'companies',
                body: (
                  <span className="flex flex-wrap gap-1.5">
                    {targetCompanies.map((company) => (
                      <CompanyChip
                        key={company.id}
                        size="sm"
                        label={companyLabel(company)}
                        fullName={company.name}
                        logo={company.logo}
                      />
                    ))}
                  </span>
                ),
              },
            ]}
          />
        </>
      }
      actions={
        <>
          {preview ? (
            <>
              <CardAction icon="file" label={`Read ${resume.label}`} onClick={onPreview} />
              <CardAction
                icon="download"
                label={`Download ${resume.label}`}
                onClick={() =>
                  void saveFileAs(preview.file, downloadName(resume.label, resume.file_name || preview.file)).catch(
                    (err) => notify(formatApiError(err), 'error'),
                  )
                }
              />
            </>
          ) : null}
          <CardAction icon="edit" label={`Edit ${resume.label}`} onClick={onEdit} />
        </>
      }
    />
  )
}

type CountGroup = {
  icon: string
  count: number
  noun: string
  plural: string
  /** What the breakdown shows for this group, when there's anything to show. */
  body: ReactNode
}

/**
 * The three numbers that describe a resume — sent with, aimed at, tailored
 * for — as one tag rather than three.
 *
 * Three separate pills wrapped onto a second row and spent most of their
 * width writing "0 roles, 0 companies" on cards where the answer was
 * nothing. Counts alone carry it; hovering opens one breakdown covering all
 * three, so the detail is still a glance away and the card stays a card.
 *
 * The panel is positioned `fixed` from the tag's own rect: the page clips
 * horizontal overflow, so an absolutely-placed panel on the last column of
 * the grid got its right edge cut off.
 */
function CountTag({ groups }: { groups: CountGroup[] }) {
  const anchor = useRef<HTMLSpanElement>(null)
  const [at, setAt] = useState<{ top: number; left: number } | null>(null)
  const total = groups.reduce((sum, group) => sum + group.count, 0)

  function show() {
    const rect = anchor.current?.getBoundingClientRect()
    if (!rect) return
    const width = 264
    setAt({
      top: rect.bottom + 6,
      left: Math.min(Math.max(8, rect.left), window.innerWidth - width - 8),
    })
  }

  const summary = groups
    .map((group) => `${group.count} ${group.count === 1 ? group.noun : group.plural}`)
    .join(', ')

  return (
    <span
      ref={anchor}
      className="relative inline-flex"
      onPointerEnter={show}
      onPointerLeave={() => setAt(null)}
      onFocusCapture={show}
      onBlurCapture={() => setAt(null)}
    >
      <span
        tabIndex={total > 0 ? 0 : -1}
        aria-label={summary}
        className={cx(
          'inline-flex items-center divide-x divide-line overflow-hidden rounded-full border border-line',
          'bg-surface-2 text-[11px] font-medium leading-5 transition-colors',
          total > 0 && 'cursor-default hover:border-line-strong',
        )}
      >
        {groups.map((group) => (
          <span
            key={group.noun}
            className={cx(
              // Tight enough that the tag and the variant badge share one
              // line at card width instead of wrapping the card taller.
              'inline-flex items-center gap-1 px-1.5 py-0.5 tabular-nums',
              // A zero stays in place so the tag is the same shape on every
              // card, just quieter — the row reads as a set, not a jumble.
              group.count > 0 ? 'text-ink-2' : 'text-ink-3/60',
            )}
          >
            <Icon name={group.icon} size={11} />
            {group.count}
          </span>
        ))}
      </span>

      {at && total > 0
        ? createPortal(
            <span
              role="tooltip"
              style={{ top: at.top, left: at.left, width: 264 }}
              className="pointer-events-none fixed z-50 flex flex-col gap-2.5 rounded-xl border border-line bg-surface-solid p-2.5 shadow-xl"
            >
              {groups.map((group) => (
                <span key={group.noun} className="flex flex-col gap-1.5">
                  <span className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-ink-3">
                    <Icon name={group.icon} size={11} />
                    {group.count} {group.count === 1 ? group.noun : group.plural}
                  </span>
                  {group.count > 0 ? (
                    group.body
                  ) : (
                    <span className="text-[11.5px] text-ink-3">None yet</span>
                  )}
                </span>
              ))}
            </span>,
            document.body,
          )
        : null}
    </span>
  )
}

/* ----------------------------------------------------------------------- Forms */

function LibraryFileForm({
  open,
  existing,
  onClose,
  onSaved,
}: {
  open: boolean
  existing: LibraryDocument | null
  onClose: () => void
  onSaved: () => void
}) {
  if (!open) return null
  return (
    <LibraryFileFormBody
      open={open}
      existing={existing}
      onClose={onClose}
      onSaved={onSaved}
    />
  )
}

function LibraryFileFormBody({
  open,
  existing,
  onClose,
  onSaved,
}: {
  open: boolean
  existing: LibraryDocument | null
  onClose: () => void
  onSaved: () => void
}) {
  const { notify } = useToast()
  const [title, setTitle] = useState(existing?.title ?? '')
  const [description, setDescription] = useState(existing?.description ?? '')
  // What the file is attached to: an application, just a company, or nothing.
  const [linkKind, setLinkKind] = useState<'none' | 'application' | 'company'>(
    existing?.application ? 'application' : existing?.company ? 'company' : 'none',
  )
  const [applicationId, setApplicationId] = useState<number | null>(
    existing?.application ?? null,
  )
  const [companyId, setCompanyId] = useState<number | null>(existing?.company ?? null)
  const [companyOptions, setCompanyOptions] = useState<Company[]>([])
  const [tags, setTags] = useState((existing?.tags ?? []).join(', '))
  const [fileName, setFileName] = useState(existing?.original_name ?? '')
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [appOptions, setAppOptions] = useState<ApplicationSummary[]>([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const dirty = useFormDirty({
    title,
    description,
    linkKind,
    applicationId,
    companyId,
    tags,
    fileName,
    pendingFile: pendingFile?.name ?? null,
  })
  const guardedCloseRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    void applications.list({ ordering: '-updated_at' }).then(setAppOptions)
    void companies.list().then(setCompanyOptions)
  }, [])

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError('')
    const tagList = tags
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)

    try {
      if (existing) {
        await libraryDocuments.update(existing.id, {
          title: title.trim() || existing.title,
          description: description.trim(),
          application: linkKind === 'application' ? applicationId : null,
          company: linkKind === 'company' ? companyId : null,
          tags: tagList,
          original_name: fileName.trim() || existing.original_name,
        })
        notify('File updated.')
      } else {
        if (!pendingFile) {
          setError('Choose a file to upload.')
          setSaving(false)
          return
        }
        const body = new FormData()
        body.append('file', pendingFile)
        if (title.trim()) body.append('title', title.trim())
        if (fileName.trim()) body.append('original_name', fileName.trim())
        if (description.trim()) body.append('description', description.trim())
        if (linkKind === 'application' && applicationId) {
          body.append('application', String(applicationId))
        }
        if (linkKind === 'company' && companyId) {
          body.append('company', String(companyId))
        }
        for (const entry of tagList) body.append('tags', entry)
        await libraryDocuments.create(body)
        notify('File added.')
      }
      onSaved()
      onClose()
    } catch (err) {
      setError(formatApiError(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      dirty={dirty}
      guardedCloseRef={guardedCloseRef}
      title={existing ? 'Edit file' : 'Add application file'}
      footer={
        <>
          <Button type="button" onClick={() => guardedCloseRef.current?.()}>
            Cancel
          </Button>
          <Button type="submit" form="library-file-form" variant="primary" loading={saving}>
            {existing ? 'Save changes' : 'Add file'}
          </Button>
        </>
      }
    >
      <form id="library-file-form" onSubmit={onSubmit} className="flex flex-col gap-4">
        {error ? (
          <p
            role="alert"
            className="rounded-lg border border-critical/25 bg-critical/10 px-3 py-2 text-[13px] text-ink"
          >
            {error}
          </p>
        ) : null}

        {!existing ? (
          <div>
            <Label>File</Label>
            <FilePicker
              url={null}
              name={pendingFile?.name ?? ''}
              kind={null}
              size={pendingFile?.size ?? null}
              help="PDF, Word, Pages, PowerPoint, Markdown, ODT, RTF, text or image."
              onUpload={async (file) => {
                setPendingFile(file)
                if (!fileName.trim()) setFileName(file.name)
              }}
              onRemove={async () => setPendingFile(null)}
            />
          </div>
        ) : null}

        <Input
          label="Title"
          autoFocus
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Cover letter, take-home task…"
          help="Downloads are saved under this title."
        />

        <Input
          label="File name"
          value={fileName}
          onChange={(event) => setFileName(event.target.value)}
          placeholder="e.g. cover-letter-v3.pdf"
          help="For your reference only — what this file was called on your computer."
        />

        <Textarea
          label="Description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Optional context…"
        />

        <div>
          <Label>Linked to</Label>
          <div role="radiogroup" aria-label="Linked to" className="flex flex-wrap gap-1.5">
            {(
              [
                { value: 'none', label: 'Nothing', icon: 'file' },
                { value: 'application', label: 'An application', icon: 'briefcase' },
                { value: 'company', label: 'A company', icon: 'building' },
              ] as const
            ).map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={linkKind === option.value}
                onClick={() => setLinkKind(option.value)}
                className={cx(
                  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors',
                  linkKind === option.value
                    ? 'border-brand bg-brand-soft text-brand-strong'
                    : 'border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink',
                )}
              >
                <Icon name={option.icon} size={13} />
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {linkKind === 'application' ? (
          <Combobox
            label="Application"
            value={applicationId}
            onChange={setApplicationId}
            options={appOptions.map((row) => ({
              id: row.id,
              label: `${row.company_name} · ${row.stage_display}`,
              avatar: row.company_logo,
              avatarShape: 'square' as const,
            }))}
            placeholder="Choose an application…"
          />
        ) : linkKind === 'company' ? (
          <Combobox
            label="Company"
            value={companyId}
            onChange={setCompanyId}
            options={companyOptions.map(companyOption)}
            onCreate={async (name) => {
              const created = await companies.ensure({ name })
              setCompanyOptions((prev) =>
                prev.some((entry) => entry.id === created.id) ? prev : [...prev, created],
              )
              return companyOption(created)
            }}
            placeholder="Search or add a company…"
          />
        ) : null}

        <Input
          label="Tags"
          value={tags}
          onChange={(event) => setTags(event.target.value)}
          placeholder="cover-letter, take-home (comma-separated)"
          help="Useful for general files — filter the directory by these later."
        />
      </form>
    </Modal>
  )
}


function ResumeForm({
  open,
  onClose,
  onSaved,
  existing,
}: {
  open: boolean
  onClose: () => void
  onSaved: () => void
  existing?: Resume | null
}) {
  if (!open) return null
  return (
    <ResumeFormBody open={open} onClose={onClose} onSaved={onSaved} existing={existing} />
  )
}

function ResumeFormBody({
  open,
  onClose,
  onSaved,
  existing,
}: {
  open: boolean
  onClose: () => void
  onSaved: () => void
  existing?: Resume | null
}) {
  const { notify } = useToast()
  const [current, setCurrent] = useState<Resume | null>(existing ?? null)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [form, setForm] = useState(() => ({
    label: existing?.label ?? '',
    variant_type: (existing?.variant_type ?? 'general') as Resume['variant_type'],
    notes: existing?.notes ?? '',
    is_active: existing?.is_active ?? true,
    file_name: existing?.file_name ?? '',
  }))
  const [targetCompanies, setTargetCompanies] = useState<number[]>(
    () => existing?.target_companies ?? [],
  )
  const [targetRoles, setTargetRoles] = useState<number[]>(() => existing?.target_roles ?? [])
  const [companyOptions, setCompanyOptions] = useState<Company[]>([])
  const [roleOptions, setRoleOptions] = useState<Role[]>([])
  const [listings, setListings] = useState<JobListing[]>([])
  const [error, setError] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const dirty = useFormDirty({
    form,
    targetCompanies,
    targetRoles,
    pendingFile: pendingFile?.name ?? null,
  })
  const guardedCloseRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    void Promise.all([companies.list(), roles.list(), jobListings.list()]).then(
      ([companyRows, roleRows, listingRows]) => {
        setCompanyOptions(companyRows)
        setRoleOptions(roleRows)
        setListings(listingRows)
      },
    )
  }, [])

  const selectedCompanies = companyOptions.filter((row) => targetCompanies.includes(row.id))
  const selectedRoles = roleOptions.filter((row) => targetRoles.includes(row.id))

  // Once a company's picked, narrow Target roles to the roles actually
  // posted there — picking "Software Engineer" for a company that only ever
  // hired Analysts was just the whole shared role catalog, unfiltered.
  // Already-chosen roles stay visible even if they fall outside a newly
  // narrowed set, so switching companies never silently drops a saved pick.
  const roleOptionList = useMemo(() => {
    const mapped = roleOptions.map((role) => ({
      id: role.id,
      label: role.name,
      avatar: null,
      avatarShape: 'square' as const,
    }))
    if (targetCompanies.length === 0) return mapped
    const postedRoleIds = new Set(
      listings.filter((listing) => targetCompanies.includes(listing.company)).map((listing) => listing.role),
    )
    return mapped.filter((option) => postedRoleIds.has(option.id) || targetRoles.includes(option.id))
  }, [roleOptions, listings, targetCompanies, targetRoles])

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setErrors({})
    const { file_name, ...rest } = form
    const payload = {
      ...rest,
      target_companies: targetCompanies,
      target_roles: targetRoles,
      // Only meaningful once a file is attached; the upload sets it otherwise.
      ...(existing?.file && file_name.trim() ? { file_name: file_name.trim() } : {}),
    }
    try {
      let saved = existing
        ? await resumes.update(existing.id, payload)
        : await resumes.create(payload)
      if (pendingFile) {
        saved = await resumes.uploadFile(saved.id, pendingFile)
        setPendingFile(null)
      }
      setCurrent(saved)
      notify(existing ? 'Resume updated.' : 'Resume added.')
      onSaved()
      onClose()
    } catch (err) {
      setError(formatApiError(err))
      setErrors(fieldErrors(err))
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!existing) return
    try {
      await resumes.remove(existing.id)
      notify('Resume deleted.')
      onSaved()
      onClose()
    } catch (err) {
      notify(formatApiError(err), 'error')
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      dirty={dirty}
      guardedCloseRef={guardedCloseRef}
      title={existing ? 'Edit resume' : 'Add a resume'}
      footer={
        <>
          {existing ? (
            <Button variant="danger" onClick={() => void remove()} className="mr-auto">
              Delete
            </Button>
          ) : null}
          <Button type="button" onClick={() => guardedCloseRef.current?.()}>
            Cancel
          </Button>
          <Button type="submit" form="resume-form" variant="primary" loading={saving}>
            {existing ? 'Save changes' : 'Add resume'}
          </Button>
        </>
      }
    >
      <form id="resume-form" onSubmit={onSubmit} className="flex flex-col gap-4">
        {error ? (
          <p
            role="alert"
            className="rounded-lg border border-critical/25 bg-critical/10 px-3 py-2 text-[13px] text-ink"
          >
            {error}
          </p>
        ) : null}

        <Input
          label="Label"
          required
          autoFocus
          placeholder="ey-vac-2026"
          value={form.label}
          error={errors.label}
          onChange={(event) => setForm((prev) => ({ ...prev, label: event.target.value }))}
          help="Downloads are saved under this label."
        />

        {current?.file ? (
          <Input
            label="File name"
            value={form.file_name}
            error={errors.file_name}
            onChange={(event) => setForm((prev) => ({ ...prev, file_name: event.target.value }))}
            help="For your reference only — what this file was called on your computer."
          />
        ) : null}

        <Select
          label="Variant"
          value={form.variant_type}
          onChange={(event) =>
            setForm((prev) => ({
              ...prev,
              variant_type: event.target.value as Resume['variant_type'],
            }))
          }
        >
          {RESUME_VARIANTS.map((variant) => (
            <option key={variant.value} value={variant.value}>
              {variant.label}
            </option>
          ))}
        </Select>

        <div className="grid gap-4 sm:grid-cols-2">
          <MultiSelect
            label="Target companies"
            options={companyOptions.map(companyOption)}
            value={targetCompanies}
            onChange={setTargetCompanies}
            emptyText="No companies yet."
          />
          <MultiSelect
            label="Target roles"
            options={roleOptionList}
            value={targetRoles}
            onChange={setTargetRoles}
            emptyText={
              targetCompanies.length
                ? 'No roles posted at the selected companies yet.'
                : 'No roles yet.'
            }
            help={targetCompanies.length ? 'Narrowed to roles posted at the selected companies.' : undefined}
          />
        </div>

        {selectedCompanies.length || selectedRoles.length ? (
          <div className="rounded-lg border border-line bg-surface-2 p-3">
            <p className="mb-2 text-[12px] font-medium uppercase tracking-wide text-ink-3">
              Tailored for
            </p>
            <div className="flex flex-wrap gap-1.5">
              {selectedCompanies.map((company) => (
                <span
                  key={company.id}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface py-0.5 pl-0.5 pr-2"
                >
                  <CompanyMark
                    name={company.name}
                    logo={company.logo}
                    size={18}
                    className="rounded-md"
                  />
                  <span className="text-[12px] text-ink" title={company.name}>
                    {companyLabel(company)}
                  </span>
                </span>
              ))}
              {selectedRoles.map((role) => (
                <span
                  key={role.id}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface py-0.5 pl-0.5 pr-2"
                >
                  <span className="grid size-5 place-items-center rounded-md bg-brand-soft text-brand-strong">
                    <Icon name="briefcase" size={11} />
                  </span>
                  <span className="text-[12px] text-ink">{role.name}</span>
                </span>
              ))}
            </div>
          </div>
        ) : null}

        <MentionTextarea
          label="Notes"
          value={form.notes}
          error={errors.notes}
          onChange={(value) => setForm((prev) => ({ ...prev, notes: value }))}
          placeholder="What's different about this version… (@ to tag a contact, company or place)"
        />

        <label className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface-2 px-3 py-2.5">
          <span>
            <span className="block text-[13px] font-medium text-ink">Active</span>
            <span className="block text-[12px] text-ink-3">
              Off archives this resume without deleting it.
            </span>
          </span>
          <Switch
            checked={form.is_active}
            onChange={(next) => setForm((prev) => ({ ...prev, is_active: next }))}
            label="Active"
          />
        </label>

        <div>
          <Label>Attachment</Label>
          <FilePicker
            url={current?.file ?? null}
            name={current?.file_name ?? pendingFile?.name ?? ''}
            kind={current?.file_kind ?? null}
            size={current?.file_size ?? pendingFile?.size ?? null}
            help={
              current
                ? undefined
                : 'PDF, Word, Pages, PowerPoint, Markdown, ODT, RTF or text — attached when you save.'
            }
            onUpload={async (file) => {
              if (!current) {
                setPendingFile(file)
                return
              }
              setCurrent(await resumes.uploadFile(current.id, file))
              onSaved()
            }}
            onRemove={async () => {
              if (!current) {
                setPendingFile(null)
                return
              }
              setCurrent(await resumes.removeFile(current.id))
              onSaved()
            }}
          />
        </div>

        {current?.file ? (
          <div>
            <Label>Other formats</Label>
            <p className="mb-2 text-[12px] text-ink-3">
              The same resume in another format — the .docx you edit beside the .pdf you
              send. The preview switches between them; the thumbnail shows the PDF.
            </p>
            <div className="flex flex-col gap-2">
              {(current.files ?? []).map((entry) => (
                <FilePicker
                  key={entry.id}
                  url={entry.file}
                  name={entry.file_name}
                  kind={entry.file_kind}
                  size={entry.file_size}
                  onUpload={async (file) => {
                    setCurrent(await resumes.addAlternateFile(current.id, file))
                    onSaved()
                  }}
                  onRemove={async () => {
                    setCurrent(await resumes.removeAlternateFile(current.id, entry.id))
                    onSaved()
                  }}
                />
              ))}
              <FilePicker
                url={null}
                name=""
                kind={null}
                size={null}
                help="Add a format the main document isn't already in."
                onUpload={async (file) => {
                  setCurrent(await resumes.addAlternateFile(current.id, file))
                  onSaved()
                }}
                onRemove={async () => {}}
              />
            </div>
          </div>
        ) : null}
      </form>
    </Modal>
  )
}
