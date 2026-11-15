/**
 * Meetings' rules without a screen (PLAN-V17 T3-9): the day groups, one status a row, how each row
 * writes its time, and the address. Made-up names only.
 */
import { describe, expect, it } from 'vitest'
import { DRAFTING_POLL_MS, meetingsPollMs } from '@/api/hooks/meetings'
import type { MeetingItem } from '@/api/v17'
import { meetingsHref, meetingsQuery, preReadHref, readMeetings, writeMeetings } from './params'
import { dayGroupOf, groupUpcoming, isCancelled, rowKey, rowStatus } from './rows'
import { dayText, pastWhen, upcomingWhen, waitingLine } from './words'

// Weeks run Monday to Sunday.
const WEDNESDAY = '2026-11-18'
const SATURDAY = '2026-11-21'
const SUNDAY = '2026-11-22'

function item(changes: Partial<MeetingItem> = {}): MeetingItem {
  return {
    id: 'm1',
    company_id: 'c1',
    contact_ids: [],
    owner_id: 'o1',
    title: 'Office walk-through',
    starts_at: '2026-11-17T23:00:00Z',
    ends_at: null,
    where: 'online',
    location: null,
    outcome: null,
    notes: null,
    hubspot_url: null,
    company_key: '101',
    company_name: 'Sample Logistics Pty Ltd',
    mine: true,
    owner: 'Jo Sample',
    people: [],
    form: null,
    notes_logged: false,
    ...changes,
  }
}

describe('the day groups', () => {
  it('puts each Melbourne day in Today, Tomorrow, This week or Later', () => {
    expect(dayGroupOf('2026-11-18', WEDNESDAY)).toBe('today')
    expect(dayGroupOf('2026-11-19', WEDNESDAY)).toBe('tomorrow')
    expect(dayGroupOf('2026-11-20', WEDNESDAY)).toBe('this_week')
    expect(dayGroupOf('2026-11-22', WEDNESDAY)).toBe('this_week')
    expect(dayGroupOf('2026-11-23', WEDNESDAY)).toBe('later')
    // A meeting still going from earlier counts as today.
    expect(dayGroupOf('2026-11-17', WEDNESDAY)).toBe('today')
  })

  it('has no This week on a Saturday or a Sunday', () => {
    expect(dayGroupOf('2026-11-22', SATURDAY)).toBe('tomorrow')
    expect(dayGroupOf('2026-11-23', SATURDAY)).toBe('later')
    expect(dayGroupOf('2026-11-23', SUNDAY)).toBe('tomorrow')
    expect(dayGroupOf('2026-11-24', SUNDAY)).toBe('later')
  })

  it('groups by the day in Melbourne, the earliest first, and leaves empty groups out', () => {
    const groups = groupUpcoming(
      [
        // 2 pm, then 10 am, on Wednesday in Melbourne; 12:30 am on Tuesday 24 Nov there.
        item({ id: 'b', starts_at: '2026-11-18T03:00:00Z' }),
        item({ id: 'a', starts_at: '2026-11-17T23:00:00Z' }),
        item({ id: 'c', starts_at: '2026-11-23T13:30:00Z' }),
      ],
      WEDNESDAY,
    )
    expect(groups.map(({ group, items }) => [group, items.map((one) => one.id)])).toEqual([
      ['today', ['a', 'b']],
      ['later', ['c']],
    ])
  })
})

describe('one status a row', () => {
  it('says where an upcoming pre-read stands', () => {
    expect(rowStatus(item(), false)).toBe('needs')
    for (const status of ['drafting', 'draft', 'sent', 'failed'] as const) {
      expect(rowStatus(item({ form: { id: 'f1', status } }), false)).toBe(status)
    }
  })

  it('says whether a past meeting is logged, and that a cancelled one is cancelled', () => {
    expect(rowStatus(item({ notes_logged: true }), true)).toBe('notes_logged')
    expect(rowStatus(item(), true)).toBe('no_notes')
    const cancelled = item({ outcome: 'CANCELED', form: { id: 'f1', status: 'draft' } })
    expect(isCancelled(cancelled)).toBe(true)
    expect(rowStatus(cancelled, false)).toBe('cancelled')
    expect(rowStatus(cancelled, true)).toBe('cancelled')
    expect(isCancelled(item({ outcome: 'RESCHEDULED' }))).toBe(false)
  })

  it('keys a meeting typed in (no HubSpot id) by its form', () => {
    expect(rowKey(item())).toBe('m1')
    expect(rowKey(item({ id: null, form: { id: 'f9', status: 'draft' } }))).toBe('f9')
  })

  it('asks again every 3 seconds while a form is drafting, and stops after', () => {
    expect(meetingsPollMs([item({ form: { id: 'f1', status: 'drafting' } })])).toBe(
      DRAFTING_POLL_MS,
    )
    expect(meetingsPollMs([item({ form: { id: 'f1', status: 'draft' } })])).toBe(false)
    expect(meetingsPollMs(undefined)).toBe(false)
  })
})

