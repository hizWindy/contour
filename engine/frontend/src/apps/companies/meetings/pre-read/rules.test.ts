/**
 * The pre-read's rules and words without a screen (PLAN-V17 T3-10, T3-11): when "Check and send"
 * may be pressed, a rep's edit to a summary, what a redraft says it costs, who got it, when the
 * meeting is, and who the send goes to. Made-up names only.
 */
import { describe, expect, it } from 'vitest'
import { FORM_POLL_MS, formPollMs, isFormMissing } from '@/api/hooks/meetings'
import { ApiProblem } from '@/api/client'
import type { FormPerson, FormSummary, MeetingFormOut } from '@/api/v17'
import {
  addressKey,
  hasSummaries,
  isTicked,
  readAddresses,
  sendBlock,
  sendTo,
  withSummary,
} from './rules'
import {
  copyNotTriedWords,
  costSoFar,
  DRAFT_ESTIMATE,
  hubspotCopyWords,
  meetingWhen,
  notSavedWords,
  recipientsWords,
  redraftHint,
  sendProblemWords,
  sendToWords,
  sentWords,
  whyLine,
  withEstimate,
} from './words'

const SOURCE = {
  id: 'F1',
  kind: 'hubspot',
  label: 'HubSpot: the company',
  date: null,
  url: null,
} as const

function summary(text: string, by: FormSummary['by'] = 'ai'): FormSummary {
  return { text, by, sources: [SOURCE] }
}

function form(changes: Partial<MeetingFormOut> = {}): MeetingFormOut {
  return {
    id: '0f3c9a2e-1111-2222-3333-444444444444',
    meeting: {
      meeting_id: '9001',
      company_key: '101',
      company_name: 'Sample Logistics Pty Ltd',
      title: 'Office walk-through',
      starts_at: '2026-11-26T23:00:00Z',
      ends_at: '2026-11-27T00:00:00Z',
      where: 'online',
    },
    status: 'draft',
    facts: [],
    summaries: {
      what_they_do: summary('A freight company.'),
      what_we_know: summary('Their Perth lease ends in June 2028.'),
      talks_so_far: summary(''),
    },
    next_step: null,
    going: null,
    sent_to: [],
    sent_at: null,
    sent_by: null,
    hubspot_copy: null,
    cost_usd: '0.0312',
    error: null,
    ...changes,
  }
}

describe('Check and send', () => {
  const ready = {
    status: 'draft' as const,
    nextStep: 'Book a site visit',
    going: 'Jo',
    unsaved: false,
  }

  it('may be pressed once both blanks are filled and the summaries are written', () => {
    expect(sendBlock(ready)).toBeNull()
    // A sent pre-read too, though the page offers no Check and send until it changes (T3-11).
    expect(sendBlock({ ...ready, status: 'sent' })).toBeNull()
  })

  it('waits for the blanks first, each named, and blank means spaces too', () => {
    expect(sendBlock({ ...ready, nextStep: '', going: '  ' })).toBe('both')
    expect(sendBlock({ ...ready, nextStep: ' ' })).toBe('next_step')
    expect(sendBlock({ ...ready, going: '' })).toBe('going')
    // The blanks come before the draft: the rep can fill them in while it is written.
    expect(sendBlock({ ...ready, nextStep: '', status: 'drafting' })).toBe('next_step')
  })

  it('then for a blank that did not save, then for the draft', () => {
    expect(sendBlock({ ...ready, unsaved: true })).toBe('not_saved')
    expect(sendBlock({ ...ready, status: 'drafting' })).toBe('drafting')
    expect(sendBlock({ ...ready, status: 'failed' })).toBe('failed')
  })
})

describe('a summary the rep edits', () => {
  it('is theirs at once, with its sources kept, and nothing else changes', () => {
    const before = form()
    const after = withSummary(before, 'what_we_know', 'The lease ends in 2028.')
    expect(after.summaries.what_we_know).toEqual({
      text: 'The lease ends in 2028.',
      by: 'person',
      sources: [SOURCE],
    })
    expect(after.summaries.what_they_do).toBe(before.summaries.what_they_do)
    expect(before.summaries.what_we_know.by).toBe('ai')
  })

  it('knows when any summary has words', () => {
    expect(hasSummaries(form())).toBe(true)
    const empty = summary('')
    expect(
      hasSummaries(
        form({ summaries: { what_they_do: empty, what_we_know: empty, talks_so_far: empty } }),
      ),
    ).toBe(false)
  })
})

