/**
 * Meetings' rules without a screen (PLAN-V17 T3-9, PLAN-V18 T2-3): the day groups, one status a
 * row, how each row writes its time, when the list asks again, and the address. Made-up names only.
 */
import { describe, expect, it } from 'vitest'
import { DRAFTING_POLL_MS, listPollMs, meetingsPollMs, SYNC_POLL_MS } from '@/api/hooks/meetings'
import type { Meeting, MeetingItem, MeetingPage } from '@/api/types'
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
    mine: false,
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

  it('asks again every 2 seconds while HubSpot is read (Sync), and stops once it is done', () => {
    const page = (syncing: boolean, items: MeetingItem[] = []): MeetingPage => ({
      items: items.map((one) => ({ ...one, mine: true })),
      total: items.length,
      meetings_state: 'ready',
      sentence: null,
      who: 'all',
      linked: true,
      team_state: 'ready',
      team_names: [],
      checked_at: null,
      syncing,
      sync_problem: null,
    })
    expect(SYNC_POLL_MS).toBe(2000)
    expect(listPollMs(page(true))).toBe(SYNC_POLL_MS)
    // Reading wins over a draft on its way: the quicker of the two.
    expect(listPollMs(page(true, [item({ form: { id: 'f1', status: 'drafting' } })]))).toBe(
      SYNC_POLL_MS,
    )
    // Done: only a draft on its way keeps it asking, and nothing else does.
    expect(listPollMs(page(false, [item({ form: { id: 'f1', status: 'drafting' } })]))).toBe(
      DRAFTING_POLL_MS,
    )
    expect(listPollMs(page(false))).toBe(false)
    expect(listPollMs(undefined)).toBe(false)
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
  it("reads Upcoming, everyone's, unsearched, by default", () => {
    expect(readMeetings(new URLSearchParams())).toEqual({
      when: 'upcoming',
      who: 'all',
      q: '',
      page: 0,
    })
    expect(readMeetings(new URLSearchParams('when=past&who=team&q=vitera&page=3'))).toEqual({
      when: 'past',
      who: 'team',
      q: 'vitera',
      page: 2,
    })
    expect(readMeetings(new URLSearchParams('who=mine')).who).toBe('mine')
    // Anything else is All, and so is an old link to the team's meetings (PLAN-V17's switch).
    expect(readMeetings(new URLSearchParams('who=everyone')).who).toBe('all')
    expect(readMeetings(new URLSearchParams('team=1')).who).toBe('all')
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
    expect(writeMeetings(second, { who: 'mine' }).toString()).toBe('when=past&who=mine')
    expect(writeMeetings(new URLSearchParams('who=team'), { who: 'all' }).toString()).toBe('')
    expect(writeMeetings(new URLSearchParams('q=x'), { q: '' }).toString()).toBe('')
    // An old link's team=1 goes with the next change.
    expect(writeMeetings(new URLSearchParams('team=1'), { when: 'past' }).toString()).toBe(
      'when=past',
    )
    expect(meetingsHref()).toBe('/companies/meetings')
    expect(meetingsHref({ when: 'past' })).toBe('/companies/meetings?when=past')
    expect(meetingsHref({ who: 'team' })).toBe('/companies/meetings?who=team')
  })

  it('asks the server with every value, and q only when there are words', () => {
    expect(meetingsQuery(readMeetings(new URLSearchParams()))).toEqual({
      when: 'upcoming',
      who: 'all',
      limit: 100,
      offset: 0,
    })
    expect(
      meetingsQuery(readMeetings(new URLSearchParams('when=past&who=mine&page=2&q=+x+'))),
    ).toEqual({ when: 'past', who: 'mine', limit: 25, offset: 25, q: 'x' })
  })

  it('links each pre-read to its own page', () => {
    expect(preReadHref('f 1')).toBe('/companies/meetings/f%201')
  })
})
