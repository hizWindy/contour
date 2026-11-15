/**
 * A time of day, read the way people type one (DESIGN.md "Fields forgive", principles 02 #18), for
 * New pre-read's meeting time (PLAN-V17 T3-9): "10", "10am", "10:30", "10.30", "1030", "2pm",
 * "2:30 pm", "14:00" and "noon" all work. The field shows the time it read ("2:00 pm"), so the rep
 * sees which one.
 *
 * - With am or pm, the hour is 1 to 12. Without, 13 to 23 (and 0) is the 24-hour clock.
 * - A bare hour from 1 to 6 is in the afternoon, and 7 to 11 in the morning (a meeting at "2" is
 *   at 2 pm, TBC). 12 is noon.
 *
 * `melbourneIso` turns a Melbourne day and time into the moment the API takes, with Melbourne's
 * offset on that day (+11:00 in daylight saving, +10:00 out of it).
 */
import { TIME_ZONE } from './format'

export interface Clock {
  /** 0 to 23. */
  hours: number
  /** 0 to 59. */
  minutes: number
}

export type TimeOfDay = { kind: 'empty' } | ({ kind: 'time' } & Clock) | { kind: 'unreadable' }

const NOON = new Set(['noon', 'midday', '12 noon', 'lunchtime', 'lunch'])
const TIME =
  /^(?:at\s+)?(\d{1,2})(?:[:.h]?(\d{2}))?\s*(a|am|a\.m\.?|p|pm|p\.m\.?)?(?:\s*o'?clock)?$/

/** Reads a time of day. Only text it truly can't read is `unreadable`. */
export function readTimeOfDay(text: string): TimeOfDay {
  const words = text.trim().toLowerCase().replace(/\s+/g, ' ')
  if (words === '') return { kind: 'empty' }
  if (NOON.has(words)) return { kind: 'time', hours: 12, minutes: 0 }
  const match = TIME.exec(words)
  if (!match) return { kind: 'unreadable' }
  const [, hourText = '', minuteText, half] = match
  let hours = Number(hourText)
  const minutes = minuteText === undefined ? 0 : Number(minuteText)
  if (minutes > 59) return { kind: 'unreadable' }
  if (half !== undefined) {
    if (hours < 1 || hours > 12) return { kind: 'unreadable' }
    const afternoon = half.startsWith('p')
    hours = (hours % 12) + (afternoon ? 12 : 0)
  } else if (hours > 23) {
    return { kind: 'unreadable' }
  } else if (hours >= 1 && hours <= 6) {
    // A bare 1 to 6 is a meeting in the afternoon, not before dawn.
    hours += 12
  }
  return { kind: 'time', hours, minutes }
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** "10:00 am", "2:30 pm", "12:00 pm", as the rest of the site writes times. */
export function clockText({ hours, minutes }: Clock): string {
  const half = hours >= 12 ? 'pm' : 'am'
  const hour = hours % 12 === 0 ? 12 : hours % 12
  return `${String(hour)}:${pad(minutes)} ${half}`
}

const MINUTE_MS = 60_000
/** Melbourne's standard time, +10:00, in minutes. */
const STANDARD_MINUTES = 10 * 60

const offsetFormat = new Intl.DateTimeFormat('en-AU', {
  timeZone: TIME_ZONE,
  timeZoneName: 'longOffset',
})

/** Melbourne's offset at a moment, in minutes, like 660 for +11:00. */
function offsetMinutes(moment: number): number {
  const name =
    offsetFormat.formatToParts(new Date(moment)).find((part) => part.type === 'timeZoneName')
      ?.value ?? ''
  const match = /([+-])(\d{1,2})(?::?(\d{2}))?/.exec(name)
  if (!match) return 0
  const [, sign = '+', hours = '0', minutes = '0'] = match
  return (sign === '-' ? -1 : 1) * (Number(hours) * 60 + Number(minutes))
}

/**
 * A Melbourne day (YYYY-MM-DD) and time as the API's moment, with Melbourne's offset that day:
 * `melbourneIso('2026-11-26', { hours: 10, minutes: 0 })` is "2026-11-26T10:00:00+11:00".
 */
export function melbourneIso(date: string, clock: Clock): string {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number)
  // The day and time as if Melbourne were on UTC, in ms.
  const wall = Date.UTC(year, month - 1, day, clock.hours, clock.minutes)
  // The offset at a first guess of the moment (standard time, +10:00), then at the moment that
  // offset gives, so a day that daylight saving starts or ends gets the one that holds then.
  const first = offsetMinutes(wall - STANDARD_MINUTES * MINUTE_MS)
  const offset = offsetMinutes(wall - first * MINUTE_MS)
  const sign = offset < 0 ? '-' : '+'
  const size = Math.abs(offset)
  return `${date}T${pad(clock.hours)}:${pad(clock.minutes)}:00${sign}${pad(Math.floor(size / 60))}:${pad(size % 60)}`
}