describe('what a redraft costs', () => {
  it("says one draft's cost by the plan's estimate, whatever the drafts so far cost", () => {
    expect(DRAFT_ESTIMATE).toBe('about US$0.03')
    expect(withEstimate('Redraft')).toBe('Redraft (about US$0.03)')
    expect(withEstimate('Try again')).toBe('Try again (about US$0.03)')
  })

  it('says what the drafts have cost so far, from the server, rounded to the cent', () => {
    // The server adds every draft together: two drafts are about US$0.06.
    expect(costSoFar('0.0624')).toBe('US$0.06 so far.')
    expect(redraftHint('0.0624')).toBe(
      'It writes the three summaries again. Your edits are kept. US$0.06 so far.',
    )
    expect(costSoFar('0.004')).toBe('Under US$0.01 so far.')
  })

  it('says nothing about a cost so far while nothing is spent', () => {
    for (const nothing of ['0', '0.000000', 'not money']) {
      expect(costSoFar(nothing)).toBeNull()
      expect(redraftHint(nothing)).toBe('It writes the three summaries again. Your edits are kept.')
    }
  })
})

describe('the words', () => {
  it('names who got it, by name or else by address', () => {
    expect(recipientsWords([])).toBe('')
    expect(recipientsWords([{ name: 'Jo Sample', email: 'jo@example.com' }])).toBe('Jo Sample')
    expect(
      recipientsWords([
        { name: 'Jo Sample', email: 'jo@example.com' },
        { name: ' ', email: 'mia@example.com' },
        { name: 'Al Sample', email: 'al@example.com' },
      ]),
    ).toBe('Jo Sample, mia@example.com and Al Sample')
  })

  it('says who got it, when and who sent it, or when it was last sent', () => {
    const sent = {
      sent_to: [
        { name: 'Jo Sample', email: 'jo@example.com' },
        { name: 'Mia Sample', email: 'mia@example.com' },
      ],
      sent_at: '2026-11-25T22:12:00Z',
      sent_by: 'Al Sample',
    }
    expect(sentWords(sent)).toBe(
      'Sent to Jo Sample and Mia Sample on 26 Nov 2026 at 9:12 am, by Al Sample.',
    )
    expect(sentWords(sent, true)).toBe(
      'Last sent to Jo Sample and Mia Sample on 26 Nov 2026 at 9:12 am, by Al Sample.',
    )
    expect(sentWords({ sent_to: [], sent_at: null, sent_by: null })).toBe('Sent.')
  })

  it("says where the copy in HubSpot stands: the server's sentence, else plain words", () => {
    expect(
      hubspotCopyWords({ state: 'waiting', sentence: "Writing to HubSpot isn't on yet" }),
    ).toBe("Writing to HubSpot isn't on yet.")
    expect(hubspotCopyWords({ state: 'saved', sentence: null })).toBe(
      'A copy is saved in HubSpot, as a note on the company.',
    )
    expect(hubspotCopyWords({ state: 'waiting', sentence: null })).toBe(
      'The copy waits for HubSpot write access. The email still went.',
    )
    expect(hubspotCopyWords({ state: 'off', sentence: ' ' })).toBe(
      "No copy in HubSpot: the company isn't in HubSpot yet.",
    )
    expect(hubspotCopyWords({ state: 'failed', sentence: null })).toBe(
      "The copy in HubSpot didn't save. The email still went.",
    )
  })

  it('says why a save failed, then that it is not saved', () => {
    expect(notSavedWords(new ApiProblem({ title: "You're offline", status: 0 }))).toBe(
      "You're offline. Not saved yet. Try again.",
    )
    expect(notSavedWords(new ApiProblem({ title: 'Something went wrong.', status: 500 }))).toBe(
      'Something went wrong. Not saved yet. Try again.',
    )
  })

  it('writes when the meeting is, in Melbourne time, with the year only for another year', () => {
    expect(meetingWhen('2026-11-26T23:00:00Z', '2026-11-27T00:00:00Z', '2026-11-18')).toBe(
      'Fri 27 Nov, 10:00 am to 11:00 am',
    )
    expect(meetingWhen('2026-11-26T23:00:00Z', null, '2026-11-18')).toBe('Fri 27 Nov, 10:00 am')
    expect(meetingWhen('2027-01-05T22:00:00Z', null, '2026-11-18')).toBe('Wed 6 Jan 2027, 9:00 am')
    // A meeting that runs past midnight writes its last day too.
    expect(meetingWhen('2026-11-27T12:00:00Z', '2026-11-27T14:00:00Z', '2026-11-18')).toBe(
      'Fri 27 Nov, 11:00 pm to Sat 28 Nov, 1:00 am',
    )
  })
})

