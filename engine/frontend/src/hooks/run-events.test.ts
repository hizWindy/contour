import { describe, expect, it } from 'vitest'
import type { RunEvent } from '@/api/types'
import {
  describeEvent,
  EMPTY_COUNTS,
  foldRunEvents,
  initialRunEventsState,
  parseRunEvent,
  RUN_EVENT_TYPES,
  runEventsReducer,
} from './run-events'

/** One event as the server sends it. The tests choose the type, so the payload is cast. */
function event(seq: number, type: RunEvent['type'], data: Record<string, unknown> = {}): RunEvent {
  return {
    seq,
    type,
    created_at: `2026-10-26T04:00:${String(seq % 60).padStart(2, '0')}Z`,
    data,
  } as unknown as RunEvent
}

const COUNTS = {
  slices: 4,
  slices_done: 2,
  slices_failed: 0,
  candidates: 9,
  unique: 7,
  chosen: 5,
  researched: 1,
  skipped: 2,
  failed: 0,
  by_result: { pass: 1 },
  resumes: 0,
}

const CAPS = {
  run_cap_usd: '20.00',
  max_companies: 20,
  company_cap_usd: '2.50',
  discovery_cap_usd: '8.00',
}

function fold(events: RunEvent[]) {
  return foldRunEvents(events)
}

describe('parseRunEvent', () => {
  it('reads a good message', () => {
    const text = JSON.stringify(event(3, 'company_started', { name: 'Acme' }))

    expect(parseRunEvent(text)).toMatchObject({ seq: 3, type: 'company_started' })
  })

  it('reads every event type the contract has', () => {
    for (const type of RUN_EVENT_TYPES) {
      expect(parseRunEvent(JSON.stringify(event(1, type))), type).not.toBeNull()
    }
    expect(RUN_EVENT_TYPES).toHaveLength(15)
  })

  it.each([
    ['not JSON', 'hello'],
    ['an array', '[1,2]'],
    ['null', 'null'],
    ['no seq', JSON.stringify({ type: 'progress', created_at: 'x', data: {} })],
    ['seq 0', JSON.stringify({ seq: 0, type: 'progress', created_at: 'x', data: {} })],
    ['a fractional seq', JSON.stringify({ seq: 1.5, type: 'progress', created_at: 'x', data: {} })],
    ['a text seq', JSON.stringify({ seq: '1', type: 'progress', created_at: 'x', data: {} })],
    ['an unknown type', JSON.stringify({ seq: 1, type: 'brand_new', created_at: 'x', data: {} })],
    ['no data', JSON.stringify({ seq: 1, type: 'progress', created_at: 'x' })],
    ['no created_at', JSON.stringify({ seq: 1, type: 'progress', data: {} })],
  ])('refuses %s', (_name, text) => {
    expect(parseRunEvent(text)).toBeNull()
  })
})

