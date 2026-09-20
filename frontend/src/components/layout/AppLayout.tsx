import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import type { CSSProperties } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/context'
import { OnboardingTour } from '../OnboardingTour'
import { ReminderScheduler } from '../ReminderScheduler'
import { NotificationsPanel } from './NotificationsPanel'
import { NavEffect } from './NavEffect'
import { hidesIcon } from '../../lib/navFx'
import { QuickAccessMenu } from './QuickAccessMenu'
import {
  MOTION_PROFILE,
  readMedia,
  useMediaSettings,
  writeMedia,
  type MediaSettings,
  type MotionLevel,
} from '../../lib/mediaSettings'
import { TooltipLayer } from '../ui/TooltipLayer'
import { cx, displayName, shortName } from '../../lib/format'
import { Avatar } from '../ui/Avatar'
import { Icon } from '../ui/Icon'
import { LotsoScene } from '../LotsoScene'
import { SCENES, hoverTrackFor, useBrandScene, writeScene, type Scene } from '../../lib/brandScene'
import { Wallpaper } from './Wallpaper'
import { RefinementLog } from '../devmode/RefinementLog'
import { useUnseenReplies } from '../devmode/useUnseenReplies'
import { listKeyForPath, listPath } from '../../lib/listState'

/** `fx` is the hover animation for each row — matched to the destination, not
    just "something moves". See NavEffect. */
const NAV = [
  { to: '/', label: 'Dashboard', icon: 'dashboard', end: true, fx: 'grid' as const },
  { to: '/applications', label: 'Applications', icon: 'briefcase', fx: 'case' as const },
  { to: '/network', label: 'Network', icon: 'users', fx: 'sonar' as const },
  { to: '/catchups', label: 'Catch-ups', icon: 'coffee', fx: 'steam' as const },
  { to: '/todos', label: 'Todos', icon: 'checklist', fx: 'ticks' as const },
  { to: '/calendar', label: 'Calendar', icon: 'calendar', fx: 'swing' as const },
  { to: '/files', label: 'File Directory', icon: 'file', fx: 'write' as const },
  { to: '/job-directory', label: 'Job Directory', icon: 'library', fx: 'books' as const },
]

/**
 * Two targets, not one: the mark is the user's profile picture and opens their
 * profile, while the wordmark goes home. Splitting them keeps each link's
 * destination guessable from what you clicked.
 */
export const APP_VERSION = '1.5'

/** The making-of, for the credit screen. */
const CREDITS = [
  { label: 'Made in', value: 'Sydney, AU' },
  { label: 'Built with', value: 'React · Django' },
  { label: 'Made for', value: 'Resilient Individuals' },
]

/** Staggered so the sky is never empty and never marches in formation. */
const NATURE_BIRDS = [
  { top: '18%', duration: 4.2, delay: 0 },
  { top: '30%', duration: 5.4, delay: 0.9 },
  { top: '24%', duration: 3.6, delay: 2.1 },
  { top: '40%', duration: 6.1, delay: 3.2 },
]


/** How long the about screen's soundtrack takes to reach full volume. */
const CREDIT_FADE_MS = 1600

/** How long the scene and its soundtrack take to wind down on leaving. */
const SETTLE_MS = 2000

/** How long the brand has to be held before the credit appears. */
const CREDIT_HOLD_MS = 1800

