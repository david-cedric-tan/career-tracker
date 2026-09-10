export type WidgetId =
  | 'quote'
  | 'calendar'
  | 'photo'
  | 'focus'
  | 'map'
  | 'trend'
  | 'pipeline'
  | 'attention'
  | 'activity'

/**
 * `span` is the widget's natural width in columns, out of the board's four.
 *
 * `bare` marks a widget that brings its own Card and header (the panels that
 * used to live below the board as fixed sections) — the board gives those
 * position, drag and resize only, and overlays its edit controls rather than
 * wrapping them in a second card.
 */
export const WIDGET_META: Record<
  WidgetId,
  { label: string; icon: string; span: WidgetSpan; bare?: boolean }
> = {
  quote: { label: 'Daily Quote', icon: 'sparkles', span: 1 },
  calendar: { label: 'This Week', icon: 'calendar', span: 1 },
  photo: { label: 'Pinned Photo', icon: 'file', span: 1 },
  focus: { label: 'Focus', icon: 'trendingUp', span: 1 },
  map: { label: 'Regions', icon: 'building', span: 4 },
  trend: { label: 'Progress Over Time', icon: 'barChart', span: 3, bare: true },
  // Pipeline and Outcomes are one tile now — two short bar lists that each
  // wasted a card's worth of chrome on their own. Dropping `outcomes` from
  // this map also retires it from any stored layout, since `normalise` keeps
  // only ids it still recognises.
  pipeline: { label: 'Pipeline & outcomes', icon: 'briefcase', span: 2, bare: true },
  attention: { label: 'Needs Attention', icon: 'clock', span: 3, bare: true },
  activity: { label: 'Recent Activity', icon: 'sparkles', span: 4, bare: true },
}

export type WidgetSpan = 1 | 2 | 3 | 4
export const SPANS: WidgetSpan[] = [1, 2, 3, 4]

/** Tailwind needs whole class names, so spans map to fixed strings. */
export const SPAN_CLASS: Record<WidgetSpan, string> = {
  1: 'xl:col-span-1',
  2: 'sm:col-span-2 xl:col-span-2',
  3: 'sm:col-span-2 xl:col-span-3',
  4: 'sm:col-span-2 xl:col-span-4',
}

/** Everything except the map, which stays opt-in from the Hidden tray. */
export const DEFAULT_WIDGETS: WidgetId[] = [
  'quote',
  'calendar',
  'focus',
  'photo',
  'trend',
  'pipeline',
  'attention',
  'activity',
]
