import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/context'
import { deleteAllData, removeWallpaper, updateProfile, uploadWallpaper } from '../api/auth'
import { formatApiError } from '../api/client'
import { PageHeader } from '../components/layout/PageHeader'
import { Button, Spinner } from '../components/ui/Button'
import { Card, CardHeader } from '../components/ui/Card'
import { useDeveloperMode } from '../hooks/useDeveloperMode'
import { useGlass, writeGlass } from '../lib/glass'
import { useLocationEnabled } from '../lib/location'
import { useTodoSuggestionsSetting } from '../lib/todoSuggestions'
import { InfoHint } from '../components/ui/InfoHint'
import type { CSSProperties } from 'react'
import { Input } from '../components/ui/Field'
import { Icon } from '../components/ui/Icon'
import { Modal } from '../components/ui/Modal'
import { Switch } from '../components/ui/Switch'
import { useToast } from '../components/ui/toast-context'
import { BackupPanel } from '../components/BackupPanel'
import { ImportGuideModal } from '../components/ImportGuideModal'
import { useAutoOpenFromQuery } from '../hooks/useAutoOpenFromQuery'
import { useAppearance } from '../appearance/context'
import { useCelebrationSettings } from '../celebrate/context'
import {
  BLUR_RANGE,
  OPACITY_RANGE,
  THEME_META,
  THEME_MODES,
  WALLPAPERS,
  WALLPAPER_META,
  type Wallpaper,
} from '../lib/appearance'
import { FONT_ORDER, FONTS, type FontId } from '../lib/fonts'
import { PRESET_ORDER, PRESET_THEMES, type PresetId } from '../lib/presetThemes'
import { cx, formatDate } from '../lib/format'

export function SettingsPage() {
  const { user, logout } = useAuth()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const navigate = useNavigate()
  const [importGuideOpen, setImportGuideOpen] = useState(false)
  useAutoOpenFromQuery('import', () => setImportGuideOpen(true))

  return (
    <>
      <PageHeader title="My Settings" />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Appearance is by far the tallest card, so the two short display
            settings that belong with it move over here — otherwise the right
            column ran a screen longer than the left. */}
        <div className="flex flex-col gap-4">
          <AppearanceCard />
          <GlassCard />
        </div>

        <div className="flex flex-col gap-4">
          <CelebrationsCard />
          <TodoSuggestionsCard />
          <LocationCard />
          <DeveloperModeCard />
          <BackupPanel />

          <Card>
            <CardHeader
              title={
                <span className="flex items-center gap-1.5">
                  Bring Your Own AI
                  <InfoHint label="Copy a prompt into any AI with your old spreadsheet or notes. Paste or drop the JSON it returns — we add applications, contacts, catch-ups, todos and calendar events to this account without wiping what’s already here. Full backups still use Backup & Restore." />
                </span>
              }
              subtitle="Have an existing tracker? Convert it with any AI, then import the JSON here."
            />
            <Button
              className="mt-4 w-full"
              onClick={() => setImportGuideOpen(true)}
              icon={<Icon name="sparkles" size={15} />}
            >
              Import from another tracker
            </Button>
          </Card>

          <Card>
            <CardHeader title="Account" />
            <dl className="mt-3 flex flex-col gap-2 text-[13.5px]">
              <div className="flex justify-between gap-3">
                <dt className="text-ink-3">Username</dt>
                <dd className="text-ink">{user?.username}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-3">Member since</dt>
                <dd className="text-ink">
                  {user?.date_joined ? formatDate(user.date_joined.slice(0, 10)) : '—'}
                </dd>
              </div>
            </dl>
            <Button
              className="mt-4 w-full"
              onClick={() => navigate('/?tour=1')}
              icon={<Icon name="sparkles" size={15} />}
            >
              Replay tutorial
            </Button>
            <Button
              className="mt-2 w-full"
              onClick={() => void logout()}
              icon={<Icon name="logout" size={15} />}
            >
              Log out
            </Button>

            <div className="mt-4 border-t border-line pt-4">
              <Button
                variant="danger"
                className="mt-3 w-full"
                onClick={() => setDeleteOpen(true)}
                icon={<Icon name="trash" size={15} />}
              >
                Delete all my data
              </Button>
            </div>
          </Card>
        </div>
      </div>

      <ImportGuideModal open={importGuideOpen} onClose={() => setImportGuideOpen(false)} />
      <DeleteAllDataModal open={deleteOpen} onClose={() => setDeleteOpen(false)} />
    </>
  )
}

