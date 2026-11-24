/**
 * Which group each setting is in, on Admin's Settings (PLAN-V13 T1-9): Money, Claude, Runs, Why now,
 * Call prep, Sources (PLAN-V16 T3-6: Property Daily and Arealytics) and Call notes. A setting the
 * backend adds later and nobody placed yet goes under Runs, so it is never hidden.
 *
 * Call notes (PLAN-V17 T3-7) holds the switches: call notes on, Claude sorts them, and pre-meeting
 * forms on (shown again with Meetings, T3-9).
 */
export type GroupId = 'money' | 'claude' | 'runs' | 'why' | 'prep' | 'sources' | 'notes'

export const GROUPS: { value: GroupId; label: string }[] = [
  { value: 'money', label: 'Money' },
  { value: 'claude', label: 'Claude' },
  { value: 'runs', label: 'Runs' },
  { value: 'why', label: 'Why now' },
  { value: 'prep', label: 'Call prep' },
  { value: 'sources', label: 'Sources' },
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
  claude_effort_discover: 'claude', // PLAN-V21 T1-1: the Lead Finder's two steps
  claude_effort_research: 'claude',
  claude_people_concurrency: 'claude', // PLAN-V26 T1-1: the three lanes
  claude_runs_concurrency: 'claude',
  claude_jobs_concurrency: 'claude',
  model_deep: 'claude', // PLAN-V27 Part 5: Quick Deep Research's questions
  assistant_research_style: 'claude',
  run_max_companies: 'runs',
  target_companies_default: 'runs', // PLAN-V21 T1-4: the target and the sweeps
  discovery_max_sweeps: 'runs',
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
  hubspot_quiet_months: 'runs', // PLAN-V27 choice 3: a quiet HubSpot company counts as new
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
  tool_feeds_find_companies: 'sources', // PLAN-V27 choice 8: the tools' items as companies found
  call_notes_enabled: 'notes',
  call_notes_ai_enabled: 'notes',
  meeting_forms_enabled: 'notes',
  voice_tool: 'notes', // PLAN-V18: which voice to text tool the mic uses
  today_quiet_days: 'notes', // PLAN-V22 T2-2: the days without contact that make a deal quiet on Today
  name_hints_max: 'notes', // PLAN-V23 T2-4: the most names the mic listens for (T1-1)
  notify_owner_calls: 'notes', // PLAN-V23 T2-4: the owner's FYI task for someone else's call (T2-2)
}

/**
 * A choice's words, where its value would mean nothing to a person (PLAN-V18 T3-5: the voice tool).
 * A choice not listed here shows as it is.
 */
const CHOICE_WORDS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  voice_tool: {
    // PLAN-V24 choice 27: the model runs on each device, phone or laptop.
    browser_model: 'A free model on the device: the voice never leaves the device',
    browser_service: "The browser's speech service: the voice goes to Google or Microsoft",
    typing: 'Typing only: no mic button',
  },
  // PLAN-V27 Part 5: how the Assistant researches a new company.
  assistant_research_style: {
    standard: 'Standard: the four searches a run uses',
    deep: 'Deep: a short loop of questions (a test)',
  },
}

export function choiceWords(key: string, choice: string): string {
  return CHOICE_WORDS[key]?.[choice] ?? choice
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