describe('when a meeting is, in words', () => {
  it('writes the time as its group needs it, in Melbourne time', () => {
    expect(upcomingWhen('2026-11-17T23:00:00Z', 'today', WEDNESDAY)).toBe('10:00 am')
    expect(upcomingWhen('2026-11-19T02:00:00Z', 'tomorrow', WEDNESDAY)).toBe('1:00 pm')
    expect(upcomingWhen('2026-11-19T22:30:00Z', 'this_week', WEDNESDAY)).toBe('Fri, 9:30 am')
    expect(upcomingWhen('2026-11-24T04:00:00Z', 'later', WEDNESDAY)).toBe('Tue 24 Nov, 3:00 pm')
  })

  it('writes a past meeting as today, yesterday or its day', () => {
    expect(pastWhen('2026-11-17T22:00:00Z', WEDNESDAY)).toBe('Today, 9:00 am')
    expect(pastWhen('2026-11-17T03:00:00Z', WEDNESDAY)).toBe('Yesterday, 2:00 pm')
    expect(pastWhen('2026-11-12T23:00:00Z', WEDNESDAY)).toBe('Fri 13 Nov, 10:00 am')
  })

  it('adds the year only for another year', () => {
    expect(dayText('2026-12-01', WEDNESDAY)).toBe('Tue 1 Dec')
    expect(dayText('2027-01-05', WEDNESDAY)).toBe('Tue 5 Jan 2027')
  })

  it("says the server's sentence while meetings can't come from HubSpot, then what still works", () => {
    expect(waitingLine('Waiting for HubSpot access to meetings')).toBe(
      'Waiting for HubSpot access to meetings. You can still start a new pre-read.',
    )
    expect(waitingLine("HubSpot isn't connected, so meetings can't be read from it.")).toBe(
      "HubSpot isn't connected, so meetings can't be read from it. You can still start a new pre-read.",
    )
    // No sentence from the server: one that is true for waiting and not connected alike.
    expect(waitingLine(null)).toBe(
      "Meetings can't be read from HubSpot yet. You can still start a new pre-read.",
    )
  })
})

describe("Meetings' address", () => {
  it("reads Upcoming, the rep's own, unsearched, by default", () => {
    expect(readMeetings(new URLSearchParams())).toEqual({
      when: 'upcoming',
      team: false,
      q: '',
      page: 0,
    })
    expect(readMeetings(new URLSearchParams('when=past&team=1&q=vitera&page=3'))).toEqual({
      when: 'past',
      team: true,
      q: 'vitera',
      page: 2,
    })
    // Upcoming is one page.
    expect(readMeetings(new URLSearchParams('page=3')).page).toBe(0)
  })

  it('writes only what differs from the default, and a new view starts at page 1', () => {
    const past = writeMeetings(new URLSearchParams(), { when: 'past' })
    expect(past.toString()).toBe('when=past')
    const second = writeMeetings(past, { page: 1 })
    expect(second.toString()).toBe('when=past&page=2')
    expect(writeMeetings(second, { q: 'vitera 26 nov' }).toString()).toBe(
      'when=past&q=vitera+26+nov',
    )
    expect(writeMeetings(second, { team: true }).toString()).toBe('when=past&team=1')
    expect(writeMeetings(new URLSearchParams('q=x'), { q: '' }).toString()).toBe('')
    expect(meetingsHref()).toBe('/companies/meetings')
    expect(meetingsHref({ when: 'past' })).toBe('/companies/meetings?when=past')
  })

  it('asks the server with every value, and q only when there are words', () => {
    expect(meetingsQuery(readMeetings(new URLSearchParams()))).toEqual({
      when: 'upcoming',
      mine: true,
      limit: 100,
      offset: 0,
    })
    expect(
      meetingsQuery(readMeetings(new URLSearchParams('when=past&team=1&page=2&q=+x+'))),
    ).toEqual({ when: 'past', mine: false, limit: 25, offset: 25, q: 'x' })
  })

  it('links each pre-read to its own page', () => {
    expect(preReadHref('f 1')).toBe('/companies/pre-reads/f%201')
  })
})