function CelebrationsCard() {
  const { enabled, setEnabled } = useCelebrationSettings()
  const { user, setUser } = useAuth()

  /** Local (and localStorage) first so the switch never lags, then the
      account — so the choice follows this user rather than this browser. */
  function choose(next: boolean) {
    setEnabled(next)
    if (!user) return
    void updateProfile({ celebrations_enabled: next })
      .then(setUser)
      .catch(() => {
        // Non-critical: it still applies here, just won't follow to another device.
      })
  }

  return (
    <Card>
      <CardHeader
        title="Celebrations"
        subtitle="A short fireworks burst on real progress — a submission, a stage advance, a finished todo…"
      />
      <label className="mt-3 flex items-center justify-between gap-3">
        <span className="text-[13px] text-ink-2">Show celebrations</span>
        <Switch checked={enabled} onChange={choose} label="Show celebrations" />
      </label>
    </Card>
  )
}

/** Presets, because the useful settings here are a handful of steps rather
    than a continuum — and each has a name you can reason about. */
const GLASS_STOPS = [
  { value: 0, label: 'Off', hint: 'Solid panels' },
  { value: 0.35, label: 'Light', hint: 'A hint of depth' },
  { value: 0.65, label: 'Frosted', hint: 'Clearly translucent' },
  { value: 1, label: 'Liquid', hint: 'Full glass' },
]

function GlassCard() {
  const glass = useGlass()

  return (
    <Card>
      <CardHeader
        title="Liquid glass"
        subtitle="How much the app's panels, toggles and sliders behave like frosted glass."
      />

      <div className="mt-4">
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={Math.round(glass * 100)}
          onChange={(event) => writeGlass(Number(event.target.value) / 100)}
          aria-label="Glass intensity"
          style={{ '--fill': `${Math.round(glass * 100)}%` } as CSSProperties}
          className="glass-slider w-full"
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {GLASS_STOPS.map((stop) => (
            <button
              key={stop.label}
              type="button"
              onClick={() => writeGlass(stop.value)}
              aria-pressed={Math.abs(glass - stop.value) < 0.03}
              title={stop.hint}
              className={cx(
                'rounded-lg px-2.5 py-1 text-[12px] font-medium transition-colors',
                Math.abs(glass - stop.value) < 0.03
                  ? 'bg-brand-soft text-brand-strong'
                  : 'bg-surface-2 text-ink-2 hover:text-ink',
              )}
            >
              {stop.label}
            </button>
          ))}
        </div>
      </div>

      <p className="mt-3 text-[12px] text-ink-3">
        Applies to cards, toggles, sliders, the sidebar and the mobile header.
        Kept per browser — a heavy blur costs more on some machines than others.
        Off leaves every control looking the way it did before this existed.
      </p>
    </Card>
  )
}

function TodoSuggestionsCard() {
  const [enabled, setEnabled] = useTodoSuggestionsSetting()

  return (
    <Card>
      <CardHeader
        title="Todo suggestions"
        subtitle="Follow-up ideas from application dates and catch-ups that nothing is tracking yet."
      />
      <label className="mt-3 flex items-center justify-between gap-3">
        <span className="min-w-0">
          <span className="block text-[13px] text-ink-2">Show suggested follow-ups</span>
        </span>
        <Switch
          checked={enabled}
          onChange={setEnabled}
          label="Show suggested follow-ups"
        />
      </label>
    </Card>
  )
}

function DeveloperModeCard() {
  const [enabled, setEnabled] = useDeveloperMode()

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-1.5">
            Developer Mode
            <InfoHint label="Adds a refinement log to every page — jot down bugs, complaints and improvements as you hit them." />
          </span>
        } subtitle="Log your Bugs, Complaints, Improvements"
      />
      <label className="mt-3 flex items-center justify-between gap-3">
        <span className="text-[13px] text-ink-2">Show the refinement log </span>
        <Switch
          checked={enabled}
          onChange={setEnabled}
          label="Show the refinement log"
        />
      </label>
    </Card>
  )
}

