/**
 * The seam the voice bar hands its answer to (PLAN-V22 T3-1 and T3-3), and what is on screen when
 * the rep speaks: a page opens, a call, a task or an email opens the review card, a pre-read opens
 * its page (starting it first if need be), and any other answer shows its read-back. Made-up names
 * only.
 */
import { describe, expect, it, vi } from 'vitest'
import { ApiProblem } from '@/api/client'
import type { AssistantCommand, AssistantMeetingHit, AssistantOpen } from '@/api/types'
import { LEAD_FINDER } from '@/apps/lead-finder/module'
import { OLD_PATHS } from '../old-addresses'
import { closeCard, openedCard } from '../card/store'
import { handOver, LEAD_FINDER_START, pageFor } from './hand-over'
import { closeVoiceBar, openVoiceBar } from './store'
import { MOVED_UNDER_COMPANIES, onPageOf } from './on-page'

function command(change: Partial<AssistantCommand>): AssistantCommand {
  return {
    action: 'log_call',
    read_back: 'Log a call with Jo Sample at Sample Logistics. Follow-up task on Fri 21 Nov.',
    company: null,
    person: null,
    meeting: null,
    note_text: 'Spoke to Jo, they move in March.',
    task: null,
    email: null,
    open: null,
    change: null,
    unsure: null,
    ...change,
  }
}

const FORM = {
  id: 'form-1',
  sent_at: null,
  sent_count: 0,
  sent_names: [],
  status: 'draft' as const,
}

function meetingOf(change: Partial<AssistantMeetingHit>): AssistantCommand['meeting'] {
  return {
    found: {
      id: 'meeting-1',
      title: 'Fit-out walkthrough',
      starts_at: '2026-11-21T09:00:00+11:00',
      company_key: '201',
      company_name: 'Sample Logistics Pty Ltd',
      form: null,
      ...change,
    },
    choices: [],
    from_page: false,
    heard: 'the Sample Logistics meeting',
  }
}

describe('handOver', () => {
  it('unclear words stop before any card: the server’s line, the words to fix (PLAN-V23 T1-6)', () => {
    const go = vi.fn<(to: string) => void>()
    const line =
      "We didn't catch that clearly. You said: 'um the north'. Say it again, or fix the words."
    const said = (unsure: string | null) =>
      handOver(
        {
          kind: 'command',
          command: command({ action: 'unclear', read_back: 'um the north', unsure }),
          words: 'um the north',
          source: 'mic',
        },
        { go },
      )
    expect(said(line)).toEqual({ kind: 'unclear', words: 'um the north', line })
    // With no line from the server, the plan's own words.
    expect(said(null)).toEqual({ kind: 'unclear', words: 'um the north', line })
    expect(go).not.toHaveBeenCalled()
    expect(openedCard()).toBeNull()
  })

  it('opens the page an open command names, and the bar closes', () => {
    const go = vi.fn<(to: string) => void>()
    const after = handOver(
      {
        kind: 'command',
        command: command({ action: 'open', open: { page: 'call_logs', company_key: null } }),
        words: 'open call logs',
        source: 'mic',
      },
      { go },
    )
    expect(go).toHaveBeenCalledWith('/assistant/call-logs')
    expect(after).toEqual({ kind: 'close' })
  })

  it('opens the review card for a call, a task or an email, sends nothing, and the bar closes', () => {
    for (const action of ['log_call', 'task', 'email'] as const) {
      const go = vi.fn<(to: string) => void>()
      const shown = command({ action, unsure: 'Two people named Jo work there.' })
      const after = handOver(
        { kind: 'command', command: shown, words: 'log a call with Jo', source: 'mic' },
        { go },
      )
      expect(go).not.toHaveBeenCalled()
      expect(after).toEqual({ kind: 'close' })
      expect(openedCard()).toMatchObject({
        kind: 'command',
        command: shown,
        words: 'log a call with Jo',
        source: 'mic',
      })
      closeCard()
    }
  })

  it('a pre-read whose meeting has one opens its page, with no card (choice 24)', () => {
    const go = vi.fn<(to: string) => void>()
    const after = handOver(
      {
        kind: 'command',
        command: command({ action: 'pre_read', meeting: meetingOf({ form: FORM }) }),
        words: 'pre-read for the Sample Logistics meeting',
        source: 'mic',
      },
      { go },
    )
    expect(after).toEqual({ kind: 'close' })
    expect(go).toHaveBeenCalledWith(`/assistant/meetings/${FORM.id}`)
    expect(openedCard()).toBeNull()
  })

  it('a pre-read whose meeting has none starts it, then opens it while the bar is open', async () => {
    const go = vi.fn<(to: string) => void>()
    const start = vi.fn(() => Promise.resolve({ id: 'form-new' }))
    openVoiceBar()
    const after = handOver(
      {
        kind: 'command',
        command: command({ action: 'pre_read', meeting: meetingOf({ form: null }) }),
        words: 'make a pre-meeting form for Sample Logistics',
        source: 'typed',
      },
      { go, start },
    )
    expect(go).not.toHaveBeenCalled()
    expect(await after).toEqual({ kind: 'close' })
    expect(start).toHaveBeenCalledWith('meeting-1')
    expect(go).toHaveBeenCalledWith('/assistant/meetings/form-new')
    closeVoiceBar()
  })

  it('a pre-read that failed to start says why in the bar, and opens nothing', async () => {
    const go = vi.fn<(to: string) => void>()
    const start = vi.fn(() =>
      Promise.reject(
        new ApiProblem({
          status: 409,
          code: 'meeting_forms_off',
          title: 'Pre-meeting forms are off',
          detail: 'Ask an admin to turn them on.',
        }),
      ),
    )
    const after = await handOver(
      {
        kind: 'command',
        command: command({ action: 'pre_read', meeting: meetingOf({ form: null }) }),
        words: 'make a pre-meeting form',
        source: 'typed',
      },
      { go, start },
    )
    expect(go).not.toHaveBeenCalled()
    expect(after).toEqual({
      kind: 'show',
      line: 'Pre-meeting forms are off',
      unsure: 'Ask an admin to turn them on.',
      again: false,
    })
  })

  it('a pre-read with two meetings, or none ahead, opens the card to ask', () => {
    const after = handOver(
      {
        kind: 'command',
        command: command({
          action: 'pre_read',
          meeting: { found: null, choices: [], from_page: false, heard: '' },
        }),
        words: 'pre-read for Sample Logistics',
        source: 'mic',
      },
      { go: vi.fn() },
    )
    expect(after).toEqual({ kind: 'close' })
    expect(openedCard()).toMatchObject({ kind: 'command' })
    closeCard()
  })

  it('offers Try again when the words were not one of the actions', () => {
    const after = handOver(
      {
        kind: 'command',
        command: command({
          action: 'unknown',
          read_back:
            'The Assistant can make a pre-read, log a call, add a task, email teammates or open a page. Try saying it as one of those.',
        }),
        words: 'what is the weather',
        source: 'mic',
      },
      { go: vi.fn() },
    )
    expect(after).toMatchObject({ kind: 'show', again: true })
  })

  it('says the Assistant can’t read commands yet, with the AI off (T3-5 opens Log call)', () => {
    expect(
      handOver({ kind: 'dictation', words: 'Spoke to Jo', source: 'mic' }, { go: vi.fn() }),
    ).toEqual({
      kind: 'show',
      line: "The Assistant can't read commands yet.",
      unsure: null,
      again: false,
    })
  })
})