function Brand({ onNavigate }: { onNavigate?: () => void }) {
  const [credit, setCredit] = useState(false)
  // Lifted out of the mark so the wordmark shares the same weather: hovering
  // the icon should blow across the whole logo, not just the square.
  const scene = useBrandScene()
  const media = useMediaSettings()
  const motion = MOTION_PROFILE[media.motion]
  const [active, setActive] = useState(false)
  // Kept mounted for a beat after the pointer leaves, so the scene can drift
  // out instead of vanishing mid-frame.
  const [settling, setSettling] = useState(false)
  const audio = useRef<HTMLAudioElement | null>(null)
  const settleTimer = useRef<number | null>(null)
  const fade = useRef<number | null>(null)
  const startTimer = useRef<number | null>(null)
  const runTimer = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (settleTimer.current !== null) window.clearTimeout(settleTimer.current)
      if (startTimer.current !== null) window.clearTimeout(startTimer.current)
      if (runTimer.current !== null) window.clearTimeout(runTimer.current)
      if (fade.current !== null) window.clearInterval(fade.current)
      audio.current?.pause()
      audio.current = null
    },
    [],
  )

  function startWeather() {
    // `off` means the logo simply doesn't do this.
    if (media.motion === 'off') return
    if (startTimer.current !== null) window.clearTimeout(startTimer.current)
    // The delay is what separates the levels: low makes you rest on the logo,
    // high fires on contact.
    if (motion.delayMs > 0) {
      startTimer.current = window.setTimeout(runWeather, motion.delayMs)
      return
    }
    runWeather()
  }

  function runWeather() {
    if (settleTimer.current !== null) window.clearTimeout(settleTimer.current)
    if (runTimer.current !== null) window.clearTimeout(runTimer.current)
    if (fade.current !== null) window.clearInterval(fade.current)
    setSettling(false)

    // Low and medium stop on their own; high runs until the pointer leaves.
    if (Number.isFinite(motion.runMs)) {
      runTimer.current = window.setTimeout(stopWeather, motion.runMs)
    }
    setActive(true)
    // Re-read every time: the mood may have been switched on the about screen
    // since the last hover. The Theme scene has no track, so there's nothing
    // to play; Lotso plays the nature loop here rather than its own song.
    const track = hoverTrackFor(scene)
    if (!track) {
      audio.current?.pause()
      return
    }
    if (!audio.current) {
      audio.current = new Audio()
      audio.current.loop = true
      audio.current.volume = 0.35
    }
    if (!audio.current.src.endsWith(track)) audio.current.src = track
    audio.current.volume = media.musicVolume
    if (media.musicVolume <= 0) return
    // Rejects when the browser hasn't seen a gesture yet, or the file is
    // missing. Silence is a fine outcome — the scene carries it either way.
    void audio.current.play().catch(() => {})
  }

  function stopWeather() {
    if (startTimer.current !== null) window.clearTimeout(startTimer.current)
    if (runTimer.current !== null) window.clearTimeout(runTimer.current)
    setActive(false)
    setSettling(true)
    settleTimer.current = window.setTimeout(() => setSettling(false), SETTLE_MS)

    // Ramp the volume down rather than cutting it: a loop that stops dead is
    // far more noticeable than one that ebbs away, and the scene is still
    // drifting out over the same couple of seconds.
    const element = audio.current
    if (!element) return
    if (fade.current !== null) window.clearInterval(fade.current)
    const steps = SETTLE_MS / 50
    let step = 0
    fade.current = window.setInterval(() => {
      step += 1
      element.volume = Math.max(0, media.musicVolume * (1 - step / steps))
      if (step >= steps) {
        if (fade.current !== null) window.clearInterval(fade.current)
        fade.current = null
        element.pause()
        element.currentTime = 0
      }
    }, 50)
  }
  const timer = useRef<number | null>(null)
  // A completed hold has to swallow the click that follows it, or letting go
  // would navigate away from the thing that just appeared.
  const fired = useRef(false)

  const cancel = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
  }, [])

  useEffect(() => cancel, [cancel])

  const hold = {
    onPointerDown: () => {
      fired.current = false
      cancel()
      timer.current = window.setTimeout(() => {
        fired.current = true
        setCredit(true)
        navigator.vibrate?.(20)
      }, CREDIT_HOLD_MS)
    },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    // Any real movement is a drag or a scroll, not a hold.
    onPointerMove: cancel,
    onClick: (event: MouseEvent<HTMLAnchorElement>) => {
      if (fired.current) {
        event.preventDefault()
        fired.current = false
        return
      }
      onNavigate?.()
    },
  }

  return (
    <div className="flex items-center gap-2.5">
      {credit ? <BrandCredit onClose={() => setCredit(false)} /> : null}
      <button
        type="button"
        onClick={() => setCredit(true)}
        aria-label="About Career Tracker"
        title="About Career Tracker"
        className="group/climb shrink-0 rounded-lg transition-opacity hover:opacity-90"
      >
        {/* <span className="relative grid size-8 place-items-center overflow-hidden rounded-lg bg-brand text-white shadow-sm">
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <line x1="8" y1="1" x2="8" y2="23" />
            <line x1="16" y1="1" x2="16" y2="23" />
            <line x1="8" y1="4.5" x2="16" y2="4.5" />
            <line x1="8" y1="9" x2="16" y2="9" />
            <line x1="8" y1="13.5" x2="16" y2="13.5" />
            <line x1="8" y1="18" x2="16" y2="18" />
            <line x1="8" y1="22.5" x2="16" y2="22.5" />
          </svg>
          <svg
            viewBox="0 0 24 24"
            className="brand-climber absolute size-5"
            fill="currentColor"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <circle cx="12" cy="4.5" r="2.4" />
            <line x1="12" y1="7.5" x2="12" y2="15" />
            <line x1="12" y1="9.5" x2="8" y2="7.5" />
            <line x1="12" y1="9.5" x2="16" y2="11.5" />
            <line x1="12" y1="15" x2="8.5" y2="20" />
            <line x1="12" y1="15" x2="15.5" y2="20" />
          </svg>
        </span> */}
      <BrandMark
          scene={scene}
          active={active}
          settling={settling}
          onEnter={startWeather}
          onLeave={stopWeather}
        />
      </button>

      <Link
        to="/"
        {...hold}
        title="Dashboard"
        // `nowrap` + `leading-none`: in the 256px sidebar this wrapped to two
        // lines, and since the scene fills the link's box, the grass ended up
        // stranded at the bottom of a tall box with a gap above it. One tight
        // line means the weather hugs the letters.
        className={cx(
          'relative select-none overflow-hidden whitespace-nowrap rounded px-1 py-1 text-[17px] font-extrabold uppercase leading-none tracking-normal text-ink transition-colors hover:text-brand',
          // A strip of ground under the letters for the sleeping bear to lie
          // on, so he's in front of nothing rather than behind the wordmark.
          scene === 'lotso' && 'pb-5',
        )}
      >
        {/* The weather runs across the wordmark too, driven by the icon's
            hover — the logo is one object, so half of it reacting looked like
            a bug rather than a flourish. */}
        {scene === 'nature' ? (
          <NatureScene active={active} settling={settling} wide />
        ) : scene === 'windy' ? (
          <BrandClouds active={active} settling={settling} wide />
        ) : scene === 'lotso' ? (
          <LotsoScene active={active} settling={settling} wide />
        ) : null}
        <span className={cx('relative z-10 inline-block', active && scene === 'windy' && 'word-blown')}>
          Career Tracker
        </span>
      </Link>
    </div>
  )
}