function LocationCard() {
  const { user } = useAuth()
  const [enabled, setEnabled] = useLocationEnabled(user?.id)

  return (
    <Card>
      <CardHeader
        title="Location"
        subtitle="Access your local weather and time"
        action={
          <Switch checked={enabled} onChange={setEnabled} label="Location" />
        }
      />
    </Card>
  )
}

function AppearanceCard() {
  const {
    theme,
    resolvedTheme,
    wallpaper,
    blur,
    opacity,
    preset,
    font,
    setTheme,
    setWallpaper,
    setBlur,
    setOpacity,
    setPreset,
    setFont,
    resetBackdrop,
  } = useAppearance()
  const { user, setUser } = useAuth()
  const { notify } = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  function chooseWallpaper(option: Wallpaper) {
    setWallpaper(option)
  }

  /** 'custom' has no built-in image — the first pick has to come with a file. */
  function pickCustomWallpaper() {
    if (user?.custom_wallpaper) chooseWallpaper('custom')
    else fileInputRef.current?.click()
  }

  // The onboarding tour's "try it" action for this card — `?new=1` opens the
  // system file picker directly, always, unlike the "Add image" tile's own
  // click handler (which just re-selects an already-uploaded photo instead
  // of re-prompting) — the tour's whole point is to demonstrate the upload
  // flow itself, even on an account that already has a wallpaper set.
  useAutoOpenFromQuery('new', () => fileInputRef.current?.click())

  async function onCustomWallpaperFile(file: File) {
    if (!file.type.startsWith('image/')) {
      notify('Pick an image file.', 'error')
      return
    }
    setUploading(true)
    try {
      setUser(await uploadWallpaper(file))
      chooseWallpaper('custom')
      notify('Background uploaded.')
    } catch (err) {
      notify(formatApiError(err), 'error')
    } finally {
      setUploading(false)
    }
  }

  async function clearCustomWallpaper() {
    setUploading(true)
    try {
      setUser(await removeWallpaper())
      if (wallpaper === 'custom') chooseWallpaper('pwc')
      notify('Background removed.')
    } catch (err) {
      notify(formatApiError(err), 'error')
    } finally {
      setUploading(false)
    }
  }

  const customImageUrl = user?.custom_wallpaper ?? null
  const activeWallpaperUrl = wallpaper === 'custom' ? customImageUrl : WALLPAPER_META[wallpaper].url

  return (
    <Card>
      <CardHeader title="Appearance" />

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {THEME_MODES.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setTheme(option)}
            aria-pressed={theme === option}
            title={THEME_META[option].hint}
            className={cx(
              'flex flex-col items-center gap-1.5 rounded-lg border px-2 py-3 text-[13px] font-medium transition-colors',
              theme === option
                ? 'border-brand bg-brand-soft text-brand-strong'
                : 'border-line text-ink-2 hover:bg-surface-2',
            )}
          >
            <Icon
              name={
                option === 'dynamic' ? (resolvedTheme === 'light' ? 'sun' : 'moon') : THEME_META[option].icon
              }
              size={16}
            />
            {THEME_META[option].label}
          </button>
        ))}
      </div>

      {/* Each button carries its own description as hover text, so repeating
          the active one here was saying it twice. What can't be hovered for is
          which way dynamic has currently resolved — that's live state, not a
          description, so it stays. */}
      {theme === 'dynamic' ? (
        <p className="mt-2 text-[12px] text-ink-3">
          Right now: {resolvedTheme === 'light' ? 'day' : 'night'}.
        </p>
      ) : null}

      <div className="mt-5 border-t border-line pt-4">
        <p className="mb-2 text-[13px] font-medium text-ink-2">Background</p>

        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {WALLPAPERS.map((option) => {
            const isCustom = option === 'custom'
            const isNone = option === 'none'
            const meta = WALLPAPER_META[option]
            const imageUrl = isCustom ? customImageUrl : meta.url
            const active = wallpaper === option
            const showAsCta = isCustom && !imageUrl

            if (isNone) {
              // Deliberately not shaped like the others — this is "turn the
              // photo off", not a photo of its own, so a small centred
              // control reads more honestly than a full tile pretending to
              // preview something.
              return (
                <li key={option} className="flex h-17.5 items-center justify-center">
                  <button
                    type="button"
                    onClick={() => chooseWallpaper(option)}
                    aria-pressed={active}
                    aria-label={meta.label}
                    title={meta.description}
                    className={cx(
                      'grid size-11 shrink-0 place-items-center rounded-full transition-colors',
                      active
                        ? 'bg-brand-soft text-brand-strong ring-2 ring-brand-ring'
                        : 'bg-surface-2 text-ink-3 hover:bg-brand-soft hover:text-brand-strong',
                    )}
                  >
                    <Icon name="close" size={18} strokeWidth={2.5} />
                  </button>
                </li>
              )
            }

            return (
              <li key={option} className="group relative">
                <button
                  type="button"
                  onClick={() => (isCustom ? pickCustomWallpaper() : chooseWallpaper(option))}
                  aria-pressed={active}
                  title={meta.description}
                  disabled={isCustom && uploading}
                  className={cx(
                    'w-full overflow-hidden rounded-lg border text-left transition-colors',
                    active
                      ? 'border-brand ring-2 ring-brand-ring'
                      : showAsCta
                        ? 'border-dashed border-line-strong text-ink-2 hover:border-brand hover:text-brand'
                        : 'border-line hover:border-line-strong',
                  )}
                >
                  {showAsCta ? (
                    <span className="relative flex h-17.5 flex-col items-center justify-center gap-1 bg-surface-2">
                      {uploading ? (
                        <Spinner />
                      ) : (
                        <>
                          <Icon name="plus" size={17} />
                          <span className="text-[11.5px] font-medium">Add image</span>
                        </>
                      )}
                      {active ? (
                        <span className="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-brand text-white shadow">
                          <Icon name="check" size={12} />
                        </span>
                      ) : null}
                    </span>
                  ) : (
                    <>
                      <span
                        className="relative flex h-14 items-center justify-center bg-surface-2 bg-cover bg-center"
                        style={imageUrl ? { backgroundImage: `url(${imageUrl})` } : undefined}
                      >
                        {isCustom && uploading ? (
                          <span className="absolute inset-0 grid place-items-center bg-slate-950/45">
                            <Spinner className="text-white" />
                          </span>
                        ) : null}
                        {active ? (
                          <span className="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-brand text-white shadow">
                            <Icon name="check" size={12} />
                          </span>
                        ) : null}
                      </span>
                      <span className="block truncate px-2 py-1.5 text-[11.5px] font-medium text-ink">
                        {meta.label}
                      </span>
                    </>
                  )}
                </button>
                {isCustom && imageUrl && !uploading ? (
                  <button
                    type="button"
                    onClick={() => void clearCustomWallpaper()}
                    aria-label="Remove your background photo"
                    className="absolute left-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-slate-950/60 text-white opacity-0 shadow transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    <Icon name="trash" size={11} />
                  </button>
                ) : null}
              </li>
            )
          })}
        </ul>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) void onCustomWallpaperFile(file)
          }}
          className="hidden"
        />

        {/* Folded away by default. These two are fiddly, set once and then
            never touched again — leaving them open meant the card was mostly
            sliders you weren't using. */}
        {activeWallpaperUrl ? (
          <details className="group/adjust mt-4">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[12.5px] font-medium text-brand hover:underline">
              <Icon
                name="chevronRight"
                size={13}
                className="transition-transform group-open/adjust:rotate-90"
              />
              Adjust transparency
              <InfoHint label="The top of the page keeps a little extra cover whatever you pick, so the heading stays readable." />
            </summary>
            <div className="mt-3 flex flex-col gap-3">
            <Slider
              label="Blur"
              value={blur}
              min={BLUR_RANGE.min}
              max={BLUR_RANGE.max}
              suffix="px"
              onChange={setBlur}
            />
            <Slider
              label="Image opacity"
              value={opacity}
              min={OPACITY_RANGE.min}
              max={OPACITY_RANGE.max}
              suffix="%"
              onChange={setOpacity}
            />
            <button
              type="button"
              onClick={resetBackdrop}
              className="self-start text-[12px] font-medium text-brand hover:underline"
            >
              Reset to this background’s defaults
            </button>
            </div>
          </details>
        ) : null}

      </div>

      <PresetGallery preset={preset} onChange={setPreset} />
      <FontPicker font={font} onChange={setFont} />
    </Card>
  )
}