describe('pageFor', () => {
  it.each<[AssistantOpen, string]>([
    [{ page: 'home', company_key: null }, '/'],
    [{ page: 'today', company_key: null }, '/assistant'],
    [{ page: 'meetings', company_key: null }, '/assistant/meetings'],
    [{ page: 'call_logs', company_key: null }, '/assistant/call-logs'],
    [{ page: 'companies', company_key: null }, '/companies'],
    [{ page: 'company', company_key: '201' }, '/companies/201'],
    [{ page: 'company', company_key: 'lead:7' }, '/companies/lead%3A7'],
    [{ page: 'company', company_key: null }, '/companies'],
    [{ page: 'lead_finder', company_key: null }, '/start'],
  ])('%o opens %s', (open, to) => {
    expect(pageFor(open)).toBe(to)
  })
})

describe('onPageOf', () => {
  it.each<[string, string, ReturnType<typeof onPageOf>]>([
    ['/companies/201', '', { company_key: '201' }],
    ['/companies/lead%3A7/', '', { company_key: 'lead:7' }],
    ['/companies', '?company=201&sort=name', { company_key: '201' }],
    ['/companies', '?sort=name', null],
    [
      '/assistant/meetings/0f3c9a2e-1111-2222-3333-444444444444',
      '',
      { form_id: '0f3c9a2e-1111-2222-3333-444444444444' },
    ],
    ['/assistant/meetings', '', null],
    ['/assistant', '', null],
    ['/', '', null],
    // An old address of Meetings or Call logs on its way to the new one.
    ['/companies/meetings', '', null],
    ['/companies/call-logs', '?tab=history', null],
    ['/companies/%E0%A4%A', '', null],
  ])('%s%s shows %o', (pathname, search, shown) => {
    expect(onPageOf(pathname, search)).toEqual(shown)
  })
})

describe('the addresses the late voice files keep for themselves', () => {
  it("the Lead Finder's first page is its module's first page", () => {
    expect(LEAD_FINDER_START).toBe(LEAD_FINDER.pages[0]?.to)
  })

  it('the old addresses under Companies are the ones that send you on', () => {
    expect(MOVED_UNDER_COMPANIES.map((part) => `/companies/${part}`)).toEqual(OLD_PATHS)
  })
})