describe('runEventsReducer', () => {
  it('starts empty', () => {
    expect(initialRunEventsState).toMatchObject({
      lastSeq: 0,
      status: null,
      costUsd: '0',
      finished: false,
      feed: [],
    })
    expect(initialRunEventsState.counts).toEqual(EMPTY_COUNTS)
  })

  it('follows a whole discovery run', () => {
    const state = fold([
      event(1, 'run_started', { mode: 'discovery', caps: CAPS, rules_version: 'r-12' }),
      event(2, 'plan_ready', { slices: 4, companies: 0, labels: ['Melbourne: lease'] }),
      event(3, 'slice_started', { slice_id: 's1', label: 'Melbourne: lease' }),
      event(4, 'slice_done', {
        slice_id: 's1',
        label: 'Melbourne: lease',
        found: 5,
        cost_usd: '0.31',
        searches: 3,
      }),
      event(5, 'merged', { candidates: 9, unique: 7 }),
      event(6, 'company_skipped', { name: 'Old Co', reason: 'open deal in HubSpot' }),
      event(7, 'company_started', { name: 'Acme' }),
      event(8, 'company_done', {
        name: 'Acme',
        lead_id: 'l1',
        result: 'pass',
        score: 82,
        cost_usd: '0.90',
        hubspot_status: 'new',
      }),
      event(9, 'progress', {
        cost_usd: '1.21',
        web_searches: 6,
        claude_requests: 5,
        counts: COUNTS,
      }),
      event(10, 'run_finished', {
        status: 'done',
        stop_reason: null,
        cost_usd: '1.25',
        counts: { ...COUNTS, researched: 2 },
      }),
    ])

    expect(state.lastSeq).toBe(10)
    expect(state.status).toBe('done')
    expect(state.finished).toBe(true)
    expect(state.mode).toBe('discovery')
    expect(state.rulesVersion).toBe('r-12')
    expect(state.caps).toEqual(CAPS)
    expect(state.plan).toEqual({ slices: 4, companies: 0, labels: ['Melbourne: lease'] })
    expect(state.slices).toEqual([
      {
        id: 's1',
        label: 'Melbourne: lease',
        status: 'done',
        found: 5,
        searches: 3,
        cost_usd: '0.31',
        reason: null,
      },
    ])
    expect(state.inFlight).toEqual([])
    expect(state.costUsd).toBe('1.25')
    expect(state.webSearches).toBe(6)
    expect(state.claudeRequests).toBe(5)
    expect(state.counts.researched).toBe(2)
    expect(state.counts.by_result).toEqual({ pass: 1 })
  })

  it('ignores a repeat and anything at or below the last seq, and returns the same state', () => {
    const first = runEventsReducer(initialRunEventsState, {
      type: 'event',
      event: event(5, 'company_started', { name: 'A' }),
    })

    const repeat = runEventsReducer(first, {
      type: 'event',
      event: event(5, 'company_started', { name: 'A' }),
    })
    const older = runEventsReducer(first, {
      type: 'event',
      event: event(3, 'company_started', { name: 'B' }),
    })

    expect(repeat).toBe(first)
    expect(older).toBe(first)
    expect(first.feed).toHaveLength(1)
  })

  it('does not count a replayed event twice', () => {
    const events = [
      event(1, 'run_started', { mode: 'discovery', caps: CAPS, rules_version: 'r' }),
      event(2, 'company_started', { name: 'A' }),
      event(3, 'company_done', {
        name: 'A',
        lead_id: 'l',
        result: 'watch',
        score: 40,
        cost_usd: '0.5',
        hubspot_status: 'new',
      }),
    ]
    const once = fold(events)
    const twice = fold([...events, ...events])

    expect(twice).toEqual(once)
    expect(twice.feed).toHaveLength(3)
  })

  it('takes the counts and the cost from progress, and never guesses between two', () => {
    const state = fold([
      event(1, 'company_done', {
        name: 'A',
        lead_id: 'l',
        result: 'pass',
        score: 90,
        cost_usd: '0.5',
        hubspot_status: 'new',
      }),
    ])

    expect(state.counts.researched).toBe(0)
    expect(state.costUsd).toBe('0')

    const later = runEventsReducer(state, {
      type: 'event',
      event: event(2, 'progress', {
        cost_usd: '0.50',
        web_searches: 2,
        claude_requests: 2,
        counts: COUNTS,
      }),
    })

    expect(later.counts).toEqual(COUNTS)
    expect(later.costUsd).toBe('0.50')
  })

  it('keeps progress out of the feed, because it is a counter and not news', () => {
    const state = fold([
      event(1, 'run_started', { mode: 'discovery', caps: CAPS, rules_version: 'r' }),
      event(2, 'progress', { cost_usd: '0', web_searches: 0, claude_requests: 0, counts: COUNTS }),
    ])

    expect(state.feed.map((item) => item.type)).toEqual(['run_started'])
    expect(state.lastSeq).toBe(2)
  })

  it('sets the plan and the merge counts at once', () => {
    const state = fold([
      event(1, 'plan_ready', { slices: 12, companies: 0, labels: ['a', 'b'] }),
      event(2, 'merged', { candidates: 30, unique: 18 }),
    ])

    expect(state.counts.slices).toBe(12)
    expect(state.counts.candidates).toBe(30)
    expect(state.counts.unique).toBe(18)
  })

  it('tracks the companies being researched right now', () => {
    const started = fold([
      event(1, 'company_started', { name: 'A' }),
      event(2, 'company_started', { name: 'B' }),
    ])

    expect(started.inFlight).toEqual(['A', 'B'])

    const done = runEventsReducer(started, {
      type: 'event',
      event: event(3, 'company_done', {
        name: 'A',
        lead_id: 'l',
        result: 'drop',
        score: 10,
        cost_usd: '0.1',
        hubspot_status: 'new',
      }),
    })
    const failed = runEventsReducer(done, {
      type: 'event',
      event: event(4, 'company_failed', { name: 'B', reason: 'timed out' }),
    })

    expect(done.inFlight).toEqual(['B'])
    expect(failed.inFlight).toEqual([])
  })

  it('updates a slice in place as it moves from running to done or failed', () => {
    const state = fold([
      event(1, 'slice_started', { slice_id: 's1', label: 'Perth: lease' }),
      event(2, 'slice_started', { slice_id: 's2', label: 'Adelaide: lease' }),
      event(3, 'slice_failed', { slice_id: 's2', label: 'Adelaide: lease', reason: 'no answer' }),
      event(4, 'slice_done', {
        slice_id: 's1',
        label: 'Perth: lease',
        found: 2,
        cost_usd: '0.2',
        searches: 2,
      }),
    ])

    expect(state.slices.map((slice) => [slice.id, slice.status])).toEqual([
      ['s1', 'done'],
      ['s2', 'failed'],
    ])
    expect(state.slices[1]?.reason).toBe('no answer')
  })

  it('records a limit that was reached, and the problems', () => {
    const state = fold([
      event(1, 'problem', { message: 'A source did not load.' }),
      event(2, 'cap_reached', { kind: 'run_cost', detail: 'The run reached US$20.00.' }),
    ])

    expect(state.problems).toEqual(['A source did not load.'])
    expect(state.capReached).toEqual({ kind: 'run_cost', detail: 'The run reached US$20.00.' })
  })

  it('ends with the status, reason, cost and counts of run_finished', () => {
    const state = fold([
      event(1, 'run_started', { mode: 'company', caps: CAPS, rules_version: 'r' }),
      event(2, 'company_started', { name: 'A' }),
      event(3, 'run_finished', {
        status: 'cancelled',
        stop_reason: 'Stopped by a person',
        cost_usd: '0.73',
        counts: COUNTS,
      }),
    ])

    expect(state.status).toBe('cancelled')
    expect(state.stopReason).toBe('Stopped by a person')
    expect(state.costUsd).toBe('0.73')
    expect(state.finished).toBe(true)
    expect(state.inFlight).toEqual([])
  })

  it('a run_finished met in a replay is history: a later run_resumed makes the run live again', () => {
    const state = fold([
      event(1, 'run_started', { mode: 'discovery', caps: CAPS, rules_version: 'r' }),
      event(2, 'run_finished', {
        status: 'interrupted',
        stop_reason: 'The backend stopped while this run was going',
        cost_usd: '1',
        counts: COUNTS,
      }),
      event(3, 'cap_reached', { kind: 'daily', detail: 'x' }),
    ])
    expect(state.finished).toBe(false)

    const resumed = fold([
      event(1, 'run_started', { mode: 'discovery', caps: CAPS, rules_version: 'r' }),
      event(2, 'run_finished', {
        status: 'interrupted',
        stop_reason: 'stopped',
        cost_usd: '1',
        counts: COUNTS,
      }),
      event(3, 'run_resumed', { from_status: 'interrupted' }),
    ])

    expect(resumed.status).toBe('running')
    expect(resumed.finished).toBe(false)
    expect(resumed.stopReason).toBeNull()
    expect(resumed.costUsd).toBe('1')
  })

  it('does not crash on a payload with missing or odd fields', () => {
    const state = fold([
      event(1, 'progress', { cost_usd: 5, counts: 'many' }),
      event(2, 'slice_done', {}),
      event(3, 'company_done', { name: 7 }),
      event(4, 'run_finished', { status: 'sideways', counts: null }),
      event(5, 'plan_ready', { labels: 'x' }),
    ])

    expect(state.lastSeq).toBe(5)
    expect(state.costUsd).toBe('0')
    expect(state.counts.slices).toBe(0)
    expect(state.status).toBeNull()
  })

  it('keeps at most 1000 lines in the feed, newest last', () => {
    const events = Array.from({ length: 1050 }, (_, index) =>
      event(index + 1, 'company_started', { name: `Company ${index + 1}` }),
    )

    const state = fold(events)

    expect(state.feed).toHaveLength(1000)
    expect(state.feed[0]?.seq).toBe(51)
    expect(state.feed.at(-1)?.seq).toBe(1050)
    expect(state.lastSeq).toBe(1050)
  })

  it('stores text from the backend as it is, without reading it as markup', () => {
    const name = '<img src=x onerror=alert(1)>'
    const state = fold([event(1, 'company_started', { name })])

    expect(state.inFlight).toEqual([name])
    expect(state.feed[0]?.message).toBe(`Researching ${name}`)
  })

  it('resets', () => {
    const state = fold([event(1, 'company_started', { name: 'A' })])

    expect(runEventsReducer(state, { type: 'reset' })).toBe(initialRunEventsState)
  })
})

