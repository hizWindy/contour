import { describe, expect, it } from 'vitest'
import type { LeadRow, Run } from '@/api/types'
import { goalProgress, groupRunLeads, isExcluded, leadSources } from './goal-data'

function run(changes: Partial<Run> = {}): Run {
  return {
    status: 'done',
    goal_leads: 20,
    good_leads: 12,
    stop_reason: null,
    leads_by_source: { web: 0, property_daily: 0, arealytics: 0 },
    ...changes,
  } as Run
}

function lead(id: string, tier: LeadRow['tier'], score: number, changes = {}): LeadRow {
  return { id, company: id, tier, score, excluded: null, ...changes } as LeadRow
}

describe('a run against its goal (PLAN-V16 T3-3)', () => {
  it('has no goal state for a run without one', () => {
    expect(goalProgress(run({ goal_leads: null }), 5, true)).toBeNull()
  })

  it('counts while running, and caps the bar at 100', () => {
    expect(goalProgress(run({ status: 'running' }), 12, false)).toEqual({
      state: 'running',
      goal: 20,
      found: 12,
      share: 60,
      why: null,
    })
    expect(goalProgress(run(), 25, true)?.share).toBe(100)
  })

  it('met its goal', () => {
    expect(goalProgress(run(), 20, true)?.state).toBe('met')
  })

  it('ended short: the reason without the "Found 12 of 20 leads." the page shows above it', () => {
    const short = goalProgress(
      run({ stop_reason: 'Found 12 of 20 leads. It stopped at the run limit (US$20).' }),
      12,
      true,
    )
    expect(short?.state).toBe('short')
    expect(short?.why).toBe('It stopped at the run limit (US$20).')
    // Today's cap words have no full stop.
    expect(
      goalProgress(run({ stop_reason: 'The run reached its limit of US$20.00' }), 12, true)?.why,
    ).toBe('The run reached its limit of US$20.00.')
  })

  it('ended short with no reason: plain words by how it ended', () => {
    const why = (status: Run['status']) => goalProgress(run({ status }), 3, true)?.why
    expect(why('cancelled')).toBe('It was stopped before it found them all.')
    expect(why('interrupted')).toBe('It was interrupted. Resume it to look for the rest.')
    expect(why('failed')).toBe('It failed before it found them all.')
    expect(why('done')).toBe('It ended before it found them all.')
  })
})

describe('where the leads came from', () => {
  it('lists the three sources in order, or nothing when there are no leads', () => {
    expect(leadSources(run())).toEqual([])
    expect(
      leadSources(run({ leads_by_source: { web: 4, property_daily: 0, arealytics: 2 } })),
    ).toEqual([
      { id: 'web', label: 'The web', count: 4 },
      { id: 'property_daily', label: 'Property Daily', count: 0 },
      { id: 'arealytics', label: 'Arealytics', count: 2 },
    ])
  })
})

describe("a run's leads, as Levi lists them", () => {
  const exclusion = {
    reason_id: 'government',
    label: 'A government department',
    evidence: 'A state agency.',
    url: null,
    overridden_by: null,
    overridden_at: null,
  }

  it('ranks A and B by tier then score, then the excluded, the watch list and those under 40', () => {
    const groups = groupRunLeads([
      lead('b-61', 'B', 61),
      lead('c-47', 'C', 47),
      lead('a-80', 'A', 80),
      lead('b-70', 'B', 70),
      lead('x', 'discard', 0, { excluded: exclusion }),
      lead('d-20', 'discard', 20),
      lead('a-90', 'A', 90),
    ])
    expect(groups.ranked.map((item) => item.id)).toEqual(['a-90', 'a-80', 'b-70', 'b-61'])
    expect(groups.excluded.map((item) => item.id)).toEqual(['x'])
    expect(groups.watch.map((item) => item.id)).toEqual(['c-47'])
    // Listed, not just counted (PLAN-V20): every company the run researched is shown
    expect(groups.discarded.map((item) => item.id)).toEqual(['d-20'])
  })

  it('lists a lead judged before the tiers, with no tier, by what its result stands for', () => {
    const groups = groupRunLeads([
      lead('old-drop', null, 5, { result: 'drop' }),
      lead('new-b', 'B', 60, { result: 'pass' }),
      lead('old-pass', null, 76, { result: 'pass' }),
      lead('old-watch', null, 30, { result: 'watch' }),
      lead('old-director', null, 55, { result: 'director_review' }),
    ])
    // A Pass or a Director review is ranked with Tier A and B, a Watch is Tier C, a Drop is under 40
    expect(groups.ranked.map((item) => item.id)).toEqual(['old-pass', 'new-b', 'old-director'])
    expect(groups.watch.map((item) => item.id)).toEqual(['old-watch'])
    expect(groups.discarded.map((item) => item.id)).toEqual(['old-drop'])
  })

  it('treats an overridden exclusion like any lead', () => {
    const overridden = lead('o', 'A', 78, {
      excluded: { ...exclusion, overridden_by: 'Al-khair', overridden_at: '2026-11-15T01:00:00Z' },
    })
    expect(isExcluded(overridden)).toBe(false)
    expect(groupRunLeads([overridden]).ranked).toHaveLength(1)
  })
})
