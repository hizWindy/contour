import { describe, expect, it } from 'vitest'
import { clockText, melbourneIso, readTimeOfDay, type Clock } from './time-of-day'

function read(text: string): string | undefined {
  const time = readTimeOfDay(text)
  return time.kind === 'time' ? clockText(time) : undefined
}

describe('readTimeOfDay', () => {
  it('reads the ways people type a time', () => {
    expect(read('10am')).toBe('10:00 am')
    expect(read('10 AM')).toBe('10:00 am')
    expect(read('10:30')).toBe('10:30 am')
    expect(read('10.30')).toBe('10:30 am')
    expect(read('1030')).toBe('10:30 am')
    expect(read('930')).toBe('9:30 am')
    expect(read('2pm')).toBe('2:00 pm')
    expect(read('2:30 p.m.')).toBe('2:30 pm')
    expect(read('14:00')).toBe('2:00 pm')
    expect(read('at 11')).toBe('11:00 am')
    expect(read("3 o'clock")).toBe('3:00 pm')
  })

  it('reads noon and midnight', () => {
    expect(read('noon')).toBe('12:00 pm')
    expect(read('12')).toBe('12:00 pm')
    expect(read('12pm')).toBe('12:00 pm')
    expect(read('12am')).toBe('12:00 am')
  })

  it('reads a bare 1 to 6 as the afternoon, and 7 to 11 as the morning', () => {
    expect(read('2')).toBe('2:00 pm')
    expect(read('6:30')).toBe('6:30 pm')
    expect(read('7')).toBe('7:00 am')
    expect(read('11:15')).toBe('11:15 am')
  })

  it('is empty when nothing is typed, and says only what it truly can not read', () => {
    expect(readTimeOfDay('  ')).toEqual({ kind: 'empty' })
    for (const text of ['25:00', '13pm', '10:75', 'soon', '0am']) {
      expect(readTimeOfDay(text), text).toEqual({ kind: 'unreadable' })
    }
  })
})

describe('melbourneIso', () => {
  const ten: Clock = { hours: 10, minutes: 0 }

  it("writes the moment with Melbourne's offset that day", () => {
    // Daylight saving in November, standard time in June.
    expect(melbourneIso('2026-11-26', ten)).toBe('2026-11-26T10:00:00+11:00')
    expect(melbourneIso('2026-06-26', { hours: 14, minutes: 30 })).toBe('2026-06-26T14:30:00+10:00')
  })

  it('names the same moment the site shows as that day and time', () => {
    const moment = new Date(melbourneIso('2026-11-26', ten))
    expect(moment.toISOString()).toBe('2026-11-25T23:00:00.000Z')
  })

  it('takes the offset that holds at the time, on the days daylight saving starts and ends', () => {
    // 4 Oct 2026: clocks go forward at 2 am. 5 Apr 2026: clocks go back at 3 am.
    expect(melbourneIso('2026-10-04', ten)).toBe('2026-10-04T10:00:00+11:00')
    expect(melbourneIso('2026-04-05', ten)).toBe('2026-04-05T10:00:00+10:00')
  })
})
