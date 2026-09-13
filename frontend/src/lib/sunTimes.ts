/**
 * Sunrise/sunset for the "Dynamic" theme mode — the general-purpose solar
 * position formula (mean anomaly + equation of the center + ecliptic
 * longitude + hour angle), the same math behind most "is it day or night
 * here" utilities. No API call, no dependency: plain trigonometry over a
 * latitude/longitude/date, verified against known sunrise/transit/sunset
 * times for several cities spanning both hemispheres.
 */

const DEG = Math.PI / 180
const RAD = 180 / Math.PI
const J2000 = 2451545.0009 // Julian date of 2000-01-01 12:00 UTC, Meeus-adjusted
const MS_PER_DAY = 86_400_000
const UNIX_EPOCH_JD = 2_440_587.5
const ATMOSPHERIC_REFRACTION_DEG = -0.833 // official zenith incl. the sun's apparent radius

function toJulianDate(date: Date): number {
  return date.getTime() / MS_PER_DAY + UNIX_EPOCH_JD
}

function fromJulianDate(jd: number): Date {
  return new Date((jd - UNIX_EPOCH_JD) * MS_PER_DAY)
}

function normalizeDegrees(deg: number): number {
  return ((deg % 360) + 360) % 360
}

export type SunTimes = { sunrise: Date; transit: Date; sunset: Date } | null

/**
 * Today's sunrise/solar-transit/sunset at the given coordinates, or null for
 * a polar day/night (caller should fall back to a fixed rule).
 *
 * `lon` is standard east-positive (as `navigator.geolocation` reports it) —
 * negated internally, since the underlying formula's longitude term is
 * west-positive.
 */
export function getSunTimes(lat: number, lon: number, date = new Date()): SunTimes {
  const lw = -lon
  const jd = toJulianDate(date)
  const daysSinceJ2000 = Math.round(jd - J2000 - lw / 360)
  const meanSolarNoon = J2000 + lw / 360 + daysSinceJ2000

  const meanAnomaly = normalizeDegrees(357.5291 + 0.98560028 * (meanSolarNoon - J2000))
  const meanAnomalyRad = meanAnomaly * DEG
  const equationOfCenter =
    1.9148 * Math.sin(meanAnomalyRad) +
    0.02 * Math.sin(2 * meanAnomalyRad) +
    0.0003 * Math.sin(3 * meanAnomalyRad)
  const eclipticLongitude = normalizeDegrees(meanAnomaly + 102.9372 + equationOfCenter + 180)
  const eclipticLongitudeRad = eclipticLongitude * DEG

  const solarTransit =
    meanSolarNoon +
    0.0053 * Math.sin(meanAnomalyRad) -
    0.0069 * Math.sin(2 * eclipticLongitudeRad)

  const sinDeclination = Math.sin(eclipticLongitudeRad) * Math.sin(23.4397 * DEG)
  const cosHourAngle =
    (Math.sin(ATMOSPHERIC_REFRACTION_DEG * DEG) - Math.sin(lat * DEG) * sinDeclination) /
    (Math.cos(lat * DEG) * Math.cos(Math.asin(sinDeclination)))
  if (cosHourAngle > 1 || cosHourAngle < -1) return null // never rises / never sets today

  const hourAngle = RAD * Math.acos(cosHourAngle)
  return {
    sunrise: fromJulianDate(solarTransit - hourAngle / 360),
    transit: fromJulianDate(solarTransit),
    sunset: fromJulianDate(solarTransit + hourAngle / 360),
  }
}

/** Whether `at` falls between today's sunrise and sunset. */
export function isDaytime(lat: number, lon: number, at = new Date()): boolean {
  const times = getSunTimes(lat, lon, at)
  if (!times) return isDaytimeFallback(at) // polar day/night
  return at >= times.sunrise && at < times.sunset
}

const FALLBACK_START_HOUR = 7
const FALLBACK_END_HOUR = 19

export { resolveCoords } from './location'

/** No location available at all — a fixed, no-permission-needed day window. */
export function isDaytimeFallback(at = new Date()): boolean {
  return at.getHours() >= FALLBACK_START_HOUR && at.getHours() < FALLBACK_END_HOUR
}
