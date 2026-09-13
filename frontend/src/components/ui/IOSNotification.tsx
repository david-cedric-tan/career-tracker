import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { cx } from '../../lib/format'
import { Icon } from './Icon'

export type ReminderAlert = {
  key: string
  title: string
  subtitle: string
  /** Where a click goes. Defaults to the calendar. */
  to?: string
  /** Overrides navigation — e.g. opening the ticket window in place. */
  onOpen?: () => void
  /** Small icon on the banner; a bell unless told otherwise. */
  icon?: string
}

const AUTO_DISMISS_MS = 8000

/** Stack of iOS-style banner notifications, top-center, newest on top. */
export function IOSNotificationStack({
  alerts,
  onDismiss,
}: {
  alerts: ReminderAlert[]
  onDismiss: (key: string) => void
}) {
  if (alerts.length === 0) return null

  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[100] flex flex-col items-center gap-2 px-3">
      {alerts.map((alert) => (
        <IOSNotificationBanner
          key={alert.key}
          alert={alert}
          onDismiss={() => onDismiss(alert.key)}
        />
      ))}
    </div>
  )
}

function IOSNotificationBanner({
  alert,
  onDismiss,
}: {
  alert: ReminderAlert
  onDismiss: () => void
}) {
  const navigate = useNavigate()
  const [leaving, setLeaving] = useState(false)

  function dismiss() {
    setLeaving(true)
    window.setTimeout(onDismiss, 280)
  }

  function open() {
    if (alert.onOpen) alert.onOpen()
    else navigate(alert.to ?? '/calendar')
    dismiss()
  }

  useEffect(() => {
    const timer = window.setTimeout(dismiss, AUTO_DISMISS_MS)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') open()
      }}
      className={cx(
        'ios-banner pointer-events-auto w-full max-w-sm cursor-pointer rounded-2xl',
        'px-3.5 py-3 text-white backdrop-blur-xl',
        leaving ? 'ios-banner-exit' : 'ios-banner-enter',
      )}
    >
      <div className="flex items-start gap-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-[9px] bg-brand text-white">
          <Icon name={alert.icon ?? 'bell'} size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[13px] font-semibold text-white">Career Tracker</span>
            <span className="shrink-0 text-[11px] text-white/50">now</span>
          </div>
          <p className="mt-0.5 truncate text-[13.5px] font-medium text-white">{alert.title}</p>
          <p className="truncate text-[12.5px] text-white/70">{alert.subtitle}</p>
        </div>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            dismiss()
          }}
          aria-label="Dismiss notification"
          className="mt-0.5 shrink-0 rounded-full p-1 text-white/40 transition-colors hover:bg-white/10 hover:text-white/80"
        >
          <Icon name="close" size={13} />
        </button>
      </div>
    </div>
  )
}
