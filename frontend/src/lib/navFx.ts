/**
 * Which hover animation each sidebar row plays, and whether that animation
 * replaces the icon or sits on top of it.
 *
 * Split out from NavEffect.tsx so that file only exports a component — sharing
 * constants from a component module breaks React Fast Refresh.
 */
export type NavFx = 'grid' | 'case' | 'books' | 'ticks' | 'sonar' | 'steam' | 'write' | 'swing'

/** Effects that rebuild the icon's shape, so the real icon steps aside. */
const SWAPS: NavFx[] = ['grid', 'case', 'books', 'ticks']

export function hidesIcon(fx: NavFx): boolean {
  return SWAPS.includes(fx)
}
