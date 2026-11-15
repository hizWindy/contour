/**
 * Which group each setting is in, on Admin's Settings (PLAN-V13 T1-9): Money, Claude, Runs, Why now,
 * Call prep and Call notes. A setting the backend adds later and nobody placed yet goes under Runs,
 * so it is never hidden.
 *
 * Call notes (PLAN-V17 T3-7) holds the switches: call notes on, Claude sorts them, and pre-meeting
 * forms on (shown again with Meetings, T3-9).
 */
export type GroupId = 'money' | 'claude' | 'runs' | 'why' | 'prep' | 'notes'

export const GROUPS: { value: GroupId; label: string }[] = [
  { value: 'money', label: 'Money' },
  { value: 'claude', label: 'Claude' },
  { value: 'runs', label: 'Runs' },
  { value: 'why', label: 'Why now' },
  { value: 'prep', label: 'Call prep' },
  { value: 'notes', label: 'Call notes' },
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
  call_notes_enabled: 'notes',
  call_notes_ai_enabled: 'notes',
  meeting_forms_enabled: 'notes',
}

export function groupOf(key: string): GroupId {
  return GROUP_OF[key] ?? 'runs'
}

/**
 * Settings the page doesn't show yet, because they do nothing yet. Each is still placed in a group
 * above, so it lands there when it shows. None now: `meeting_forms_enabled` was here through
 * PLAN-V17 Stage A, and shows again with Meetings (T3-9).
 */
export const HIDDEN_SETTINGS: ReadonlySet<string> = new Set<string>()

export function isShown(key: string): boolean {
  return !HIDDEN_SETTINGS.has(key)
}

/** The first sentence of a description: the one line a row shows until "Show the details". */
export function firstSentence(text: string): string {
  const match = /^.*?[.!?](?=\s|$)/.exec(text.trim())
  return match ? match[0] : text.trim()
}