describe('describeEvent', () => {
  it('writes one plain line for each kind of event', () => {
    const lines = Object.fromEntries(
      [
        event(1, 'run_started', { mode: 'discovery', caps: CAPS, rules_version: 'r' }),
        event(2, 'run_resumed', { from_status: 'interrupted' }),
        event(3, 'plan_ready', { slices: 12, companies: 0, labels: [] }),
        event(4, 'slice_started', { slice_id: 's', label: 'Melbourne: lease' }),
        event(5, 'slice_done', {
          slice_id: 's',
          label: 'Melbourne: lease',
          found: 4,
          cost_usd: '0.3',
          searches: 2,
        }),
        event(6, 'slice_failed', { slice_id: 's', label: 'Perth: lease', reason: 'no answer' }),
        event(7, 'merged', { candidates: 9, unique: 7 }),
        event(8, 'company_skipped', { name: 'Old Co', reason: 'open deal' }),
        event(9, 'company_started', { name: 'Acme' }),
        event(10, 'company_done', {
          name: 'Acme',
          lead_id: 'l',
          result: 'director_review',
          score: 71,
          cost_usd: '0.9',
          hubspot_status: 'new',
        }),
        event(11, 'company_failed', { name: 'Beta', reason: 'timed out' }),
        event(12, 'problem', { message: 'A source did not load.' }),
        event(13, 'cap_reached', { kind: 'max_companies', detail: 'The run limit is 20.' }),
        event(14, 'run_finished', {
          status: 'done',
          stop_reason: null,
          cost_usd: '1',
          counts: COUNTS,
        }),
      ].map((item) => [item.type, describeEvent(item)]),
    )

    expect(lines.run_started).toEqual({ tone: 'info', message: 'The run started.' })
    expect(lines.plan_ready?.message).toBe('12 searches planned.')
    expect(lines.slice_started?.message).toBe('Searching: Melbourne: lease')
    expect(lines.slice_done).toEqual({
      tone: 'success',
      message: 'Searched Melbourne: lease: 4 companies found, US$0.30.',
    })
    expect(lines.slice_failed?.tone).toBe('warning')
    expect(lines.merged?.message).toBe('9 finds merged into 7 companies.')
    expect(lines.company_skipped?.message).toBe('Skipped Old Co: open deal')
    expect(lines.company_started?.message).toBe('Researching Acme')
    expect(lines.company_done).toEqual({
      tone: 'success',
      message: 'Acme: Director review, score 71, US$0.90.',
    })
    expect(lines.company_failed?.message).toBe('Could not research Beta: timed out')
    expect(lines.problem?.message).toBe('A source did not load.')
    expect(lines.cap_reached?.message).toBe('A limit was reached: The run limit is 20.')
    expect(lines.run_finished).toEqual({ tone: 'success', message: 'The run finished.' })
  })

  it('says how many companies one skip line stands for', () => {
    const line = describeEvent(
      event(1, 'company_skipped', {
        name: '',
        reason: "over the run's company limit",
        count: 27,
      }),
    )

    expect(line.message).toBe("Skipped 27 companies: over the run's company limit")
  })

  it('gives a failed run the error tone and a stopped one a warning, with the reason', () => {
    expect(
      describeEvent(
        event(1, 'run_finished', { status: 'failed', stop_reason: 'Claude is unavailable.' }),
      ),
    ).toEqual({ tone: 'error', message: 'The run failed. Claude is unavailable.' })
    expect(
      describeEvent(
        event(1, 'run_finished', { status: 'cancelled', stop_reason: 'Stopped by a person' }),
      ),
    ).toEqual({ tone: 'warning', message: 'The run was stopped. Stopped by a person' })
  })

  it('names a result it does not know in readable words', () => {
    const line = describeEvent(
      event(1, 'company_done', {
        name: 'A',
        result: 'maybe_later',
        score: 5,
        cost_usd: '0.1',
      }),
    )

    expect(line.message).toBe('A: Maybe later, score 5, US$0.10.')
  })

  it('uses no em dash', () => {
    for (const type of RUN_EVENT_TYPES) {
      expect(describeEvent(event(1, type)).message).not.toContain('—')
    }
  })
})
