import { useAppearance } from '../../appearance/context'
import { THEME_META, THEMES } from '../../lib/appearance'
import { cx } from '../../lib/format'
import { Icon } from './Icon'

/**
 * Single button that steps light → dark → intern; the full picker is in
 * Settings.
 *
 * Dynamic is the exception: it isn't a step in that cycle, it's "decide for
 * me". So the first click leaves it for whichever fixed theme is the opposite
 * of what's on screen — night becomes a sun, day becomes a moon — and from
 * there it behaves like any other theme. Stepping dynamic → light → dark →
 * intern would have made the button's next state unguessable, since what you
 * saw was never the theme you were actually on.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, resolvedTheme, cycleTheme, setTheme } = useAppearance()

  const dynamic = theme === 'dynamic'
  // While dynamic, the icon shows what's *on screen* rather than the word
  // "dynamic" — that's what the click is about to flip.
  const shownTheme = dynamic ? resolvedTheme : theme
  const next = dynamic
    ? resolvedTheme === 'dark'
      ? 'light'
      : 'dark'
    : THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]

  const label = dynamic
    ? `Dynamic theme, currently ${THEME_META[resolvedTheme].label}. Switch to ${THEME_META[next].label}`
    : `Theme: ${THEME_META[theme].label}. Switch to ${THEME_META[next].label}`

  return (
    <button
      type="button"
      onClick={() => (dynamic ? setTheme(next) : cycleTheme())}
      aria-label={label}
      title={label}
      className={cx(
        'rounded-lg border border-line bg-surface p-2 text-ink-2 shadow-sm transition-colors',
        'hover:bg-surface-2 hover:text-ink intern:backdrop-blur-md',
        className,
      )}
    >
      <Icon name={THEME_META[shownTheme].icon} />
    </button>
  )
}
