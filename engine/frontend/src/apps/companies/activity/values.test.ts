import { describe, expect, it } from 'vitest'
import type { CallNoteOut, CallNotePreview } from '@/api/types'
import { formatDate } from '@/lib/format'
import { cardCounts, sendCounts, sortForConfirm } from './notes'
import { activityQuery, readTab, writeTab } from './params'
import { readCalendarDate, readFieldValue } from './values'
import {
  batchDoneWords,
  callWhen,
  fieldValue,
  loggedWhen,
  notSentHead,
  sendTitle,
  stepName,
  totalsWords,
  waitingLine,
} from './words'

/** Just enough of a note for the counts: a typed call, in the batch. */
function note(id: string, changes: Partial<CallNoteOut> = {}): CallNoteOut {
  return { id, source: 'typed', left_out: false, ...changes } as CallNoteOut
}

describe('a change value forgives (DESIGN.md "Fields forgive")', () => {
  it.each([
    ['30/6/2028', '2028-06-30'],
    ['30-6-28', '2028-06-30'],
    ['30.06.2028', '2028-06-30'],
    ['30 Jun 2028', '2028-06-30'],
    ['30th of June, 2028', '2028-06-30'],
    ['June 30 2028', '2028-06-30'],
    ['2028-06-30', '2028-06-30'],
    // A past day is fine here: the last move was in the past.
    ['1/3/2019', '2019-03-01'],
  ])('reads %s as %s', (text, iso) => {
    expect(readCalendarDate(text)).toBe(iso)
    expect(readFieldValue('date', text)).toBe(iso)
  })

  it.each(['31/6/2028', 'June 2028', 'soon', ''])('does not guess %j', (text) => {
    expect(readFieldValue('date', text)).toBeNull()
  })

  it('reads a staff count with commas and words, and refuses one it cannot read', () => {
    expect(readFieldValue('number', '1,200')).toBe('1200')
    expect(readFieldValue('number', '300 staff')).toBe('300')
    expect(readFieldValue('number', 'about 300')).toBeNull()
  })

  it('shows a value the way a person reads it', () => {
    expect(fieldValue('2027-06-30', 'date')).toBe(formatDate('2027-06-30'))
    expect(fieldValue('1200', 'number')).toBe('1,200')
    expect(fieldValue(null, 'date')).toBe('Empty')
    expect(fieldValue('mid 2027', 'date')).toBe('mid 2027')
  })

  it('reads back the form a card shows as the same value, so an untouched field saves nothing', () => {
    // A field opens as the card shows it ("31 Mar 2028"), in every month's short name.
    const days = [
      ...Array.from({ length: 12 }, (_, index) => `2028-${String(index + 1).padStart(2, '0')}-01`),
      '2028-02-29',
      '2028-03-31',
      '2028-09-30',
      '2027-12-31',
    ]
    for (const day of days) {
      expect(readFieldValue('date', fieldValue(day, 'date')), day).toBe(day)
    }
    for (const count of ['7', '1200', '1500000']) {
      expect(readFieldValue('number', fieldValue(count, 'number')), count).toBe(count)
    }
    expect(readFieldValue(undefined, fieldValue('Level 3', undefined))).toBe('Level 3')
  })
})

describe('the order of "To confirm"', () => {
  const base = { unsure: null } as Pick<CallNoteOut, 'unsure'>
  it('puts a note the sorter was unsure of first, then the calls in the order they were made', () => {
    const notes = [
      { ...base, id: 'b', called_at: '2026-11-15T03:00:00Z' },
      { ...base, id: 'a', called_at: '2026-11-15T01:00:00Z' },
      { ...base, id: 'u', called_at: '2026-11-15T04:00:00Z', unsure: 'Which office?' },
    ] as CallNoteOut[]
    expect(sortForConfirm(notes).map((note) => note.id)).toEqual(['u', 'a', 'b'])
  })
})

describe('the tab in the address', () => {
  it('reads and writes the tab, To confirm having none', () => {
    expect(readTab(new URLSearchParams())).toBe('to_confirm')
    expect(readTab(new URLSearchParams('tab=needs-look'))).toBe('needs_look')
    expect(readTab(new URLSearchParams('tab=nonsense'))).toBe('to_confirm')
    expect(writeTab(new URLSearchParams('tab=logged&x=1'), 'to_confirm').toString()).toBe('x=1')
    expect(writeTab(new URLSearchParams(), 'logged').toString()).toBe('tab=logged')
  })

  it('asks for the rep own notes, and pages Logged', () => {
    expect(activityQuery('to_confirm')).toEqual({
      state: 'to_confirm',
      mine: true,
      limit: 100,
      offset: 0,
    })
    expect(activityQuery('logged', 2)).toEqual({
      state: 'logged',
      mine: true,
      limit: 25,
      offset: 50,
    })
  })
})

