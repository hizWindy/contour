/**
 * Dates, numbers and units, written one way on every page.
 *
 *  - Dates are shown in Australia/Melbourne, whatever the computer's time zone is. The backend
 *    stores UTC. A date without a time ("2026-10-07", like a trigger date) is a calendar date and
 *    is never moved by a time zone.
 *  - Numbers use the Australian format (1,234) and always carry their unit: m², staff, companies.
 *  - Money has its own file: money.ts.
 */

export const TIME_ZONE = 'Australia/Melbourne'
const LOCALE = 'en-AU'
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/** Shown where a value is missing. */
export const UNKNOWN = 'Unknown'

const NARROW_SPACES = new RegExp(
  `[${String.fromCharCode(0x202f)}${String.fromCharCode(0xa0)}]`,
  'g',
)

function tidy(text: string): string {
  // Newer Intl versions put a narrow no-break space before "pm". A plain space is safer to search.
  return text.replace(NARROW_SPACES, ' ')
}

interface Moment {
  date: Date
  /** True for a calendar date with no time of day. */
  dateOnly: boolean
}

function toMoment(value: string | number | Date | null | undefined): Moment | null {
  if (value === null || value === undefined || value === '') {
    return null
  }
  if (typeof value === 'string' && DATE_ONLY.test(value)) {
    const date = new Date(`${value}T12:00:00Z`)
    return Number.isNaN(date.getTime()) ? null : { date, dateOnly: true }
  }
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : { date, dateOnly: false }
}

const dateFormats = {
  zoned: new Intl.DateTimeFormat(LOCALE, {
    timeZone: TIME_ZONE,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }),
  calendar: new Intl.DateTimeFormat(LOCALE, {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }),
  dateTime: new Intl.DateTimeFormat(LOCALE, {
    timeZone: TIME_ZONE,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }),
  time: new Intl.DateTimeFormat(LOCALE, {
    timeZone: TIME_ZONE,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }),
  melbourneDay: new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }),
}

/** `26 Oct 2026`, in Melbourne time. Missing or unreadable gives `UNKNOWN`. */
export function formatDate(value: string | number | Date | null | undefined): string {
  const moment = toMoment(value)
  if (!moment) {
    return UNKNOWN
  }
  return tidy((moment.dateOnly ? dateFormats.calendar : dateFormats.zoned).format(moment.date))
}

/** `26 Oct 2026, 3:04 pm`, in Melbourne time. A date without a time shows only the date. */
export function formatDateTime(value: string | number | Date | null | undefined): string {
  const moment = toMoment(value)
  if (!moment) {
    return UNKNOWN
  }
  if (moment.dateOnly) {
    return tidy(dateFormats.calendar.format(moment.date))
  }
  return tidy(dateFormats.dateTime.format(moment.date))
}

/** `3:04 pm`, in Melbourne time. */
export function formatTime(value: string | number | Date | null | undefined): string {
  const moment = toMoment(value)
  if (!moment || moment.dateOnly) {
    return UNKNOWN
  }
  return tidy(dateFormats.time.format(moment.date))
}

/** The Melbourne calendar day of a moment as `YYYY-MM-DD`, the form the API takes for dates. */
export function melbourneDate(value: string | number | Date = new Date()): string {
  const moment = toMoment(value)
  if (!moment) {
    return ''
  }
  return dateFormats.melbourneDay.format(moment.date)
}

const relative = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' })

/**
 * `just now`, `3 minutes ago`, `yesterday`. After a week it falls back to the date. For "last
 * updated" lines. Pass `now` in a test.
 */
export function formatRelative(
  value: string | number | Date | null | undefined,
  now: Date | number = new Date(),
): string {
  const moment = toMoment(value)
  if (!moment) {
    return UNKNOWN
  }
  const seconds = Math.round((moment.date.getTime() - new Date(now).getTime()) / 1000)
  const abs = Math.abs(seconds)
  if (abs < 45) {
    return 'just now'
  }
  if (abs < 45 * 60) {
    return relative.format(Math.round(seconds / 60), 'minute')
  }
  if (abs < 22 * 3600) {
    return relative.format(Math.round(seconds / 3600), 'hour')
  }
  if (abs < 7 * 86400) {
    return relative.format(Math.round(seconds / 86400), 'day')
  }
  return formatDate(moment.date)
}

/** `45 s`, `2 min 5 s`, `1 h 3 min`. For how long a run took. */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds))
  if (seconds < 60) {
    return `${seconds} s`
  }
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) {
    const rest = seconds % 60
    return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`
  }
  const hours = Math.floor(minutes / 60)
  const restMinutes = minutes % 60
  return restMinutes === 0 ? `${hours} h` : `${hours} h ${restMinutes} min`
}

const numbers = new Intl.NumberFormat(LOCALE)
const percents = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 })

/** `1,234`. Missing gives `UNKNOWN`. */
export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return UNKNOWN
  }
  return numbers.format(value)
}

/** `83.3%` from a number of percent (83.33). */
export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return UNKNOWN
  }
  return `${percents.format(value)}%`
}

/**
 * `3,000 m²`. An estimate reads `about 3,000 m²`, because an estimate has to look like one
 * (DESIGN.md, "Words on screen").
 */
export function formatM2(value: number | null | undefined, estimated = false): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return UNKNOWN
  }
  return `${estimated ? 'about ' : ''}${numbers.format(value)} m²`
}

/** `120 staff`. */
/** "51 of 77" when the tool says how many points it could check, else just "51". */
export function formatScore(score: number, checked: number | null | undefined): string {
  return checked ? `${formatNumber(score)} of ${formatNumber(checked)}` : formatNumber(score)
}

export function formatStaff(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return UNKNOWN
  }
  return `${numbers.format(value)} staff`
}

/** `1 company`, `12 companies`. Pass the plural when adding "s" is not right. */
export function pluralise(count: number, one: string, many = `${one}s`): string {
  return `${numbers.format(count)} ${count === 1 ? one : many}`
}

/** `director_review` gives `Director review`. For a label the backend did not give a name. */
export function humanise(value: string): string {
  const text = value.replace(/[_-]+/g, ' ').trim()
  return text === '' ? text : `${text.charAt(0).toUpperCase()}${text.slice(1)}`
}

/** The first 8 characters of an id, for a title or a breadcrumb. */
export function shortId(id: string): string {
  return id.slice(0, 8)
}