const COLLAPSED_PRESET_COUNT = 5
const COLLAPSED_FONT_COUNT = 5

/** Keeps the current pick visible even while collapsed, rather than hiding
    it past a "Show all" the user hasn't clicked yet. */
function visibleSlice<T extends string>(order: readonly T[], active: T | null, count: number): T[] {
  const base = order.slice(0, count)
  if (active && !base.includes(active)) return [active, ...base.slice(0, count - 1)]
  return base
}

function PresetGallery({
  preset,
  onChange,
}: {
  preset: PresetId
  onChange: (id: PresetId) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded
    ? PRESET_ORDER
    : visibleSlice(PRESET_ORDER, preset === 'none' ? null : preset, COLLAPSED_PRESET_COUNT)

  return (
    <div className="mt-5 border-t border-line pt-4">
      <p className="mb-3 flex items-center gap-1.5 text-[13px] font-medium text-ink-2">
        Color theme
        <InfoHint label={'Overrides light/dark/intern with a named palette. Pick "Default" to go back to the theme above.'} />
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <button
          type="button"
          onClick={() => onChange('none')}
          aria-pressed={preset === 'none'}
          className={cx(
            'flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-[12.5px] font-medium transition-colors',
            preset === 'none'
              ? 'border-brand bg-brand-soft text-brand-strong'
              : 'border-line text-ink-2 hover:bg-surface-2',
          )}
        >
          Default
          {preset === 'none' ? <Icon name="check" size={12} className="ml-auto shrink-0" /> : null}
        </button>
        {visible.map((id) => {
          const seed = PRESET_THEMES[id]
          const active = preset === id
          return (
            <button
              key={id}
              type="button"
              onClick={() => onChange(id)}
              aria-pressed={active}
              title={seed.label}
              style={{ backgroundColor: seed.surface, color: seed.ink }}
              className={cx(
                'flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-[12.5px] font-medium transition-colors',
                active ? 'border-brand ring-2 ring-brand-ring' : 'border-transparent hover:opacity-90',
              )}
            >
              <span className="flex shrink-0 gap-1">
                <span className="size-3 rounded-full" style={{ backgroundColor: seed.brand }} />
                <span className="size-3 rounded-full" style={{ backgroundColor: seed.series2 }} />
                <span className="size-3 rounded-full" style={{ backgroundColor: seed.series3 }} />
              </span>
              <span className="truncate">{seed.label}</span>
              {active ? <Icon name="check" size={12} className="ml-auto shrink-0" /> : null}
            </button>
          )
        })}
      </div>
      {PRESET_ORDER.length > COLLAPSED_PRESET_COUNT ? (
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="mt-2 text-[12px] font-medium text-brand hover:underline"
        >
          {expanded ? 'Show less' : `Show all ${PRESET_ORDER.length}`}
        </button>
      ) : null}
    </div>
  )
}

function FontPicker({ font, onChange }: { font: FontId; onChange: (id: FontId) => void }) {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? FONT_ORDER : visibleSlice(FONT_ORDER, font, COLLAPSED_FONT_COUNT)

  return (
    <div className="mt-5 border-t border-line pt-4">
      <p className="text-[13px] font-medium text-ink-2">Font</p>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {visible.map((id) => {
          const option = FONTS[id]
          const active = font === id
          return (
            <button
              key={id}
              type="button"
              onClick={() => onChange(id)}
              aria-pressed={active}
              className={cx(
                'flex flex-col gap-1 rounded-lg border px-2.5 py-2 text-left transition-colors',
                active
                  ? 'border-brand bg-brand-soft text-brand-strong'
                  : 'border-line text-ink-2 hover:bg-surface-2',
              )}
            >
              <span className="truncate text-[13.5px]" style={{ fontFamily: option.family }}>
                {option.label}
              </span>
              <span
                className="truncate text-[11px] text-ink-3"
                style={{ fontFamily: option.family }}
              >
                The quick brown fox
              </span>
            </button>
          )
        })}
      </div>
      {FONT_ORDER.length > COLLAPSED_FONT_COUNT ? (
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="mt-2 text-[12px] font-medium text-brand hover:underline"
        >
          {expanded ? 'Show less' : `Show all ${FONT_ORDER.length}`}
        </button>
      ) : null}
    </div>
  )
}

function Slider({
  label,
  value,
  min,
  max,
  suffix,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  suffix: string
  onChange: (value: number) => void
}) {
  const [dragging, setDragging] = useState(false)
  const pct = ((value - min) / (max - min)) * 100

  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-baseline justify-between text-[12.5px] text-ink-2">
        {label}
        <span className="tabular-nums text-ink-3">
          {value}
          {suffix}
        </span>
      </span>
      <div className="relative pt-5">
        {dragging ? (
          <span
            className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-md bg-ink px-1.5 py-0.5 text-[11px] font-semibold text-surface shadow-lg animate-[auth-success-pop_0.15s_ease-out]"
            style={{ left: `${pct}%` }}
          >
            {value}
            {suffix}
          </span>
        ) : null}
        <input
          type="range"
          min={min}
          max={max}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          onPointerDown={() => setDragging(true)}
          onPointerUp={() => setDragging(false)}
          onPointerCancel={() => setDragging(false)}
          style={
            {
              '--fill': `${pct}%`,
              background: `linear-gradient(to right, var(--color-brand) 0%, color-mix(in srgb, var(--color-brand) 55%, #a78bfa) ${pct}%, var(--color-surface-2) ${pct}%, var(--color-surface-2) 100%)`,
            } as CSSProperties
          }
          className={cx('fancy-slider w-full', dragging && 'is-dragging')}
        />
      </div>
    </label>
  )
}


