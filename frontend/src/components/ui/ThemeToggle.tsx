import { useAppearance } from '../../appearance/context'
import { THEME_META, THEMES } from '../../lib/appearance'
import { cx } from '../../lib/format'
import { DayNightSwitch } from './DayNightSwitch'
import { Icon } from './Icon'

/**
 * Single button that steps light → dark → intern; the full picker is in
 * Settings. In Dynamic mode it stops being a cycle button and becomes a
 * live day/night switch instead — flipping it overrides today's automatic
 * pick rather than stepping to the next theme.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, resolvedTheme, cycleTheme, setTheme } = useAppearance()

  if (theme === 'dynamic') {
    const isNight = resolvedTheme === 'dark'
    const label = `Dynamic theme: currently ${isNight ? 'night' : 'day'} (${resolvedTheme}). Click to override.`
    return (
      <DayNightSwitch
        checked={isNight}
        onChange={(next) => setTheme(next ? 'dark' : 'light')}
        label={label}
        className={className}
      />
    )
  }

  const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]
  const label = `Theme: ${THEME_META[theme].label}. Switch to ${THEME_META[next].label}`

  return (
    <button
      type="button"
      onClick={cycleTheme}
      aria-label={label}
      title={label}
      className={cx(
        'rounded-lg border border-line bg-surface p-2 text-ink-2 shadow-sm transition-colors',
        'hover:bg-surface-2 hover:text-ink intern:backdrop-blur-md',
        className,
      )}
    >
      <Icon name={THEME_META[theme].icon} />
    </button>
  )
}