describe('who the send goes to (T3-11)', () => {
  function person(email: string, changes: Partial<FormPerson> = {}): FormPerson {
    return { email, name: null, why: 'added by you', ticked: true, allowed: true, ...changes }
  }

  it('reads one address, a pasted list, or Outlook names, in lower case, once each', () => {
    expect(readAddresses(' Jo.Sample@Example.com ')).toEqual({
      found: ['jo.sample@example.com'],
      unreadable: [],
    })
    expect(readAddresses('jo@example.com, mia@example.com;al@example.com jo@example.com')).toEqual({
      found: ['jo@example.com', 'mia@example.com', 'al@example.com'],
      unreadable: [],
    })
    expect(readAddresses('Jo Sample <jo@example.com>; "Mia" <MIA@example.com>')).toEqual({
      found: ['jo@example.com', 'mia@example.com'],
      unreadable: [],
    })
    expect(readAddresses('mailto:jo@example.com.')).toEqual({
      found: ['jo@example.com'],
      unreadable: [],
    })
  })

  it('says what is not an address, and takes nothing longer than 254 characters', () => {
    expect(readAddresses('jo at example dot com').unreadable).toEqual([
      'jo',
      'at',
      'example',
      'dot',
      'com',
    ])
    expect(readAddresses('jo@example').unreadable).toEqual(['jo@example'])
    expect(readAddresses('').found).toEqual([])
    const long = `${'a'.repeat(250)}@x.com`
    expect(readAddresses(long)).toEqual({ found: [], unreadable: [long] })
  })

  it('reads a pasted Outlook list whole, and never drops an address without a word', () => {
    // A name with brackets, then a bare address: both are read.
    expect(readAddresses('Jo Sample <jo@example.com>; mia@example.com')).toEqual({
      found: ['jo@example.com', 'mia@example.com'],
      unreadable: [],
    })
    // Names written "Last, First", with or without quotes: the comma doesn't split the name.
    expect(readAddresses('Sample, Jo <jo@example.com>; Rossi, Mia <MIA@example.com>')).toEqual({
      found: ['jo@example.com', 'mia@example.com'],
      unreadable: [],
    })
    expect(readAddresses('"Sample, Jo" <jo@example.com>, "jo@example.com" <jo@example.com>')).toEqual(
      { found: ['jo@example.com'], unreadable: [] },
    )
    // Something after the brackets has no comma before it: it is unreadable, not dropped.
    expect(readAddresses('Jo <jo@example.com> mia@example.com')).toEqual({
      found: ['jo@example.com'],
      unreadable: ['mia@example.com'],
    })
    // A stray stop after the brackets is nothing.
    expect(readAddresses('Jo <jo@example.com>.')).toEqual({
      found: ['jo@example.com'],
      unreadable: [],
    })
    // A word with no name after it isn't half of one.
    expect(readAddresses('jo, <mia@example.com>')).toEqual({
      found: ['mia@example.com'],
      unreadable: ['jo'],
    })
  })

  it("ticks the server's ticks, the rep's changes, and never an address that isn't Contour's", () => {
    const jo = person('Jo@example.com', { name: 'Jo Sample', why: 'on the meeting' })
    const outside = person('mia@elsewhere.com', { allowed: false })
    const al = person('al@example.com', { ticked: false })
    expect(addressKey(jo.email)).toBe('jo@example.com')
    expect(isTicked(jo, {})).toBe(true)
    expect(isTicked(jo, { 'jo@example.com': false })).toBe(false)
    // The server ticks an address it refuses too: it still can't be ticked.
    expect(isTicked(outside, {})).toBe(false)
    expect(isTicked(outside, { 'mia@elsewhere.com': true })).toBe(false)
    expect(sendTo([jo, outside, al], { 'al@example.com': true })).toEqual([
      'Jo@example.com',
      'al@example.com',
    ])
  })

  it('says the count on the button, the why as a line, and a refusal in its own words', () => {
    expect(sendToWords(1)).toBe('Send to 1 person')
    expect(sendToWords(4)).toBe('Send to 4 people')
    expect(whyLine('on the meeting')).toBe('On the meeting')
    expect(
      sendProblemWords(
        new ApiProblem({
          title: 'Only Contour addresses',
          detail:
            'A pre-read goes to Contour addresses only, so nothing was sent. Take out: mia@elsewhere.com.',
          status: 422,
          code: 'outside_address',
        }),
      ),
    ).toEqual({
      title: 'Only Contour addresses.',
      detail:
        'A pre-read goes to Contour addresses only, so nothing was sent. Take out: mia@elsewhere.com.',
    })
    expect(copyNotTriedWords(new ApiProblem({ title: 'Email failed', status: 502 }))).toBe(
      "The copy wasn't tried again. Email failed.",
    )
  })
})

describe('asking again while it drafts', () => {
  it('asks every 2 seconds while drafting, and stops once ready, sent or failed', () => {
    expect(formPollMs(form({ status: 'drafting' }))).toBe(FORM_POLL_MS)
    expect(FORM_POLL_MS).toBe(2000)
    for (const status of ['draft', 'sent', 'failed'] as const) {
      expect(formPollMs(form({ status }))).toBe(false)
    }
    expect(formPollMs(undefined)).toBe(false)
  })

  it('counts a 404 and an id that cannot be a pre-read (422) as not there', () => {
    expect(
      isFormMissing(new ApiProblem({ title: 'Not found', status: 404, code: 'form_not_found' })),
    ).toBe(true)
    expect(isFormMissing(new ApiProblem({ title: 'Bad id', status: 422 }))).toBe(true)
    expect(
      isFormMissing(new ApiProblem({ title: 'Off', status: 409, code: 'meeting_forms_off' })),
    ).toBe(false)
    expect(isFormMissing(new Error('boom'))).toBe(false)
  })
})
