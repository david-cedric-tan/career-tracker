import { resolveCoords } from './sunTimes'

export type WeatherSnapshot = {
  temperatureC: number
  code: number
  isDay: boolean
  /** City-level label ("Sydney, Australia"), or null if reverse geocoding failed. */
  locationLabel: string | null
}

// Bump the suffix whenever the cached shape/derivation changes (e.g. the
// city-abbreviation table below) so old browsers don't keep serving a
// snapshot computed under the previous logic until the TTL happens to expire.
const CACHE_KEY = 'weatherSnapshot:v2'
const CACHE_TTL_MS = 20 * 60 * 1000 // weather doesn't need to be second-fresh

type CachedWeather = WeatherSnapshot & { fetchedAt: number }

function readCache(): CachedWeather | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CachedWeather
    if (Date.now() - parsed.fetchedAt > CACHE_TTL_MS) return null
    return parsed
  } catch {
    return null
  }
}

function writeCache(snapshot: WeatherSnapshot): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ...snapshot, fetchedAt: Date.now() }))
  } catch {
    // Fine — just refetches next time.
  }
}

// Common metro-area codes (the familiar 3-letter airport/city codes) for
// cities likely enough to show up here — no reliable free API returns these,
// so it's a curated table rather than a computed guess. Anything missing
// just falls back to the full city name (CSS truncates it if it's long).
const CITY_CODES: Record<string, string> = {
  Sydney: 'SYD',
  Melbourne: 'MEL',
  Brisbane: 'BNE',
  Perth: 'PER',
  Adelaide: 'ADL',
  Canberra: 'CBR',
  Hobart: 'HBA',
  Darwin: 'DRW',
  Auckland: 'AKL',
  Wellington: 'WLG',
  Manila: 'MNL',
  'Quezon City': 'MNL',
  'Hong Kong': 'HKG',
  Singapore: 'SIN',
  Tokyo: 'TYO',
  Osaka: 'OSA',
  Seoul: 'SEL',
  Beijing: 'BJS',
  Shanghai: 'SHA',
  Bangkok: 'BKK',
  Jakarta: 'JKT',
  'Kuala Lumpur': 'KUL',
  Mumbai: 'BOM',
  Delhi: 'DEL',
  'New Delhi': 'DEL',
  Bangalore: 'BLR',
  London: 'LON',
  Paris: 'PAR',
  Berlin: 'BER',
  Amsterdam: 'AMS',
  Dublin: 'DUB',
  'New York': 'NYC',
  'Los Angeles': 'LAX',
  'San Francisco': 'SFO',
  Chicago: 'CHI',
  Boston: 'BOS',
  Seattle: 'SEA',
  Toronto: 'YTO',
  Vancouver: 'YVR',
  Dubai: 'DXB',
}

/**
 * City-level label for coordinates via BigDataCloud's free client-side
 * reverse-geocoding endpoint — no key, CORS-enabled, made for exactly this
 * (browser calls it directly). Best-effort: a failure just means no location
 * line renders, not a broken widget.
 */
async function resolveLocationLabel(lat: number, lon: number): Promise<string | null> {
  try {
    const url = new URL('https://api.bigdatacloud.net/data/reverse-geocode-client')
    url.searchParams.set('latitude', lat.toFixed(4))
    url.searchParams.set('longitude', lon.toFixed(4))
    url.searchParams.set('localityLanguage', 'en')

    const response = await fetch(url.toString())
    if (!response.ok) return null
    const data = (await response.json()) as {
      city?: string
      locality?: string
      principalSubdivision?: string
      countryCode?: string
      countryName?: string
    }
    const place = data.city || data.locality || data.principalSubdivision
    const country = data.countryCode || data.countryName
    if (!place) return country ?? null
    const placeLabel = CITY_CODES[place] ?? place
    return country ? `${placeLabel}, ${country}` : placeLabel
  } catch {
    return null
  }
}

/**
 * Current conditions for the header's clock/weather widget. Open-Meteo needs
 * no API key and takes lat/lon directly — reuses the same cached coordinates
 * as the Dynamic theme's sunrise/sunset lookup (see sunTimes.ts), so there's
 * only ever one geolocation prompt across the whole app.
 */
export async function fetchWeather(): Promise<WeatherSnapshot | null> {
  const cached = readCache()
  if (cached) return cached

  const coords = await resolveCoords()
  if (!coords) return null

  try {
    const url = new URL('https://api.open-meteo.com/v1/forecast')
    url.searchParams.set('latitude', coords.lat.toFixed(4))
    url.searchParams.set('longitude', coords.lon.toFixed(4))
    url.searchParams.set('current', 'temperature_2m,weather_code,is_day')
    url.searchParams.set('timezone', 'auto')

    const [response, locationLabel] = await Promise.all([
      fetch(url.toString()),
      resolveLocationLabel(coords.lat, coords.lon),
    ])
    if (!response.ok) return null
    const data = (await response.json()) as {
      current?: { temperature_2m?: number; weather_code?: number; is_day?: number }
    }
    const current = data.current
    if (!current || typeof current.temperature_2m !== 'number') return null

    const snapshot: WeatherSnapshot = {
      temperatureC: current.temperature_2m,
      code: current.weather_code ?? 0,
      isDay: current.is_day !== 0,
      locationLabel,
    }
    writeCache(snapshot)
    return snapshot
  } catch {
    return null
  }
}

/** Google weather search for this location — the click-through target for the widget. */
export function weatherSearchUrl(locationLabel: string | null): string {
  const query = locationLabel ? `weather in ${locationLabel}` : 'weather'
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`
}

const RAIN_CODES = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82])
const SNOW_CODES = new Set([71, 73, 75, 77, 85, 86])
const STORM_CODES = new Set([95, 96, 99])

/** Maps an Open-Meteo WMO weather code to an icon name + short label. */
export function describeWeatherCode(code: number, isDay: boolean): { icon: string; label: string } {
  if (code === 0) return { icon: isDay ? 'sun' : 'moon', label: 'Clear sky' }
  if (code === 1) return { icon: isDay ? 'sun' : 'moon', label: 'Mainly clear' }
  if (code === 2) return { icon: 'cloud', label: 'Partly cloudy' }
  if (code === 3) return { icon: 'cloud', label: 'Overcast' }
  if (code === 45 || code === 48) return { icon: 'cloudFog', label: 'Fog' }
  if (RAIN_CODES.has(code)) return { icon: 'cloudRain', label: 'Rain' }
  if (SNOW_CODES.has(code)) return { icon: 'cloudSnow', label: 'Snow' }
  if (STORM_CODES.has(code)) return { icon: 'cloudLightning', label: 'Thunderstorm' }
  return { icon: 'cloud', label: 'Cloudy' }
}

export function formatTemperature(celsius: number, useFahrenheit: boolean): string {
  const value = useFahrenheit ? (celsius * 9) / 5 + 32 : celsius
  return `${Math.round(value)}°${useFahrenheit ? 'F' : 'C'}`
}

// Countries that still use Fahrenheit day-to-day for weather.
const FAHRENHEIT_REGIONS = new Set(['US', 'LR', 'MM', 'BS', 'KY', 'PW', 'FM', 'MH'])

export function prefersFahrenheit(): boolean {
  try {
    const region = new Intl.Locale(navigator.language).maximize().region
    return region ? FAHRENHEIT_REGIONS.has(region) : false
  } catch {
    return false
  }
}