describe('the words', () => {
  it('says the totals, a step and the end of a batch in plain words', () => {
    expect(totalsWords({ calls: 7, meetingNotes: 0, tasks: 3, changes: 2 })).toBe(
      '7 calls, 3 tasks, 2 field changes',
    )
    expect(totalsWords({ calls: 1, meetingNotes: 0, tasks: 1, changes: 1 })).toBe(
      '1 call, 1 task, 1 field change',
    )
    expect(totalsWords({ calls: 2, meetingNotes: 1, tasks: 3, changes: 0 })).toBe(
      '2 calls, 1 meeting note, 3 tasks, 0 field changes',
    )
    expect(totalsWords({ calls: 0, meetingNotes: 2, tasks: 0, changes: 0 })).toBe(
      '2 meeting notes, 0 tasks, 0 field changes',
    )
    expect(stepName('task:2')).toBe('Follow-up 2')
    expect(stepName('fields')).toBe('The field changes')
    expect(batchDoneWords(6, 1, 0)).toBe('6 logged in HubSpot. 1 needs a look.')
    expect(batchDoneWords(0, 0, 2)).toBe("2 weren't sent and still wait here.")
    expect(waitingLine('Waiting for HubSpot write access')).toBe(
      'Waiting for HubSpot write access. You can still check and change your calls.',
    )
  })

  it('names what a send holds by kind: calls, and meeting notes apart', () => {
    expect(sendTitle(3)).toBe('Send 3 calls to HubSpot?')
    expect(sendTitle(2, 1)).toBe('Send 2 calls and 1 meeting note to HubSpot?')
    expect(sendTitle(0, 2)).toBe('Send 2 meeting notes to HubSpot?')
    expect(sendTitle(1, 0)).toBe('Send 1 call to HubSpot?')
    expect(sendTitle(0, 0)).toBe('Send to HubSpot?')
    expect(notSentHead(1)).toBe("1 call won't be sent:")
    expect(notSentHead(1, 1)).toBe("1 call and 1 meeting note won't be sent:")
    expect(notSentHead(0, 1)).toBe("1 meeting note won't be sent:")
  })

  it("counts what will go from the server's totals, and a meeting's notes apart on an older one", () => {
    const meeting = note('m1', { source: 'transcript' })
    const preview = (totals: CallNotePreview['totals']): CallNotePreview => ({
      items: [note('a'), note('b'), meeting],
      sending_ready: true,
      waiting_for: null,
      totals,
    })
    // Track 2's totals: calls only, and the meeting notes on their own.
    expect(sendCounts(preview({ calls: 2, meeting_notes: 1, tasks: 3, changes: 1 }))).toEqual({
      calls: 2,
      meetingNotes: 1,
      tasks: 3,
      changes: 1,
    })
    // An older server counted the meeting's notes as a call: they come out of the calls.
    expect(sendCounts(preview({ calls: 3, tasks: 3, changes: 1 }))).toEqual({
      calls: 2,
      meetingNotes: 1,
      tasks: 3,
      changes: 1,
    })
    // The cards being sent, before the preview answers.
    expect(cardCounts([note('a'), meeting])).toEqual({ calls: 1, meetingNotes: 1 })
  })

  it('writes the day of a logged call as the call line beside it does', () => {
    // 04:00 UTC is 3:00 pm in Melbourne in November.
    const today = '2026-11-15'
    expect(callWhen('2026-11-15T04:00:00Z', today)).toBe('Today, 3:00 pm')
    expect(loggedWhen('2026-11-15T04:00:00Z', today)).toBe('Logged today, 3:00 pm')
    expect(callWhen('2026-11-12T04:05:00Z', today)).toBe('12 Nov 2026, 3:05 pm')
    expect(loggedWhen('2026-11-12T04:05:00Z', today)).toBe('Logged 12 Nov 2026, 3:05 pm')
    expect(loggedWhen(null, today)).toBe('Logged')
  })
})