/**
 * The mountain mark, with weather.
 *
 * Hovering drifts clouds across the peak and plays a loop of wind. The audio
 * is created on the first hover rather than at mount — browsers block
 * autoplay until a user gesture, and building it upfront would mean an
 * <audio> element on every page load that may never be used.
 */
function BrandMark({
  scene,
  active,
  settling,
  onEnter,
  onLeave,
}: {
  scene: Scene
  active: boolean
  settling: boolean
  onEnter: () => void
  onLeave: () => void
}) {
  return (
    <span
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      onFocus={onEnter}
      onBlur={onLeave}
      className={cx(
        'relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-lg shadow-sm',
        'transition-colors duration-700',
        scene === 'nature' ? 'bg-emerald-600' : scene === 'lotso' ? 'bg-pink-300' : 'bg-brand',
      )}
    >
      <img src="/fuji_1.svg" alt="" className="relative z-10 size-9 object-contain" />
      {scene === 'nature' ? (
        <NatureScene active={active} settling={settling} />
      ) : scene === 'windy' ? (
        <BrandClouds active={active} settling={settling} />
      ) : scene === 'lotso' ? (
        <LotsoScene active={active} settling={settling} />
      ) : null}
    </span>
  )
}

/**
 * Three cloud bands at different speeds and heights, so the drift reads as
 * weather rather than as one shape sliding past.
 *
 * Shared by the sidebar mark and the credit page: same effect, different size,
 * and the bands are sized in percentages so they scale with whatever box they
 * are dropped into.
 */
function BrandClouds({
  active,
  settling = false,
  thickness = 3,
  wide = false,
}: {
  active: boolean
  /** Winding down — still moving, on its way out. */
  settling?: boolean
  thickness?: number
  /** Wider boxes (the wordmark) need faster bands to cross in the same time. */
  wide?: boolean
}) {
  const speed = wide ? 0.55 : 1
  if (!active && !settling) return null
  return (
    <span
      aria-hidden="true"
      className={cx(
        'brand-clouds',
        wide && 'is-wide',
        active && 'is-windy',
        settling && 'is-settling',
      )}
    >
      {/* Ice and a lake along the base — the cold half of the weather, and
          what makes the windy scene a place rather than just moving air. The
          snowman is square-only: at wordmark height it was a smudge sitting
          against the letters rather than a figure. */}
      <span className="ice-shelf" />
      <span className="ice-lake" />
      {wide ? null : (
        <span className="snowman">
          <span className="snowman-head" />
        </span>
      )}
      <span
        className="brand-cloud"
        style={{ top: '22%', height: thickness, animationDuration: `${3.4 * speed}s` }}
      />
      <span
        className="brand-cloud"
        style={{
          top: '46%',
          height: thickness,
          animationDuration: `${4.6 * speed}s`,
          animationDelay: '0.6s',
        }}
      />
      <span
        className="brand-cloud"
        style={{
          top: '66%',
          height: thickness,
          animationDuration: `${5.8 * speed}s`,
          animationDelay: '1.2s',
        }}
      />
    </span>
  )
}

/**
 * The easter egg behind a long hold on the brand.
 *
 * Long enough that nobody trips it reaching for the dashboard link, short
 * enough to survive being told it's there.
 */
