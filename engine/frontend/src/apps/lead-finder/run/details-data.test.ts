import { describe, expect, it } from 'vitest'
import type { Run, SearchOut } from '@/api/types'
import { costSplit, logIsPartial, setupLines, timingLines } from './details-data'

const COUNTS = {
  slices: 0,
  slices_done: 0,
  slices_failed: 0,
  candidates: 0,
  unique: 0,
  chosen: 0,
  researched: 0,
  skipped: 0,
  failed: 0,
  by_result: {},
  resumes: 0,
}

function run(changes: Partial<Run> = {}): Run {
  return {
    id: 'e76653d8-e52f-4ca1-880e-62b5af1e2c8c',
    app: 'lead_finder',
    mode: 'discovery',
    status: 'done',
    params: {},
    caps: {
      run_cap_usd: '20.00',
      max_companies: 20,
      company_cap_usd: '2.50',
      discovery_cap_usd: '8.00',
    },
    rules_version: 'r1',
    prompt_versions: 'p1',
    cost_usd: '5.178920',
    web_searches: 204,
    claude_requests: 67,
    counts: COUNTS,
    stop_reason: null,
    error: null,
    error_id: null,
    cancel_requested_at: null,
    created_at: '2026-10-27T03:40:00Z',
    started_at: '2026-10-27T03:40:10Z',
    finished_at: '2026-10-27T03:53:38Z',
    ...changes,
  }
}

const TRIGGERS = new Map([
  ['lease_ending', 'Lease ending in 1 to 3 years'],
  ['fast_growth', 'Fast growth'],
])

function value(lines: { label: string; value: string }[], label: string): string | undefined {
  return lines.find((line) => line.label === label)?.value
}

function search(step: string, cost: string): SearchOut {
  return { step, cost_usd: cost } as SearchOut
}

describe('what a run was asked to do', () => {
  it('names the cities with their area, the signs by their label, and the limits', () => {
    const lines = setupLines(
      run({
        params: {
          cities: ['Melbourne', 'Perth'],
          area: { Melbourne: 'cbd' },
          triggers: ['lease_ending', 'fast_growth', 'new_ceo'],
          since_days: 30,
        },
      }),
      { triggers: TRIGGERS },
    )
    expect(value(lines, 'Kind')).toBe('Find new leads')
    expect(value(lines, 'Cities')).toBe('Melbourne (CBD), Perth')
    // A sign this build has no label for shows its id rather than disappearing.
    expect(value(lines, 'Signs')).toBe('Lease ending in 1 to 3 years; Fast growth; new_ceo')
    expect(value(lines, 'How far back')).toBe('Last 30 days')
    expect(value(lines, 'Limits')).toBe(
      'run US$20.00, each company US$2.50, finding companies US$8.00, up to 20 companies',
    )
  })

  it('lists the companies of a typed run, and says when it was a re-check', () => {
    const lines = setupLines(
      run({
        mode: 'company',
        params: {
          companies: [{ name: 'Acme Software', city: 'Melbourne' }, { name: 'KBR' }],
          recheck: true,
        },
      }),
      { triggers: TRIGGERS },
    )
    expect(value(lines, 'Kind')).toBe('Companies by name')
    expect(value(lines, 'Companies asked for')).toBe('Acme Software, KBR')
    expect(value(lines, 'Re-check')).toMatch(/^Yes/)
    expect(value(lines, 'Limits')).not.toContain('finding companies')
  })

  it('describes the watchlist options', () => {
    const lines = setupLines(
      run({ mode: 'watchlist', params: { watchlist: { include_director: true, limit: 5 } } }),
      { triggers: TRIGGERS },
    )
    expect(value(lines, 'Watchlist')).toBe(
      'likely office companies only, includes Director review, at most 5 companies',
    )
  })

  it('skips what it cannot read instead of breaking', () => {
    const lines = setupLines(
      run({ params: { cities: 'Melbourne', triggers: [3], since_days: '30' } }),
      {
        triggers: TRIGGERS,
      },
    )
    expect(lines.map((line) => line.label)).toEqual(['Kind', 'Limits'])
  })
})

describe('when a run ran', () => {
  it('gives the start, the end and how long it took', () => {
    const lines = timingLines(run())
    expect(value(lines, 'Started')).toBe('27 Oct 2026, 2:40 pm')
    expect(value(lines, 'Finished')).toBe('27 Oct 2026, 2:53 pm')
    expect(value(lines, 'Took')).toBe('13 min 28 s')
  })

  it('counts a running run up to now, and says how often it was resumed', () => {
    const lines = timingLines(
      run({ finished_at: null, counts: { ...COUNTS, resumes: 2 } }),
      new Date('2026-10-27T03:42:10Z'),
    )
    expect(value(lines, 'Running for')).toBe('2 min')
    expect(value(lines, 'Finished')).toBeUndefined()
    expect(value(lines, 'Resumed')).toBe('2 times')
  })
})

describe('where the money went', () => {
  it('splits finding companies from researching them, with the average per company', () => {
    const split = costSplit(
      [
        search('discover:lease_ending:Melbourne', '0.14'),
        search('discover:fast_growth:Perth', '0.11'),
        search('search:property', '0.20'),
        search('search:people', '0.10'),
        search('extract', '0.05'),
      ],
      2,
    )
    expect(split).toEqual({
      finding: '0.25',
      findingRequests: 2,
      researching: '0.35',
      researchingRequests: 3,
      perCompany: '0.175',
    })
  })

  it('gives no average before any company is researched', () => {
    expect(costSplit([search('discover:x', '0.1')], 0).perCompany).toBeNull()
  })

  it('says when the log page holds fewer requests than the run made', () => {
    expect(logIsPartial([search('extract', '1')], 250)).toBe(true)
    expect(logIsPartial([search('extract', '1')], 1)).toBe(false)
  })
})