/**
 * Confirmation for the irreversible one.
 *
 * The **No** button carries the red, not Yes — deliberately inverted from the
 * usual "destructive action is red" convention, so the eye lands on the way
 * out rather than on the way through. Confirming is the plain button, and it
 * additionally requires typing DELETE.
 */
function DeleteAllDataModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { notify } = useToast()
  const [confirmText, setConfirmText] = useState('')
  const [working, setWorking] = useState(false)

  const [lastOpen, setLastOpen] = useState(open)
  if (open !== lastOpen) {
    setLastOpen(open)
    if (open) setConfirmText('')
  }

  async function confirm() {
    setWorking(true)
    try {
      const result = await deleteAllData()
      const total = Object.values(result.deleted).reduce((sum, n) => sum + n, 0)
      notify(`Deleted ${total} record${total === 1 ? '' : 's'}. Your account is empty.`)
      onClose()
      // A hard reload rather than refetching a dozen caches by hand — every
      // page's data is gone, and half-stale lists would be worse than a blink.
      window.location.assign('/')
    } catch (err) {
      notify(formatApiError(err), 'error')
      setWorking(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Delete all your data?"
      description="This cannot be undone. Export a backup first if you might want any of it back."
      footer={
        <>
          <Button
            onClick={() => void confirm()}
            loading={working}
            disabled={confirmText.trim().toUpperCase() !== 'DELETE'}
          >
            Yes, delete everything
          </Button>
          <Button variant="danger" onClick={onClose}>
            No, keep my data
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-[13.5px] text-ink-2">
          Every application, contact, catch-up, todo, calendar event, resume and profile
          entry on this account will be permanently removed. Shared reference data
          (companies, roles, places) stays, and so does your login.
        </p>
        <Input
          label="Type DELETE to confirm"
          value={confirmText}
          onChange={(event) => setConfirmText(event.target.value)}
          placeholder="DELETE"
          autoComplete="off"
        />
      </div>
    </Modal>
  )
}
