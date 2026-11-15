/**
 * Meetings' rules without a screen (PLAN-V17 T3-9): the day groups, one status a row, how each row
 * writes its time, and the address. Made-up names only.
 */
import { describe, expect, it } from 'vitest'
import { DRAFTING_POLL_MS, meetingsPollMs } from '@/api/hooks/meetings'
import type { Meeting, MeetingItem } from '@/api/types'
import { meetingsHref, meetingsQuery, preReadHref, readMeetings, writeMeetings } from './params'
import { groupUpcoming, isCancelled, rowKey, rowStatus } from './rows'
import { dayText, pastWhen, upcomingWhen, waitingLine, whereWords } from './words'

// Weeks run Monday to Sunday.
const WEDNESDAY = '2026-11-18'

type ItemChanges = Partial<Omit<MeetingItem, 'meeting'>> & { meeting?: Partial<Meeting> }

function item({ meeting, ...changes }: ItemChanges = {}): MeetingItem {
  return {
    meeting: {
      more_companies: false,
      id: 'm1',
      company_id: '101',
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
      ...meeting,
    },
    company_name: 'Sample Logistics Pty Ltd',
    group: 'today',
    form: null,
    notes_logged: false,
    typed: false,
    ...changes,
  }
}

describe('the day groups', () => {
  it("groups by the server's day, in the server's order, and leaves empty groups out", () => {
    const groups = groupUpcoming([
      // The server sends the rep's own first on the team's list: that order stays.
      item({ meeting: { id: 'b', starts_at: '2026-11-18T03:00:00Z' }, group: 'today' }),
      item({ meeting: { id: 'a', starts_at: '2026-11-17T23:00:00Z' }, group: 'today' }),
      // The server's group wins over anything the page could work out from the date.
      item({ meeting: { id: 'c', starts_at: '2026-11-23T13:30:00Z' }, group: 'this_week' }),
      item({ meeting: { id: 'd', starts_at: '2026-11-30T23:00:00Z' }, group: 'later' }),
    ])
    expect(groups.map(({ group, items }) => [group, items.map((one) => one.meeting.id)])).toEqual([
      ['today', ['b', 'a']],
      ['this_week', ['c']],
      ['later', ['d']],
    ])
  })

  it('puts an upcoming meeting with no group under Later, which writes its whole day', () => {
    expect(groupUpcoming([item({ group: null })]).map(({ group }) => group)).toEqual(['later'])
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
    const cancelled = item({
      meeting: { outcome: 'CANCELED' },
      form: { id: 'f1', status: 'draft' },
    })
    expect(isCancelled(cancelled)).toBe(true)
    expect(rowStatus(cancelled, false)).toBe('cancelled')
    expect(rowStatus(cancelled, true)).toBe('cancelled')
    // HubSpot's spelling, in any case, and the other spelling too.
    expect(isCancelled(item({ meeting: { outcome: 'canceled' } }))).toBe(true)
    expect(isCancelled(item({ meeting: { outcome: 'Cancelled' } }))).toBe(true)
    expect(isCancelled(item({ meeting: { outcome: 'RESCHEDULED' } }))).toBe(false)
    expect(isCancelled(item({ meeting: { outcome: null } }))).toBe(false)
  })

  it('says where the pre-read of a past meeting typed in stands: it has no notes to log', () => {
    const typed = (status: 'draft' | 'sent') =>
      item({ typed: true, meeting: { id: '' }, form: { id: 'f9', status } })
    expect(rowStatus(typed('sent'), true)).toBe('sent')
    expect(rowStatus(typed('draft'), true)).toBe('draft')
    expect(rowStatus(typed('sent'), false)).toBe('sent')
  })

  it("names a video call's service as Track 2's facts do: Teams, unless the location says Zoom or Google Meet", () => {
    expect(whereWords({ where: 'online', location: null })).toBe('Teams')
    expect(whereWords({ where: 'online', location: 'Microsoft Teams Meeting' })).toBe('Teams')
    expect(whereWords({ where: 'online', location: 'https://us02web.zoom.us/j/81234567890' })).toBe(
      'Zoom',
    )
    expect(whereWords({ where: 'online', location: 'Zoom call' })).toBe('Zoom')
    expect(
      whereWords({ where: 'online', location: 'Google Meet: meet.google.com/abc-defg-hij' }),
    ).toBe('Google Meet')
    expect(whereWords({ where: 'in_person', location: 'Level 3, 1 Sample St' })).toBe('In person')
    // Not known, a phone call included: nothing.
    expect(whereWords({ where: 'unknown', location: 'https://zoom.us/j/1' })).toBeNull()
  })

  it('keys a meeting typed in (its HubSpot id is empty) by its form', () => {
    expect(rowKey(item())).toBe('m1')
    expect(
      rowKey(item({ typed: true, meeting: { id: '' }, form: { id: 'f9', status: 'draft' } })),
    ).toBe('f9')
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

  it("says the server's sentence while the list can't show it all, then what still works", () => {
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
    expect(preReadHref('f 1')).toBe('/companies/meetings/f%201')
  })
})
