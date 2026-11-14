/**
 * Which group each setting is in, on Admin's Settings (PLAN-V13 T1-9): Money, Claude, Runs, Why now,
 * Call prep and Sources (PLAN-V16 T3-6: Property Daily and Arealytics). A setting the backend adds
 * later and nobody placed yet goes under Runs, so it is never hidden.
 */
export type GroupId = 'money' | 'claude' | 'runs' | 'why' | 'prep' | 'sources'

export const GROUPS: { value: GroupId; label: string }[] = [
  { value: 'money', label: 'Money' },
  { value: 'claude', label: 'Claude' },
  { value: 'runs', label: 'Runs' },
  { value: 'why', label: 'Why now' },
  { value: 'prep', label: 'Call prep' },
  { value: 'sources', label: 'Sources' },
]

const GROUP_OF: Record<string, GroupId> = {
  run_cap_usd: 'money',
  scheduled_run_cap_usd: 'money',
  lead_finder_round_cap_usd: 'money',
  daily_cap_usd: 'money',
  company_cap_usd: 'money',
  request_reserve_usd: 'money',
  slice_reserve_usd: 'money',
  discovery_share: 'money',
  claude_model: 'claude',
  model_discover: 'claude',
  model_search: 'claude',
  model_extract: 'claude',
  claude_effort: 'claude',
  claude_concurrency: 'claude',
  run_max_companies: 'runs',
  manual_run_goal_leads: 'runs', // PLAN-V16: "How many leads" on Start
  lead_finder_goal_good_leads: 'runs',
  company_max_searches: 'runs',
  searches_per_request: 'runs',
  fetches_per_request: 'runs',
  slice_max_searches: 'runs',
  run_company_concurrency: 'runs',
  run_discover_concurrency: 'runs',
  max_concurrent_runs: 'runs',
  memory_fresh_days: 'runs',
  match_fuzzy_min: 'runs',
  match_profile_min: 'runs',
  why_now_enabled: 'why',
  model_why: 'why',
  prep_enabled: 'prep',
  prep_cap_usd: 'prep',
  prep_max_searches: 'prep',
  prep_reuse_days: 'prep',
  model_prep: 'prep',
  search_ahead_cap_usd: 'prep',
  // PLAN-V16: the property tools. The switches and the paces; the two "to Claude" approvals and
  // Arealytics' switch are env-only, so they show here read-only.
  property_daily_enabled: 'sources',
  arealytics_enabled: 'sources',
  source_pages_per_day: 'sources',
  source_pages_per_run: 'sources',
  property_lookup_days: 'sources',
  property_daily_to_claude_ok: 'sources',
  arealytics_to_claude_ok: 'sources',
}

export function groupOf(key: string): GroupId {
  return GROUP_OF[key] ?? 'runs'
}

/** The first sentence of a description: the one line a row shows until "Show the details". */
export function firstSentence(text: string): string {
  const match = /^.*?[.!?](?=\s|$)/.exec(text.trim())
  return match ? match[0] : text.trim()
}
