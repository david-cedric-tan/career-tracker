import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { cx } from '../../lib/format'
import { Icon } from './Icon'
import { ToastContext, type ToastTone } from './toast-context'

type Toast = { id: number; message: string; tone: ToastTone }

const TONE_STYLES: Record<ToastTone, string> = {
  success: 'border-good/30 bg-good/10 text-ink',
  error: 'border-critical/30 bg-critical/10 text-ink',
  info: 'border-line bg-surface text-ink',
}

const TONE_ICON: Record<ToastTone, { name: string; className: string }> = {
  success: { name: 'check', className: 'text-good' },
  error: { name: 'alert', className: 'text-critical' },
  info: { name: 'sparkles', className: 'text-brand' },
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const notify = useCallback((message: string, tone: ToastTone = 'success') => {
    const id = Date.now() + Math.random()
    setToasts((current) => [...current, { id, message, tone }])
    setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id))
    }, 4500)
  }, [])

  const value = useMemo(() => ({ notify }), [notify])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-3 bottom-3 z-[60] flex flex-col items-center gap-2 sm:inset-x-auto sm:right-5 sm:bottom-5 sm:items-end"
        role="status"
        aria-live="polite"
      >
        {toasts.map((toast) => {
          const icon = TONE_ICON[toast.tone]
          return (
            <div
              key={toast.id}
              className={cx(
                'pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-[13px] shadow-lg backdrop-blur',
                TONE_STYLES[toast.tone],
              )}
            >
              {/* Icon + text, never colour alone. */}
              <Icon name={icon.name} size={16} className={cx('mt-0.5', icon.className)} />
              <span className="min-w-0 flex-1">{toast.message}</span>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}