function BrandCredit({ onClose }: { onClose: () => void }) {
  const scene = useBrandScene()
  const media = useMediaSettings()
  const [tuning, setTuning] = useState(false)
  // Starts playing on open. Getting here took a deliberate click on the logo,
  // so the soundtrack is the point rather than an ambush — but it eases in
  // rather than arriving at full volume.
  const [playing, setPlaying] = useState(true)
  const audio = useRef<HTMLAudioElement | null>(null)
  const fade = useRef<number | null>(null)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  // One element reused across scenes: swapping `src` keeps a single audio
  // object rather than leaving the previous track alive and overlapping.
  useEffect(() => {
    if (fade.current !== null) window.clearInterval(fade.current)

    // Theme has no soundtrack — only Windy and Nature do.
    const track = SCENES[scene].track
    if (!track) {
      audio.current?.pause()
      return
    }

    const element = audio.current ?? new Audio()
    audio.current = element
    element.loop = true
    if (element.src !== new URL(track, location.href).href) {
      element.src = track
    }

    if (!playing) {
      element.pause()
      return
    }

    // Ramp up from silence so the loop arrives rather than starts.
    element.volume = 0
    if (media.musicVolume <= 0) return
    void element.play().catch(() => setPlaying(false))
    const steps = CREDIT_FADE_MS / 50
    let step = 0
    fade.current = window.setInterval(() => {
      step += 1
      element.volume = Math.min(media.musicVolume, media.musicVolume * (step / steps))
      if (step >= steps && fade.current !== null) {
        window.clearInterval(fade.current)
        fade.current = null
      }
    }, 50)

    return () => {
      if (fade.current !== null) window.clearInterval(fade.current)
      fade.current = null
    }
  }, [scene, playing, media.musicVolume])

  useEffect(
    () => () => {
      audio.current?.pause()
      audio.current = null
    },
    [],
  )

  const nature = scene === 'nature'
  const themed = scene === 'theme'
  const lotso = scene === 'lotso'

  // Rendered into <body> rather than where it sits in the tree. On mobile the
  // brand lives inside the sticky header, which has its own `backdrop-blur` —
  // and a parent with `backdrop-filter` becomes the backdrop root for its
  // descendants, so this overlay's blur had nothing behind it to sample and
  // simply did nothing.
  return createPortal(
    <div
      role="dialog"
      aria-label="About Career Tracker"
      onClick={onClose}
      className={cx(
        'brand-credit fixed inset-0 z-[90] grid cursor-pointer place-items-center overflow-y-auto p-6 backdrop-blur-md',
        nature ? 'bg-emerald-950/55' : lotso ? 'bg-pink-300/80' : themed ? null : 'bg-slate-950/55',
      )}
      style={
        themed
          ? {
              backgroundColor:
                'color-mix(in srgb, var(--color-brand) 30%, rgb(2 6 23 / 0.72))',
            }
          : undefined
      }
    >
      {/* Clicks inside shouldn't dismiss — the vinyl and the scene switch both
          live here, and closing on every tap would make them unusable. */}
      <div
        onClick={(event) => event.stopPropagation()}
        // Capped on mobile so the message and the credits share one column
        // width — left to shrink-wrap, each block sized to its own longest
        // line and they never lined up.
        className="flex w-full max-w-sm cursor-default flex-col items-center gap-5 text-center sm:max-w-none"
      >
        <span
          className={cx(
            'brand-credit-mark relative grid size-32 place-items-center overflow-hidden rounded-3xl shadow-2xl',
            nature ? 'bg-emerald-600' : lotso ? 'bg-pink-300' : 'bg-brand',
          )}
        >
          {nature ? <NatureScene /> : null}
          {lotso ? <LotsoScene /> : null}
          <img src="/fuji_1.svg" alt="" className="relative z-10 size-28 object-contain" />
          {/* Always moving here — the mark is the subject of this screen, so
              there's no hover to wait for. The themed scene stays bare: its
              point is the palette, and weather on top only muddies it. */}
          {scene === 'windy' ? <BrandClouds active thickness={5} /> : null}
        </span>

        <div className="space-y-1.5">
          <p className="text-[22px] font-bold tracking-tight text-white">Career Tracker</p>
          <p className="text-[12px] font-medium uppercase tracking-[0.2em] text-white/55">
            Version {APP_VERSION}
          </p>
        </div>

        <div className="space-y-1.5">
          <p className="text-[15px] font-medium text-white/90">
            Created with love by{' '}
            <span className="font-semibold text-white">@DavidCedricTan</span>
          </p>
          <p className="text-[19px] font-semibold tracking-tight text-white">
            Keep Trying and Never Give Up.
          </p>
        </div>

        <dl className="grid w-full grid-cols-1 gap-x-8 gap-y-2.5 rounded-xl border border-white/15 bg-white/5 px-5 py-3 text-center sm:w-auto sm:grid-cols-3 sm:text-left">
          {CREDITS.map((row) => (
            <div key={row.label}>
              <dt className="text-[10px] uppercase tracking-wide text-white/45">{row.label}</dt>
              <dd className="text-[12.5px] font-medium text-white/90">{row.value}</dd>
            </div>
          ))}
        </dl>

        <Vinyl
          scene={scene}
          playing={playing}
          onToggle={() => setPlaying((value) => !value)}
          onSwitch={writeScene}
          tuning={tuning}
          onTune={() => setTuning((value) => !value)}
        />

        {tuning ? <MediaPanel media={media} /> : null}

        {/* Set apart from the controls above it — at the old spacing it read
            as part of the settings row rather than as the way out. */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className={cx(
            'mt-9 grid size-12 place-items-center rounded-full text-white/50',
            'transition-colors hover:bg-white/15 hover:text-white',
            'focus-visible:bg-white/15 focus-visible:text-white',
          )}
        >
          <Icon name="close" size={22} />
        </button>
      </div>
    </div>,
    document.body,
  )
}

/**
 * The record. Tapping it starts and stops both the track and the spin; the
 * label beside it switches scene.
 *
 * A vinyl rather than a play button because the spin *is* the state readout —
 * you can tell from across the room whether it's running, with no icon to
 * decode.
 */
function Vinyl({
  scene,
  playing,
  onToggle,
  onSwitch,
  tuning,
  onTune,
}: {
  scene: Scene
  playing: boolean
  onToggle: () => void
  onSwitch: (next: Scene) => void
  tuning: boolean
  onTune: () => void
}) {
  // Theme is the one scene with no soundtrack — Windy and Nature are the
  // only two that carry one. The record shouldn't claim to be playing
  // something that was never there.
  const hasTrack = Boolean(SCENES[scene].track)
  const spinning = playing && hasTrack

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onToggle}
          disabled={!hasTrack}
          aria-pressed={spinning}
          aria-label={hasTrack ? (playing ? 'Pause the soundtrack' : 'Play the soundtrack') : 'This scene has no soundtrack'}
          className={cx('vinyl', spinning && 'is-spinning', `vinyl-${scene}`, !hasTrack && 'opacity-60')}
        >
          <span className="vinyl-groove" />
          <span className="vinyl-groove vinyl-groove-2" />
          <span className="vinyl-label">
            {/* A tiny scene on the label, so the record says which mood it's
                playing rather than relying on the text beside it. */}
            {scene === 'nature' ? (
              <>
                <span className="vinyl-sun" />
                <span className="vinyl-bird" />
                <span className="vinyl-bird vinyl-bird-2" />
              </>
            ) : null}
            <span className="vinyl-hole" />
          </span>
          {/* Counter-spins, so the transport icon stays upright on a turning
              record — and it's what tells you the disc is a button at all. */}
          {hasTrack ? (
            <span className={cx('vinyl-transport', spinning && 'is-spinning')}>
              <Icon name={playing ? 'pause' : 'play'} size={15} />
            </span>
          ) : null}
        </button>

        <div className="text-left">
          <p className="text-[13px] font-semibold text-white">
            {hasTrack ? (playing ? 'Now playing' : 'Paused') : 'No soundtrack'}
          </p>
          <p className="text-[11px] text-white/50">
            {hasTrack ? `${SCENES[scene].label} · tap the record to ${playing ? 'pause' : 'play'}` : `${SCENES[scene].label} — visual only`}
          </p>
        </div>
      </div>

      {/* A two-way switch rather than a cycle button: both moods are visible,
          so you can see what you'd be switching *to* before committing. */}
      <div
        aria-label="Soundtrack and scene"
        className="inline-flex rounded-full border border-white/20 bg-white/10 p-0.5"
      >
        {(Object.keys(SCENES) as Scene[]).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={scene === option}
            onClick={() => onSwitch(option)}
            className={cx(
              'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium transition-colors',
              scene === option
                ? 'bg-white text-slate-900'
                : 'text-white/70 hover:text-white',
            )}
          >
            <Icon name={SCENES[option].icon} size={13} />
            {SCENES[option].label}
          </button>
        ))}

        {/* Same pill, narrower slot — it's a mode of this control rather than
            a separate button, and an icon alone needs no label to explain it
            once it sits beside two that do. */}
        <span className="mx-0.5 my-1 w-px bg-white/20" aria-hidden="true" />
        <button
          type="button"
          onClick={onTune}
          aria-pressed={tuning}
          aria-label="Sound and motion settings"
          title="Sound and motion"
          className={cx(
            'grid w-8 place-items-center rounded-full transition-colors',
            tuning ? 'bg-white text-slate-900' : 'text-white/70 hover:text-white',
          )}
        >
          <Icon name="settings" size={13} />
        </button>
      </div>
    </div>
  )
}

