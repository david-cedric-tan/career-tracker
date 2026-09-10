import { cx } from '../../lib/format'

/** Inline 24px stroke icons — no icon-font dependency, themable via currentColor. */
const PATHS: Record<string, string> = {
  dashboard: 'M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6v-9h-6v9Zm0-16v5h6V4h-6Z',
  briefcase:
    'M4 8h16a1 1 0 0 1 1 1v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a1 1 0 0 1 1-1Zm5 0V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18',
  users:
    'M16 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM21 20v-1a4 4 0 0 0-3-3.87M16.5 4.13a4 4 0 0 1 0 7.75',
  check: 'm5 13 4 4L19 7',
  checklist: 'M4 7h2m-2 5h2m-2 5h2M10 7h10M10 12h10M10 17h10',
  file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Zm0 0v5h5M9 14h6M9 17h4',
  library: 'M4 4h3v16H4zM10 4h3v16h-3zM17 4.5l3 .8-3.5 15-3-.8z',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  refresh: 'M20 11A8 8 0 0 0 6.3 6.3L4 8.5M4 4v4.5h4.5M4 13a8 8 0 0 0 13.7 4.7L20 15.5M20 20v-4.5h-4.5',
  close: 'M6 6l12 12M18 6 6 18',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm5.5-1.5L21 21',
  chevronRight: 'm9 5 7 7-7 7',
  chevronLeft: 'm15 5-7 7 7 7',
  chevronDown: 'm6 9 6 6 6-6',
  calendar: 'M7 3v3m10-3v3M4 9h16M5 6h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-14v5l3 2',
  alert: 'M12 8v5m0 3.5v.5M10.3 3.9 2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  edit: 'M4 20h4L20 8l-4-4L4 16v4Zm10-14 4 4',
  play: 'M8 5v14l11-7-11-7Z',
  pause: 'M9 5v14M15 5v14',
  copy: 'M9 9h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Zm-3 6H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v1',
  trash: 'M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0v12a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V7h11ZM10 11v6M14 11v6',
  logout: 'M15 17l5-5-5-5M20 12H9M12 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h6',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0-14v2m0 18v-2M3 12h2m14 0h2M5.6 5.6l1.4 1.4m10 10 1.4 1.4m0-12.8-1.4 1.4m-10 10L5.6 18.4',
  moon: 'M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z',
  menu: 'M4 7h16M4 12h16M4 17h16',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7L11.5 6.8M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 1 0 5.7 5.7l1.4-1.4',
  mail: 'M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Zm0 1 8 6 8-6',
  phone: 'M7 3h3l2 5-2.5 1.5a12 12 0 0 0 5 5L16 12l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 5 5a2 2 0 0 1 2-2Z',
  sparkles: 'M12 4l1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6L12 4ZM19 15l.7 1.8L21.5 18l-1.8.7L19 20.5l-.7-1.8L16.5 18l1.8-.7L19 15Z',
  building: 'M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16M15 10h4a1 1 0 0 1 1 1v10M4 21h17M8 8h3M8 12h3M8 16h3',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.1l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-1.9-1.1L14.6 3h-4l-.4 2.8c-.7.3-1.3.6-1.9 1.1l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.2l-2 1.6 2 3.4 2.4-1c.6.5 1.2.8 1.9 1.1l.4 2.8h4l.4-2.8c.7-.3 1.3-.6 1.9-1.1l2.4 1 2-3.4-2-1.6c.1-.4.1-.7.1-1.1Z',
  inbox: 'M4 13h4l2 3h4l2-3h4M4 13 6 5h12l2 8v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-6Z',
  coffee:
    'M4 9h13v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V9Zm13 1h2a2.5 2.5 0 0 1 0 5h-2M3 21h15M8 2v3m4-3v3',
  arrowRight: 'M5 12h14m-6-6 6 6-6 6',
  trendingUp: 'm3 17 6-6 4 4 8-8m0 0h-5m5 0v5',
  table: 'M4 6h16v12H4V6Zm0 5h16M9 6v12',
  barChart: 'M4 20V12M11 20V6M18 20V15',
  cloud: 'M7 18a4 4 0 0 1-.5-7.97A5.5 5.5 0 0 1 17 9.5a4 4 0 0 1 .5 8H7Z',
  cloudRain: 'M7 15a4 4 0 0 1-.5-7.97A5.5 5.5 0 0 1 17 6.5a4 4 0 0 1 .5 8H7ZM8 19l-1 2m5-2-1 2m5-2-1 2',
  cloudSnow:
    'M7 13a4 4 0 0 1-.5-7.97A5.5 5.5 0 0 1 17 4.5a4 4 0 0 1 .5 8H7Zm1 6h.01M12 19h.01M16 19h.01M8 22h.01M12 22h.01M16 22h.01',
  cloudLightning: 'M7 15a4 4 0 0 1-.5-7.97A5.5 5.5 0 0 1 17 6.5a4 4 0 0 1 .5 8h-3M11 15l-2 5h3l-2 4',
  cloudFog: 'M7 12a4 4 0 0 1-.5-7.97A5.5 5.5 0 0 1 17 3.5a4 4 0 0 1 .5 8H7ZM5 16h14M7 20h10',
  bell: 'M6 8a6 6 0 0 1 12 0c0 4 1.5 5.5 2 6.5H4c.5-1 2-2.5 2-6.5Zm3.5 10a2.5 2.5 0 0 0 5 0',
  mapPin:
    'M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0ZM12 11.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z',
  bold: 'M7 5h6a3.5 3.5 0 0 1 0 7H7V5Zm0 7h7a3.5 3.5 0 0 1 0 7H7v-7Z',
  italic: 'M15 4h-4m2 0-3 16m3-16 3 16m-3 0h4m-4 0H9',
  underline: 'M7 4v7a5 5 0 0 0 10 0V4M5 20h14',
  strikethrough: 'M5 12h14M8 8a3.5 3.5 0 0 1 3.5-3h1A3.5 3.5 0 0 1 16 8m0 8a3.5 3.5 0 0 1-3.5 3h-1A3.5 3.5 0 0 1 8 16',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  listOrdered: 'M10 6h10M10 12h10M10 18h10M4 5h1v4M3.5 9h2M3.5 14.5h2l-2 2.5h2',
  gripVertical: 'M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01',
}

export function Icon({
  name,
  className,
  size = 18,
  strokeWidth = 1.8,
}: {
  name: keyof typeof PATHS | string
  className?: string
  size?: number
  strokeWidth?: number
}) {
  const d = PATHS[name] ?? PATHS.dashboard
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cx('shrink-0', className)}
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  )
}
