/**
 * The seam the voice bar hands its answer to (PLAN-V22 T3-1), and what is on screen when the rep
 * speaks. Until the review card (T3-3): a page opens, and any other answer shows its read-back.
 * Made-up names only.
 */
import { describe, expect, it, vi } from 'vitest'
import type { AssistantCommand, AssistantOpen } from '@/api/types'
import { LEAD_FINDER } from '@/apps/lead-finder/module'
import { OLD_PATHS } from '../old-addresses'
import { handOver, LEAD_FINDER_START, pageFor } from './hand-over'
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

describe('handOver', () => {
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

  it('shows the read-back of any other action, and sends nothing (until the review card)', () => {
    const go = vi.fn<(to: string) => void>()
    const after = handOver(
      {
        kind: 'command',
        command: command({ unsure: 'Two people named Jo work there.' }),
        words: 'log a call with Jo',
        source: 'mic',
      },
      { go },
    )
    expect(go).not.toHaveBeenCalled()
    expect(after).toEqual({
      kind: 'show',
      line: 'Log a call with Jo Sample at Sample Logistics. Follow-up task on Fri 21 Nov.',
      unsure: 'Two people named Jo work there.',
      again: false,
    })
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
