/**
 * A run's goal of good leads (PLAN-V16 T3-3) and how its leads split when it ends. Plain
 * functions, tested on their own (goal-data.test.ts).
 *
 * Four states: running, met its goal, ended short, and no goal (a run started without one, or any
 * run before PLAN-V16). A good lead is Tier A or B, which is a Pass or a Director review (the
 * plan's choice 1), so the live count comes from the results so far and the backend's
 * `good_leads` takes over once the run has ended.
 */
import type { LeadRow, Run, RunSourceId, Tier } from '@/api/types'
import { RUN_SOURCE_LABELS, RUN_SOURCE_ORDER } from '@/lib/labels'

export type GoalState = 'running' | 'met' | 'short'

export interface GoalProgress {
  state: GoalState
  goal: number
  found: number
  /** 0 to 100, for the bar. */
  share: number
  /** Why a run ended short, in one sentence. Empty in the other states. */
  why: string | null
}

/** "Found 12 of 20 leads." at the start of the backend's reason: the page shows that part above. */
const FOUND_PART = /^found \d+ of \d+ (?:good )?leads?\.\s*/i

function asSentence(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`
}

function whyShort(run: Run): string {
  const reason = (run.stop_reason ?? '').replace(FOUND_PART, '').trim()
  if (reason !== '') {
    return asSentence(reason)
  }
  if (run.status === 'cancelled') {
    return 'It was stopped before it found them all.'
  }
  if (run.status === 'interrupted') {
    return 'It was interrupted. Resume it to look for the rest.'
  }
  if (run.status === 'failed') {
    return 'It failed before it found them all.'
  }
  return 'It ended before it found them all.'
}

/** Where the run stands against its goal, or null when it has none. */
export function goalProgress(run: Run, found: number, ended: boolean): GoalProgress | null {
  const goal = run.goal_leads
  if (goal === null || goal <= 0) {
    return null
  }
  const share = Math.min(100, Math.round((found / goal) * 100))
  if (!ended) {
    return { state: 'running', goal, found, share, why: null }
  }
  if (found >= goal) {
    return { state: 'met', goal, found, share, why: null }
  }
  return { state: 'short', goal, found, share, why: whyShort(run) }
}

export interface SourceCount {
  id: RunSourceId
  label: string
  count: number
}

/** Where the run's leads came from, in the fixed order. Empty when it has none yet. */
export function leadSources(run: Run): SourceCount[] {
  const counts = RUN_SOURCE_ORDER.map((id) => ({
    id,
    label: RUN_SOURCE_LABELS[id],
    count: run.leads_by_source[id],
  }))
  return counts.some((item) => item.count > 0) ? counts : []
}

const TIER_RANK: Record<Tier, number> = { A: 0, B: 1, C: 2, discard: 3 }

/**
 * The tier a lead is listed under: its own, or for a lead judged before the tiers existed the one
 * its result stands for (Levi's choice 1: a Pass or a Director review is Tier A or B, a Watch is
 * Tier C, a Drop is a Discard). So an old run lists its good leads as ranked, not as under 40.
 */
export function listedTier(lead: LeadRow): Tier {
  if (lead.tier) {
    return lead.tier
  }
  if (lead.result === 'pass' || lead.result === 'director_review') {
    return 'B'
  }
  return lead.result === 'watch' ? 'C' : 'discard'
}

/** Best first: by the tier a lead is listed under, then by score. */
export function byTierThenScore(a: LeadRow, b: LeadRow): number {
  return TIER_RANK[listedTier(a)] - TIER_RANK[listedTier(b)] || b.score - a.score
}

/** An exclusion a person overrode no longer leaves the company out. */
export function isExcluded(lead: LeadRow): boolean {
  return lead.excluded != null && lead.excluded.overridden_by === null
}

export interface RunLeadGroups {
  /** Tier A and B, best first: the run's ranked table. */
  ranked: LeadRow[]
  /** Left out by an exclusion, each with its reason (Levi's section 3). */
  excluded: LeadRow[]
  /** Tier C: watch for a new sign. */
  watch: LeadRow[]
  /**
   * Scored under 40 (a Discard), or a Drop judged before the tiers had any. They are listed too:
   * every company the run researched is shown (PLAN-V20). They were only counted, and hidden,
   * before (the plan's choice 3), so a run of weak companies looked empty.
   */
  discarded: LeadRow[]
}

/**
 * The run's companies as Levi's section 9 lists them: ranked, then excluded, then watch, and then
 * the ones that scored under 40, so none is left out.
 */
export function groupRunLeads(leads: readonly LeadRow[]): RunLeadGroups {
  const groups: RunLeadGroups = { ranked: [], excluded: [], watch: [], discarded: [] }
  for (const lead of [...leads].sort(byTierThenScore)) {
    const tier = listedTier(lead)
    if (isExcluded(lead)) {
      groups.excluded.push(lead)
    } else if (tier === 'A' || tier === 'B') {
      groups.ranked.push(lead)
    } else if (tier === 'C') {
      groups.watch.push(lead)
    } else {
      groups.discarded.push(lead)
    }
  }
  return groups
}
