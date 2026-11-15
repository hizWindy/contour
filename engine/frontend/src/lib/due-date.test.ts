import { describe, expect, it } from 'vitest'
import { dueDateText, readDueDate } from './due-date'

// Sunday 15 Nov 2026, Melbourne. Weeks run Monday to Sunday.
const SUNDAY = '2026-11-15'
// Wednesday 18 Nov 2026.
const WEDNESDAY = '2026-11-18'

function day(text: string, today = WEDNESDAY): string | undefined {
  const read = readDueDate(text, today)
  return read.kind === 'date' ? read.date : undefined
}

describe('readDueDate', () => {
  it('reads the examples from the plan', () => {
    expect(day('tomorrow')).toBe('2026-11-19')
    expect(day('next tue')).toBe('2026-11-24')
    expect(day('in 2 weeks')).toBe('2026-12-02')
    expect(day('24 nov')).toBe('2026-11-24')
    expect(day('24/11')).toBe('2026-11-24')
  })

  it('is empty when nothing is typed', () => {
    expect(readDueDate('   ', WEDNESDAY)).toEqual({ kind: 'empty' })
  })

  it('forgives case, spaces, commas, a full stop and a leading "on" or "by"', () => {
    expect(day('  Tomorrow. ')).toBe('2026-11-19')
    expect(day('By Friday')).toBe('2026-11-20')
    expect(day('on the 24th of November, 2026')).toBe('2026-11-24')
    expect(day('tmrw')).toBe('2026-11-19')
    expect(day('tomoz')).toBe('2026-11-19')
  })

  it('reads today, and the day after tomorrow', () => {
    expect(day('today')).toBe(WEDNESDAY)
    expect(day('day after tomorrow')).toBe('2026-11-20')
  })

  it('counts days, weeks, fortnights, months and years, in words or digits', () => {
    expect(day('in 3 days')).toBe('2026-11-23') // Saturday 21st, moved to Monday
    expect(day('in a week')).toBe('2026-11-25')
    expect(day('two weeks')).toBe('2026-12-02')
    expect(day('2w')).toBe('2026-12-02')
    expect(day('in a fortnight')).toBe('2026-12-02')
    expect(day('in a couple of weeks')).toBe('2026-12-02')
    expect(day('in a month')).toBe('2026-12-18')
    expect(day('6 months')).toBe('2027-05-18')
    expect(day('in a year')).toBe('2027-11-18')
  })

  it('keeps the same day next month, or the last day of a shorter month', () => {
    expect(day('in a month', '2027-01-31')).toBe('2027-03-01') // 28 Feb is a Sunday
    expect(day('next month', '2026-10-30')).toBe('2026-11-30')
  })

  it('reads next week as next Monday', () => {
    expect(day('next week')).toBe('2026-11-23')
    expect(day('next week', SUNDAY)).toBe('2026-11-16')
  })

  it('reads weekdays: on its own the next one, "this" this week, "next" next week', () => {
    // On a Wednesday.
    expect(day('fri')).toBe('2026-11-20')
    expect(day('this friday')).toBe('2026-11-20')
    expect(day('next friday')).toBe('2026-11-27')
    expect(day('tuesday')).toBe('2026-11-24')
    expect(day('this tue')).toBe('2026-11-24') // this week's has gone: the next one
    expect(day('wed')).toBe('2026-11-25') // never today: a week away
    expect(day('this wed')).toBe(WEDNESDAY)
    // On a Sunday, next week starts tomorrow.
    expect(day('next tue', SUNDAY)).toBe('2026-11-17')
    expect(day('tue', SUNDAY)).toBe('2026-11-17')
  })

  it('moves a weekend to the Monday after, and says so', () => {
    expect(readDueDate('sat', WEDNESDAY)).toEqual({
      kind: 'date',
      date: '2026-11-23',
      moved: true,
    })
    expect(readDueDate('today', SUNDAY)).toEqual({ kind: 'date', date: '2026-11-16', moved: true })
    expect(readDueDate('fri', WEDNESDAY)).toEqual({
      kind: 'date',
      date: '2026-11-20',
      moved: false,
    })
  })

  it("keeps a weekend for a meeting's day, and every other rule the same", () => {
    const keep = { weekends: 'keep' } as const
    expect(readDueDate('sat', WEDNESDAY, keep)).toEqual({
      kind: 'date',
      date: '2026-11-21',
      moved: false,
    })
    expect(readDueDate('today', SUNDAY, keep)).toEqual({
      kind: 'date',
      date: SUNDAY,
      moved: false,
    })
    expect(readDueDate('28/11', WEDNESDAY, keep)).toEqual({
      kind: 'date',
      date: '2026-11-28',
      moved: false,
    })
    // The rest reads as a due date does.
    expect(readDueDate('next tue', WEDNESDAY, keep)).toEqual(readDueDate('next tue', WEDNESDAY))
    expect(readDueDate('1/1/2026', WEDNESDAY, keep)).toEqual({ kind: 'past', date: '2026-01-01' })
    expect(readDueDate('soonish', WEDNESDAY, keep)).toEqual({ kind: 'unreadable' })
  })

  it('reads a day and a month in any order, with or without a year', () => {
    expect(day('24 november')).toBe('2026-11-24')
    expect(day('nov 24')).toBe('2026-11-24')
    expect(day('November 24th 2026')).toBe('2026-11-24')
    expect(day('24nov')).toBe('2026-11-24')
    expect(day('3 dec 26')).toBe('2026-12-03')
  })

  it('reads the day before the month, as in Australia, with any separator', () => {
    expect(day('3/12')).toBe('2026-12-03')
    expect(day('3-12-2026')).toBe('2026-12-03')
    expect(day('3.12.26')).toBe('2026-12-03')
    expect(day('2026-12-03')).toBe('2026-12-03')
  })

  it('never gives a past day: a day and month with no year is the next one', () => {
    expect(day('24/10')).toBe('2027-10-25') // 24 Oct 2027 is a Sunday
    expect(day('1 jan')).toBe('2027-01-01')
    expect(day('18/11')).toBe(WEDNESDAY)
  })

  it('says a full date has gone, rather than guess', () => {
    expect(readDueDate('24/10/2026', WEDNESDAY)).toEqual({ kind: 'past', date: '2026-10-24' })
    expect(readDueDate('2025-12-01', WEDNESDAY)).toEqual({ kind: 'past', date: '2025-12-01' })
  })

  it('reads a month on its own as its 1st, this year or next', () => {
    expect(day('march')).toBe('2027-03-01')
    expect(day('in february')).toBe('2027-02-01')
    expect(day('march 2028')).toBe('2028-03-01')
    expect(day('december')).toBe('2026-12-01')
    expect(day('november')).toBe(WEDNESDAY) // the month we are in: from today
  })

  it('says only what it truly can not read', () => {
    for (const text of [
      'soon',
      'whenever',
      '31/11',
      '13/13',
      '24 smarch',
      'next blursday',
      '0 days',
    ]) {
      expect(readDueDate(text, WEDNESDAY), text).toEqual({ kind: 'unreadable' })
    }
  })
})

describe('dueDateText', () => {
  it('writes the day with its weekday', () => {
    expect(dueDateText('2026-11-24')).toBe('Tue 24 Nov 2026')
    expect(dueDateText('2027-01-01')).toBe('Fri 1 Jan 2027')
  })
})