/**
 * The mixing desk behind the vinyl's gear.
 *
 * Music and alerts are separate faders on purpose: turning the soundtrack down
 * to concentrate shouldn't also mute the thing that tells you a deadline is
 * today.
 */
function MediaPanel({ media }: { media: MediaSettings }) {
  function update(patch: Partial<MediaSettings>) {
    writeMedia({ ...readMedia(), ...patch })
  }

  return (
    <div className="media-panel w-72 rounded-xl border border-white/15 bg-white/10 p-4 text-left backdrop-blur">
      <Fader
        label="Music"
        hint="Logo and this screen"
        value={media.musicVolume}
        onChange={(musicVolume) => update({ musicVolume })}
      />
      <Fader
        label="Alerts"
        hint="Reminder chimes"
        value={media.alertVolume}
        onChange={(alertVolume) => update({ alertVolume })}
        className="mt-3"
      />

      <p className="mt-4 text-[10px] uppercase tracking-wide text-white/45">Logo animation</p>
      <div className="mt-1.5 grid grid-cols-4 gap-1">
        {(Object.keys(MOTION_PROFILE) as MotionLevel[]).map((level) => (
          <button
            key={level}
            type="button"
            onClick={() => update({ motion: level })}
            aria-pressed={media.motion === level}
            title={MOTION_PROFILE[level].hint}
            className={cx(
              'rounded-lg px-1 py-1.5 text-[11px] font-medium transition-colors',
              media.motion === level
                ? 'bg-white text-slate-900'
                : 'bg-white/10 text-white/70 hover:text-white',
            )}
          >
            {MOTION_PROFILE[level].label}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-[10.5px] text-white/50">{MOTION_PROFILE[media.motion].hint}</p>
    </div>
  )
}

function Fader({
  label,
  hint,
  value,
  onChange,
  className,
}: {
  label: string
  hint: string
  value: number
  onChange: (value: number) => void
  className?: string
}) {
  return (
    <label className={cx('block', className)}>
      <span className="flex items-baseline justify-between">
        <span className="text-[12px] font-medium text-white">{label}</span>
        <span className="text-[10.5px] tabular-nums text-white/50">
          {value <= 0 ? 'Muted' : `${Math.round(value * 100)}%`}
        </span>
      </span>
      <span className="mb-1 block text-[10px] text-white/45">{hint}</span>
      {/* The fill is drawn from a custom property rather than a second
          element: a native range can't be split into "before the thumb" and
          "after" any other way, and the pseudo-elements inherit it fine. */}
      <input
        type="range"
        min={0}
        max={100}
        value={Math.round(value * 100)}
        onChange={(event) => onChange(Number(event.target.value) / 100)}
        style={{ '--fill': `${Math.round(value * 100)}%` } as CSSProperties}
        className="media-fader w-full"
      />
    </label>
  )
}

/** Sun, drifting birds and a strip of grass — the nature counterpart to the
    cloud bands. */
function NatureScene({
  active = true,
  settling = false,
  wide = false,
}: {
  active?: boolean
  settling?: boolean
  wide?: boolean
}) {
  const speed = wide ? 0.6 : 1
  if (!active && !settling) return null
  return (
    <span
      aria-hidden="true"
      className={cx(
        'nature-scene',
        wide && 'is-wide',
        active && 'is-out',
        settling && 'is-settling',
      )}
    >
      <span className="nature-sun" />
      {NATURE_BIRDS.map((bird, index) => (
        <span
          key={index}
          className="nature-bird"
          style={{
            top: bird.top,
            animationDuration: `${bird.duration * speed}s`,
            animationDelay: `${bird.delay}s`,
          }}
        >
          <span />
        </span>
      ))}
      <span className="nature-grass" />
      {/* Flanking the peak rather than in front of it — the mountain is the
          logo, and trees across its face would read as clutter. */}
      <span className="nature-tree nature-tree-left" />
      <span className="nature-tree nature-tree-right" />
    </span>
  )
}

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-0.5">
      {NAV.map((item) => {
        const key = listKeyForPath(item.to)
        const to = key ? listPath(key) : item.to
        return (
          <NavLink
            key={item.to}
            to={to}
            end={item.end}
            onClick={onNavigate}
            className={({ isActive }) =>
              cx(
                'qa-fx-host flex items-center gap-3 rounded-lg px-3 py-2',
                'text-sm font-medium transition-colors duration-150',
                isActive
                  ? 'bg-brand-soft text-brand-strong'
                  : 'text-ink-2 hover:bg-brand-soft hover:text-brand-strong',
              )
            }
          >
            {/* The effect layers position themselves against this box, so the
                sonar rings and shimmer stay icon-sized rather than sweeping the
                whole row. Hover is detected on the row above it. */}
            <span className="relative grid size-5 shrink-0 place-items-center">
              <NavEffect fx={item.fx} />
              <Icon
                name={item.icon}
                className={cx(
                  'relative',
                  item.fx === 'swing' && 'qa-swing nav-delayed',
                  hidesIcon(item.fx) && 'nav-icon-swap',
                )}
              />
            </span>
            {item.label}
          </NavLink>
        )
      })}
    </nav>
  )
}

function UserCard({
  onNavigate,
  onOpenTicket,
}: {
  onNavigate?: () => void
  onOpenTicket?: (ticketId?: number) => void
}) {
  const { user, logout } = useAuth()
  const name = shortName(user) || '—'
  const fullName = displayName(user) || name

  return (
    <div className="border-t border-line pt-3">
      <div className="flex items-center gap-1">
        <NavLink
          to="/profile"
          onClick={onNavigate}
          className={({ isActive }) =>
            cx(
              'flex min-w-0 flex-1 items-center gap-2.5 rounded-lg p-2 transition-colors',
              isActive ? 'bg-brand-soft' : 'hover:bg-surface-2',
            )
          }
        >
          <Avatar name={fullName} src={user?.avatar} size="sm" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium text-ink" title={fullName}>
              {name}
            </span>
            {/* The handle, not the email: it's what identifies you to the
                other person on this app (a refinement ticket is signed with
                it), and an address in a sidebar is just noise you can't act
                on. */}
            <span className="block truncate text-[11px] text-ink-3">
              {user?.username ? `@${user.username}` : '—'}
            </span>
          </span>
        </NavLink>
        <NotificationsPanel onNavigate={onNavigate} onOpenTicket={onOpenTicket} />
        <NavLink
          to="/settings"
          onClick={onNavigate}
          aria-label="Settings"
          title="Settings"
          className={({ isActive }) =>
            cx(
              'shrink-0 rounded-lg p-2 transition-colors',
              isActive ? 'bg-brand-soft text-brand-strong' : 'text-ink-3 hover:bg-surface-2 hover:text-ink',
            )
          }
        >
          <Icon name="settings" size={17} />
        </NavLink>
      </div>

      <button
        type="button"
        onClick={() => void logout()}
        className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-critical"
      >
        <Icon name="logout" />
        Log out
      </button>
    </div>
  )
}

export function AppLayout() {
  const { user } = useAuth()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [logOpen, setLogOpen] = useState(false)
  const [focusTicketId, setFocusTicketId] = useState<number | null>(null)
  // The quick-access button owns the bottom-right corner; the log window
  // gets out of the way while the shortcuts are fanned out over that space.
  const [quickOpen, setQuickOpen] = useState(false)
  // Replies are announced by the ticket watcher (banner + bell); this only
  // resets its "unseen" count when the log is opened.
  const { clear: clearReplies } = useUnseenReplies(true)

  function openRefinementLog(ticketId?: number) {
    setFocusTicketId(ticketId && ticketId > 0 ? ticketId : null)
    clearReplies()
    setLogOpen(true)
  }

  function closeRefinementLog() {
    setLogOpen(false)
    setFocusTicketId(null)
  }
  const location = useLocation()
  const navigate = useNavigate()
  // Clock/weather is a dashboard-only flourish — every other page just gets
  // the plain theme toggle, so the header stays quiet on pages people work in.
  const isDashboard = location.pathname === '/'
  const isCalendar = location.pathname.startsWith('/calendar')

  // FR-AUTH-07 — runs once per account until dismissed. Computed during
  // render (matching the drawer-close pattern below) rather than in an
  // effect: `checkedFor` only ever advances to the current user's id, so
  // this evaluates once per login rather than re-opening on every render.
  //
  // Lives here rather than on the page that opens it — a "Replay tutorial"
  // button on the Settings page would otherwise navigate the tour to "/" and
  // in doing so unmount Settings, killing the tour instance it just opened.
  // AppLayout wraps every page's <Outlet />, so it's never the thing that
  // unmounts. Settings signals a replay via a `?tour=1` query param instead
  // of owning the tour itself.
  const [tourOpen, setTourOpen] = useState(false)
  const [tourMode, setTourMode] = useState<'auto' | 'manual'>('auto')
  const [checkedFor, setCheckedFor] = useState<number | null>(null)
  if (user && checkedFor !== user.id) {
    setCheckedFor(user.id)
    if (!user.onboarding_completed) {
      setTourOpen(true)
      setTourMode('auto')
    }
  }

  const [lastSearch, setLastSearch] = useState(location.search)
  if (location.search !== lastSearch) {
    setLastSearch(location.search)
    if (new URLSearchParams(location.search).get('tour') === '1') {
      setTourOpen(true)
      setTourMode('manual')
    }
  }

  // Strips the `?tour=1` once consumed above — an effect, since navigate()
  // is an imperative side effect like any other router/DOM API.
  useEffect(() => {
    if (new URLSearchParams(location.search).get('tour') === '1') {
      navigate(location.pathname, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search])

  // Close the mobile drawer whenever the route changes — including on browser
  // back/forward, which no nav-item click handler would catch. Adjusting state
  // during render (rather than in an effect) avoids a flash of the open drawer.
  const [lastPath, setLastPath] = useState(location.pathname)
  if (lastPath !== location.pathname) {
    setLastPath(location.pathname)
    setDrawerOpen(false)
  }

  useEffect(() => {
    if (!drawerOpen) return
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = overflow
    }
  }, [drawerOpen])

  return (
    <>
      <Wallpaper />
      <div className="app-frame min-h-dvh lg:flex">
      {/* Desktop sidebar. `fixed inset-y-0` rather than `sticky` + `h-dvh` —
          a sticky element sized from a viewport unit can end up a hair
          shorter than the real viewport in some browsers (rounding in the
          dvh calculation), leaving a sliver of the wallpaper visible below
          it. `fixed` with both `top` and `bottom` set spans the exact visual
          viewport by definition, no unit math involved. */}
      {/* z-40 so popovers anchored inside it (the notifications panel) sit
          above <main>, which is a later sibling and would otherwise paint
          over them at the default stacking order. Still under the mobile
          drawer's z-50. */}
      <aside className="glass-panel fixed inset-y-0 left-0 z-40 hidden w-64 shrink-0 flex-col border-r border-line bg-surface px-3 py-4 intern:backdrop-blur-xl lg:flex">
        <div className="px-2 pb-5">
          <Brand />
        </div>
        <div className="flex-1 overflow-y-auto">
          <NavItems />
        </div>
        <UserCard onOpenTicket={openRefinementLog} />
      </aside>
      {/* Reserves the sidebar's width in the flex flow, since `fixed` takes
          the real aside out of it. */}
      <div className="hidden w-64 shrink-0 lg:block" aria-hidden="true" />

      {/* Mobile drawer */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-slate-950/45 backdrop-blur-[2px]"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
          <aside
            className="relative flex h-full w-72 max-w-[85vw] flex-col border-r border-line bg-surface px-3 py-4 intern:backdrop-blur-xl"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
          >
            <div className="flex items-center justify-between px-2 pb-5">
              <Brand onNavigate={() => setDrawerOpen(false)} />
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close navigation"
                className="rounded-lg p-1.5 text-ink-3 hover:bg-surface-2 hover:text-ink"
              >
                <Icon name="close" />
              </button>
            </div>
            <div className="flex flex-1 flex-col justify-center overflow-y-auto">
              <NavItems onNavigate={() => setDrawerOpen(false)} />
            </div>
            <UserCard
              onNavigate={() => setDrawerOpen(false)}
              onOpenTicket={openRefinementLog}
            />
          </aside>
        </div>
      ) : null}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="glass-panel sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-line bg-surface/85 px-3 py-2.5 backdrop-blur intern:bg-surface lg:hidden">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation"
            className="rounded-lg p-2 text-ink-2 hover:bg-surface-2 hover:text-ink"
          >
            <Icon name="menu" />
          </button>
          {/* Centred by giving it the space between the two controls and
              letting it own the middle. The clock is gone from this bar — at
              this width it squeezed the wordmark, and the phone already shows
              the time in its own status bar a few pixels above. */}
          <div className="flex min-w-0 flex-1 justify-center">
            <Brand />
          </div>
        </header>

        {/* No theme toggle in here. It used to float in the top-right corner
            of every page, which put a control you touch once a month in the
            same spot on every screen. Theme lives in Settings → Appearance;
            the sign-in screen keeps its own toggle, since there's no Settings
            to reach before you're in. */}

        <main
          className={cx(
            'mx-auto w-full min-w-0 flex-1 overflow-x-hidden',
            // Calendar fills the workspace (width + leftover height) with modest
            // edge padding; other pages stay in the reading column.
            isCalendar
              ? 'flex max-w-none min-h-0 flex-col px-3 py-3 sm:px-4 sm:py-4 lg:px-5 lg:pb-4 xl:px-6'
              : 'max-w-7xl px-3 py-4 sm:px-5 sm:py-6 lg:px-8',
            // Clears the fixed top-right toggle on every page except the
            // dashboard, which handles its own header spacing.
            !isDashboard && 'lg:pt-14',
          )}
        >
          <Outlet />
        </main>
      </div>
      </div>

      <QuickAccessMenu
        hidden={tourOpen}
        onOpenChange={setQuickOpen}
        onOpenRefinementLog={() => openRefinementLog()}
      />
      <OnboardingTour open={tourOpen} onClose={() => setTourOpen(false)} mode={tourMode} />
      <ReminderScheduler onOpenTicket={openRefinementLog} />
      <TooltipLayer />

      {/* The log window. Its old standalone launcher — the small round button
          that floated above the quick-access FAB — is retired: "Talk to a Dev"
          in the quick-access menu opens the log now. Kept for reference:

          {developerMode && !logOpen ? (
            <button onClick={() => openRefinementLog()} className="fixed bottom-24 right-6 …">
              <Icon name="tools" size={18} />
              {unseenReplies > 0 ? <span …>{unseenReplies}</span> : null}
            </button>
          ) : null}
      */}
      {logOpen && !tourOpen && !quickOpen ? (
        <RefinementLog
          onClose={closeRefinementLog}
          initialTicketId={focusTicketId}
        />
      ) : null}
    </>
  )
}
