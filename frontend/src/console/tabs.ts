/** The console's screens, in F-key order. */
export const CONSOLE_TABS = [
  { path: '/console', label: 'System', key: 'F1', end: true, icon: 'dashboard' },
  { path: '/console/accounts', label: 'Accounts', key: 'F2', end: false, icon: 'users' },
  { path: '/console/migration', label: 'Data migration', key: 'F3', end: false, icon: 'cloud' },
  { path: '/console/refinements', label: 'Refinement logs', key: 'F4', end: false, icon: 'tools' },
] as const

