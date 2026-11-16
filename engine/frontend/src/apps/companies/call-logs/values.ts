/**
 * A change's new value, read the way people type it (DESIGN.md "Fields forgive", principles 02
 * #18), and stored in one strict form: a date as YYYY-MM-DD, a number as its digits.
 *
 * - A number: "1,200", "1200 staff" and " 1200 " are 1200.
 * - A date: "30/6/2028", "30-6-28", "30 Jun 2028", "June 30 2028" and "2028-06-30" are 2028-06-30.
 *   The day comes before the month, as in Australia. A date here may be in the past (the last
 *   move), so unlike a follow-up's due date nothing moves forward. A month alone ("June 2028") is
 *   not read: which day is a guess.
 * Anything else is null, so the field can say it couldn't read it.
 */

const MONTHS: Readonly<Record<string, number>> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** YYYY-MM-DD for a real calendar day, or null (31 Jun is not one). */
function isoDay(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1) return null
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return day > last ? null : `${String(year)}-${pad(month)}-${pad(day)}`
}

function fullYear(text: string): number {
  return text.length <= 2 ? 2000 + Number(text) : Number(text)
}

const ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})$/
const NUMERIC = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})$/
const DAY_MONTH = /^(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]+)\.?,?\s+(\d{4})$/
const MONTH_DAY = /^([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/

/** A calendar date as YYYY-MM-DD, or null. */
export function readCalendarDate(text: string): string | null {
  const words = text.trim().toLowerCase().replace(/\s+/g, ' ')
  const iso = ISO.exec(words)
  if (iso) return isoDay(Number(iso[1]), Number(iso[2]), Number(iso[3]))
  const numeric = NUMERIC.exec(words)
  if (numeric) return isoDay(fullYear(numeric[3] ?? ''), Number(numeric[2]), Number(numeric[1]))
  const dayMonth = DAY_MONTH.exec(words)
  const dayMonthMonth = dayMonth ? MONTHS[dayMonth[2] ?? ''] : undefined
  if (dayMonth && dayMonthMonth !== undefined) {
    return isoDay(Number(dayMonth[3]), dayMonthMonth, Number(dayMonth[1]))
  }
  const monthDay = MONTH_DAY.exec(words)
  const monthDayMonth = monthDay ? MONTHS[monthDay[1] ?? ''] : undefined
  if (monthDay && monthDayMonth !== undefined) {
    return isoDay(Number(monthDay[3]), monthDayMonth, Number(monthDay[2]))
  }
  return null
}

/** The value to store for a field of this kind, or null when it can't be read. */
export function readFieldValue(kind: 'date' | 'number' | undefined, text: string): string | null {
  const value = text.trim()
  if (value === '') return null
  if (kind === 'number') {
    const digits = value
      .toLowerCase()
      .replace(/\b(staff|people|employees|heads?)\b/g, '')
      .replace(/[\s,]/g, '')
    return /^\d+$/.test(digits) ? String(Number(digits)) : null
  }
  if (kind === 'date') return readCalendarDate(value)
  return value
}
