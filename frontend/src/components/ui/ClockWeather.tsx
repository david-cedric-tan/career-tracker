import { useEffect, useState } from 'react'
import { cx } from '../../lib/format'
import {
  describeWeatherCode,
  fetchWeather,
  formatTemperature,
  prefersFahrenheit,
  weatherSearchUrl,
  type WeatherSnapshot,
} from '../../lib/weather'
import { Icon } from './Icon'

const CLOCK_TICK_MS = 15_000

/**
 * Live clock + current conditions for the header. Weather resolves through
 * the same geolocation flow as the Dynamic theme (see sunTimes.ts) — a
 * denied or unavailable prompt just means the clock renders alone.
 */
export function ClockWeather({
  className,
  compact = false,
}: {
  className?: string
  /** Time only, no date line or weather — for the crowded mobile top bar. */
  compact?: boolean
}) {
  const [now, setNow] = useState(() => new Date())
  const [weather, setWeather] = useState<WeatherSnapshot | null>(null)

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), CLOCK_TICK_MS)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    let cancelled = false
    void fetchWeather().then((snapshot) => {
      if (!cancelled) setWeather(snapshot)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const timeLabel = now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  const dateLabel = now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
  const weatherInfo = weather ? describeWeatherCode(weather.code, weather.isDay) : null
  const tempLabel = weather ? formatTemperature(weather.temperatureC, prefersFahrenheit()) : null

  return (
    <div
      className={cx(
        'flex items-center rounded-lg border border-line bg-surface shadow-sm',
        compact ? 'gap-2.5 px-3 py-1.5' : 'gap-3 px-3.5 py-1.5',
        'intern:backdrop-blur-md',
        className,
      )}
      title={dateLabel}
    >
      {compact ? (
        <span className="text-[13px] font-semibold tabular-nums text-ink">{timeLabel}</span>
      ) : (
        <div className="flex flex-col leading-none">
          {/* Sized to match the "Career Tracker" wordmark, not the bigger
              page-title greeting — this sits in the header chrome, not the page. */}
          <span className="text-lg font-bold tracking-tight tabular-nums text-ink">{timeLabel}</span>
          <span className="mt-1 text-[11px] text-ink-3">{dateLabel}</span>
        </div>
      )}

      {!compact && weatherInfo && tempLabel ? (
        <>
          <span className="h-8 w-px bg-line" aria-hidden="true" />
          <a
            href={weatherSearchUrl(weather?.locationLabel ?? null)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-ink-2 transition-opacity hover:opacity-80"
            title={`${weatherInfo.label} — search weather${weather?.locationLabel ? ` for ${weather.locationLabel}` : ''}`}
          >
            <Icon name={weatherInfo.icon} size={18} className="text-brand-strong" />
            <div className="flex flex-col leading-none">
              <span className="text-lg font-bold tracking-tight tabular-nums text-ink">{tempLabel}</span>
              {weather?.locationLabel ? (
                <span className="mt-1 max-w-16 truncate text-[11px] text-ink-3">
                  {weather.locationLabel}
                </span>
              ) : null}
            </div>
          </a>
        </>
      ) : null}
    </div>
  )
}
