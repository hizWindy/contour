/**
 * The pure part of the live run feed: reading one event, and turning the events of a run into
 * the numbers and lines a page shows. `useRunEvents` (the hook) only connects and feeds this.
 *
 * Rules the reducer keeps:
 *  - An event with a `seq` at or below the last one is a repeat (a replay after a reconnect) and
 *    changes nothing.
 *  - Counts and cost come from `progress` and `run_finished`, which carry the backend's own
 *    totals. Nothing is guessed between them, so the numbers never run ahead of the truth.
 *  - `plan_ready` and `merged` set the plan and the merge counts at once. They are plain facts.
 *  - `sweep_started` and `sweep_done` keep the sweep a discovery run is on, with the companies it
 *    has so far and its target, and `topped_up` the companies the HubSpot watchlist added
 *    (PLAN-V21). The run merges after every sweep, so "companies after merging" grows with them.
 *  - The feed holds every event except `progress` (a counter update, not news), as one plain line.
 *  - The text in an event (company names, reasons) is only ever stored. A page shows it as text.
 */
import type { RunCaps, RunCounts, RunEvent, RunEventType, RunStatus } from '@/api/types'
import { formatMoney } from '@/lib/money'
import { formatNumber, pluralise } from '@/lib/format'
import { resultLabel } from '@/lib/labels'

export const RUN_EVENT_TYPES: readonly RunEventType[] = [
  'run_started',
  'run_resumed',
  'plan_ready',
  'slice_started',
  'slice_done',
  'slice_failed',
  'merged',
  // PLAN-V21: a discovery run a person starts searches in up to four sweeps, then tops up.
  'sweep_started',
  'sweep_done',
  'topped_up',
  'company_skipped',
  'company_started',
  // PLAN-V27 T4-2: a research the Assistant started sends each finding as it arrives
  'finding',
  'company_done',
  'company_failed',
  'progress',
  'problem',
  'cap_reached',
  'run_finished',
]

const KNOWN_TYPES = new Set<string>(RUN_EVENT_TYPES)
const RUN_STATUSES = new Set<string>([
  'queued',
  'running',
  'done',
  'failed',
  'cancelled',
  'interrupted',
])
const MAX_FEED = 1000
const MAX_PROBLEMS = 50

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Reads the `data:` text of one server-sent message. Returns the event, or `null` when the text
 * is not JSON, has no usable `seq`, or has a type this build does not know (a newer backend). The
 * payload is trusted to match the contract beyond that. The reducer reads it defensively.
 */
export function parseRunEvent(text: string): RunEvent | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(value)) {
    return null
  }
  const { seq, type, data } = value
  if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 1) {
    return null
  }
  if (typeof type !== 'string' || !KNOWN_TYPES.has(type) || !isRecord(data)) {
    return null
  }
  if (typeof value.created_at !== 'string') {
    return null
  }
  return value as unknown as RunEvent
}

export type FeedTone = 'info' | 'success' | 'warning' | 'error'

export interface FeedItem {
  seq: number
  type: RunEventType
  /** When it happened (ISO 8601, UTC). Format it with `formatTime`. */
  at: string
  tone: FeedTone
  /** One plain line. It can hold company names and reasons, so show it as text only. */
  message: string
  event: RunEvent
}

export interface SliceState {
  id: string
  label: string
  status: 'running' | 'done' | 'failed'
  found: number | null
  searches: number | null
  cost_usd: string | null
  reason: string | null
}

/**
 * The search sweep a discovery run is on (PLAN-V21 T3-4). A run with one sweep (an automatic run)
 * sends no sweep events, so it has none.
 */
export interface SweepState {
  /** The sweep running now, or the last one that ran. 1 is the signs' own searches. */
  sweep: number
  /** The most sweeps the run may make. */
  of: number
  /** What the sweep searches, in plain words, like "By area". */
  label: string
  /** True from its `sweep_started` until its `sweep_done`. */
  running: boolean
  /** Companies the run has chosen so far, after merging, from the last `sweep_done`. */
  companies: number
  /** How many companies the run tries to research. Empty: no target. */
  target: number | null
}

/** The backend's reason for the companies a Find new leads run leaves out (`choose.py`). */
export const IN_HUBSPOT_REASON = 'already in HubSpot'

/** The companies the HubSpot watchlist added after the sweeps came up short (PLAN-V21 T1-6). */
export interface ToppedUp {
  count: number
  names: string[]
}

export interface RunEventsState {
  /** The highest `seq` seen. The next connection asks for events after it. */
  lastSeq: number
  /** From the events. `null` until the first one. */
  status: RunStatus | null
  mode: string | null
  caps: RunCaps | null
  rulesVersion: string | null
  stopReason: string | null
  /** What the run has cost so far, as a Decimal string. "at least" while the run is not final. */
  costUsd: string
  webSearches: number
  claudeRequests: number
  counts: RunCounts
  plan: { slices: number; companies: number; labels: string[] } | null
  sweep: SweepState | null
  toppedUp: ToppedUp | null
  slices: SliceState[]
  /** Names of companies being researched right now. */
  inFlight: string[]
  capReached: { kind: string; detail: string } | null
  problems: string[]
  feed: FeedItem[]
  /** True when the last event was `run_finished`. A `run_resumed` after it makes it false again. */
  finished: boolean
}

export const EMPTY_COUNTS: RunCounts = {
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
  goal: null,
  good: 0,
  by_source: {},
  target: null,
  sweeps: 0,
  sweeps_done: 0,
  topped_up: 0,
}

export const initialRunEventsState: RunEventsState = {
  lastSeq: 0,
  status: null,
  mode: null,
  caps: null,
  rulesVersion: null,
  stopReason: null,
  costUsd: '0',
  webSearches: 0,
  claudeRequests: 0,
  counts: EMPTY_COUNTS,
  plan: null,
  sweep: null,
  toppedUp: null,
  slices: [],
  inFlight: [],
  capReached: null,
  problems: [],
  feed: [],
  finished: false,
}

export type RunEventsAction = { type: 'event'; event: RunEvent } | { type: 'reset' }

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function whole(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback
}

function money(value: unknown, fallback: string): string {
  return typeof value === 'string' && value !== '' ? value : fallback
}

/** Reads counts from an event. A missing or odd field keeps the value it had. */
function readCounts(value: unknown, base: RunCounts): RunCounts {
  if (!isRecord(value)) {
    return base
  }
  const byResult: Record<string, number> = {}
  if (isRecord(value.by_result)) {
    for (const [key, count] of Object.entries(value.by_result)) {
      if (typeof count === 'number' && Number.isFinite(count)) {
        byResult[key] = Math.trunc(count)
      }
    }
  }
  return {
    slices: whole(value.slices, base.slices),
    slices_done: whole(value.slices_done, base.slices_done),
    slices_failed: whole(value.slices_failed, base.slices_failed),
    candidates: whole(value.candidates, base.candidates),
    unique: whole(value.unique, base.unique),
    chosen: whole(value.chosen, base.chosen),
    researched: whole(value.researched, base.researched),
    skipped: whole(value.skipped, base.skipped),
    failed: whole(value.failed, base.failed),
    by_result: isRecord(value.by_result) ? byResult : base.by_result,
    resumes: whole(value.resumes, base.resumes),
    // PLAN-V16: the goal, the good leads and where they came from
    goal: typeof value.goal === 'number' ? Math.trunc(value.goal) : base.goal,
    good: whole(value.good, base.good),
    by_source: isRecord(value.by_source)
      ? (value.by_source as Record<string, number>)
      : base.by_source,
    // PLAN-V21: the target, the sweeps and the top up
    target: typeof value.target === 'number' ? Math.trunc(value.target) : base.target,
    sweeps: whole(value.sweeps, base.sweeps),
    sweeps_done: whole(value.sweeps_done, base.sweeps_done),
    topped_up: whole(value.topped_up, base.topped_up),
  }
}

function readStatus(value: unknown): RunStatus | null {
  return typeof value === 'string' && RUN_STATUSES.has(value) ? (value as RunStatus) : null
}

function readCaps(value: unknown): RunCaps | null {
  if (!isRecord(value)) {
    return null
  }
  return {
    run_cap_usd: money(value.run_cap_usd, '0'),
    max_companies: whole(value.max_companies),
    company_cap_usd: money(value.company_cap_usd, '0'),
    discovery_cap_usd: money(value.discovery_cap_usd, '0'),
  }
}

/** What the feed knows about the run when it words an event. */
export interface FeedContext {
  /** The run's mode, from `run_started`. */
  mode?: string | null
  /** The names the HubSpot top up added, for an event of an older run that carries no origin. */
  toppedUp?: readonly string[]
}

/**
 * A company the HubSpot top up added to a discovery run (PLAN-V21 T3-4). In a watchlist run every
 * company is from HubSpot, so saying it there would add nothing.
 */
function fromTopUp(data: Record<string, unknown>, context: FeedContext): boolean {
  if (context.mode !== 'discovery') {
    return false
  }
  const origin = text(data.origin)
  return (
    origin === 'hubspot' || (origin === '' && (context.toppedUp ?? []).includes(text(data.name)))
  )
}

/** The site a finding comes from, like news.example.com. Empty when there's no good link. */
export function siteOf(url: unknown): string {
  if (typeof url !== 'string') return ''
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** "Found: Northwind hired 40 staff this year (news.example.com). Now checking: a second
 * office?" (PLAN-V27 words on screen) */
export function findingLine(data: Record<string, unknown>): string {
  const site = siteOf(data.source_url)
  const found = text(data.text).replace(/[.\s]+$/, '')
  const next = text(data.next_question)
  const line = `Found: ${found}${site ? ` (${site})` : ''}.`
  return next ? `${line} Now checking: ${next}` : line
}

/** One plain line for an event, and how it should look (info, success, warning, error). */
export function describeEvent(
  event: RunEvent,
  context: FeedContext = {},
): { tone: FeedTone; message: string } {
  const data: Record<string, unknown> = isRecord(event.data) ? event.data : {}
  switch (event.type) {
    case 'run_started':
      return { tone: 'info', message: 'The run started.' }
    case 'run_resumed':
      return { tone: 'info', message: 'The run continued from where it stopped.' }
    case 'plan_ready': {
      const slices = whole(data.slices)
      const companies = whole(data.companies)
      const parts = [`${pluralise(slices, 'search', 'searches')} planned`]
      if (companies > 0) {
        parts.push(`${pluralise(companies, 'company', 'companies')} to research`)
      }
      return { tone: 'info', message: `${parts.join(', ')}.` }
    }
    case 'slice_started':
      return { tone: 'info', message: `Searching: ${text(data.label)}` }
    case 'slice_done':
      return {
        tone: 'success',
        message: `Searched ${text(data.label)}: ${pluralise(whole(data.found), 'company', 'companies')} found, ${formatMoney(text(data.cost_usd) || null)}.`,
      }
    case 'slice_failed':
      return {
        tone: 'warning',
        message: `Search failed for ${text(data.label)}: ${text(data.reason, 'no reason given')}`,
      }
    case 'merged':
      return {
        tone: 'info',
        message: `${pluralise(whole(data.candidates), 'find', 'finds')} merged into ${pluralise(whole(data.unique), 'company', 'companies')}.`,
      }
    case 'sweep_started': {
      const sweep = whole(data.sweep, 1)
      const label = text(data.label)
      return {
        tone: 'info',
        message: `Sweep ${String(sweep)} of ${String(whole(data.of, sweep))} started${label ? `: ${label}` : ''}.`,
      }
    }
    case 'sweep_done': {
      const companies = whole(data.companies)
      const target = typeof data.target === 'number' ? Math.trunc(data.target) : null
      const soFar =
        target !== null
          ? `${formatNumber(companies)} of ${pluralise(target, 'company', 'companies')} so far`
          : `${pluralise(companies, 'company', 'companies')} so far`
      return {
        tone: 'success',
        message: `Sweep ${String(whole(data.sweep, 1))} done: ${pluralise(whole(data.found), 'find')}, ${soFar}.`,
      }
    }
    case 'topped_up':
      return {
        tone: 'info',
        message: `Added ${pluralise(whole(data.count), 'company', 'companies')} from the HubSpot watchlist, as the searches came up short.`,
      }
    case 'company_skipped': {
      const count = whole(data.count)
      const reason = text(data.reason, 'no reason given')
      // A Find new leads run says once what HubSpot already has (PLAN-V27 choice 7).
      if (reason === IN_HUBSPOT_REASON && count > 0) {
        return {
          tone: 'info',
          message: `Left out ${pluralise(count, 'company', 'companies')} already in HubSpot.`,
        }
      }
      return {
        tone: 'info',
        message:
          count > 1
            ? `Skipped ${pluralise(count, 'company', 'companies')}: ${reason}`
            : `Skipped ${text(data.name)}: ${reason}`,
      }
    }
    case 'company_started':
      return {
        tone: 'info',
        message: fromTopUp(data, context)
          ? `Researching ${text(data.name)}, from HubSpot`
          : `Researching ${text(data.name)}`,
      }
    case 'company_done':
      return {
        tone: 'success',
        message: `${text(data.name)}: ${resultLabel(text(data.result, 'unknown'))}, score ${whole(data.score)}, ${formatMoney(text(data.cost_usd) || null)}.`,
      }
    case 'company_failed':
      return {
        tone: 'warning',
        message: `Could not research ${text(data.name)}: ${text(data.reason, 'no reason given')}`,
      }
    case 'finding':
      return { tone: 'info', message: findingLine(data) }
    case 'progress':
      return { tone: 'info', message: 'Progress updated.' }
    case 'problem':
      return { tone: 'warning', message: text(data.message, 'Something went wrong.') }
    case 'cap_reached':
      return { tone: 'warning', message: `A limit was reached: ${text(data.detail)}` }
    case 'run_finished': {
      const status = readStatus(data.status)
      const reason = text(data.stop_reason)
      const head =
        status === 'done'
          ? 'The run finished.'
          : status === 'cancelled'
            ? 'The run was stopped.'
            : status === 'interrupted'
              ? 'The run was interrupted.'
              : status === 'failed'
                ? 'The run failed.'
                : 'The run ended.'
      return {
        tone: status === 'failed' ? 'error' : status === 'done' ? 'success' : 'warning',
        message: reason ? `${head} ${reason}` : head,
      }
    }
  }
}

function upsertSlice(slices: SliceState[], next: SliceState): SliceState[] {
  const index = slices.findIndex((slice) => slice.id === next.id)
  if (index === -1) {
    return [...slices, next]
  }
  return slices.map((slice, at) => (at === index ? { ...slice, ...next } : slice))
}

function without(names: string[], name: string): string[] {
  return names.filter((existing) => existing !== name)
}

/** Applies one event. A repeat (`seq` not above `lastSeq`) returns the same state. */
function applyEvent(state: RunEventsState, event: RunEvent): RunEventsState {
  const data: Record<string, unknown> = isRecord(event.data) ? event.data : {}
  let next: RunEventsState = {
    ...state,
    lastSeq: event.seq,
    finished: event.type === 'run_finished',
  }

  switch (event.type) {
    case 'run_started':
      next = {
        ...next,
        status: 'running',
        mode: text(data.mode) || state.mode,
        caps: readCaps(data.caps) ?? state.caps,
        rulesVersion: text(data.rules_version) || state.rulesVersion,
        stopReason: null,
      }
      break
    case 'run_resumed':
      // Whoever was in flight before the stop is gone. The run starts those companies again.
      next = { ...next, status: 'running', stopReason: null, capReached: null, inFlight: [] }
      break
    case 'plan_ready': {
      const slices = whole(data.slices)
      const labels = Array.isArray(data.labels)
        ? data.labels.filter((label): label is string => typeof label === 'string')
        : []
      next = {
        ...next,
        plan: { slices, companies: whole(data.companies), labels },
        counts: { ...state.counts, slices },
      }
      break
    }
    case 'slice_started':
      next = {
        ...next,
        slices: upsertSlice(state.slices, {
          id: text(data.slice_id),
          label: text(data.label),
          status: 'running',
          found: null,
          searches: null,
          cost_usd: null,
          reason: null,
        }),
      }
      break
    case 'slice_done':
      next = {
        ...next,
        slices: upsertSlice(state.slices, {
          id: text(data.slice_id),
          label: text(data.label),
          status: 'done',
          found: whole(data.found),
          searches: whole(data.searches),
          cost_usd: text(data.cost_usd) || null,
          reason: null,
        }),
      }
      break
    case 'slice_failed':
      next = {
        ...next,
        slices: upsertSlice(state.slices, {
          id: text(data.slice_id),
          label: text(data.label),
          status: 'failed',
          found: null,
          searches: null,
          cost_usd: null,
          reason: text(data.reason) || null,
        }),
      }
      break
    case 'merged':
      next = {
        ...next,
        counts: {
          ...state.counts,
          candidates: whole(data.candidates, state.counts.candidates),
          unique: whole(data.unique, state.counts.unique),
        },
      }
      break
    case 'sweep_started': {
      const sweep = Math.max(1, whole(data.sweep, (state.sweep?.sweep ?? 0) + 1))
      const of = Math.max(sweep, whole(data.of, state.counts.sweeps))
      next = {
        ...next,
        sweep: {
          sweep,
          of,
          label: text(data.label),
          running: true,
          companies: state.sweep?.companies ?? 0,
          target: state.sweep?.target ?? state.counts.target,
        },
        counts: { ...state.counts, sweeps: Math.max(state.counts.sweeps, of) },
      }
      break
    }
    case 'sweep_done': {
      const sweep = Math.max(1, whole(data.sweep, state.sweep?.sweep ?? 1))
      const target =
        typeof data.target === 'number'
          ? Math.trunc(data.target)
          : (state.sweep?.target ?? state.counts.target)
      next = {
        ...next,
        sweep: {
          sweep,
          of: Math.max(sweep, state.sweep?.of ?? state.counts.sweeps),
          label: state.sweep?.sweep === sweep ? state.sweep.label : '',
          running: false,
          companies: whole(data.companies, state.sweep?.companies ?? 0),
          target,
        },
        counts: {
          ...state.counts,
          sweeps_done: Math.max(state.counts.sweeps_done, sweep),
          target,
        },
      }
      break
    }
    case 'topped_up': {
      const names = Array.isArray(data.names)
        ? data.names.filter((name): name is string => typeof name === 'string')
        : []
      const count = whole(data.count, names.length)
      next = {
        ...next,
        toppedUp: { count, names },
        counts: { ...state.counts, topped_up: count },
      }
      break
    }
    case 'company_started': {
      const name = text(data.name)
      next = { ...next, inFlight: [...without(state.inFlight, name), name] }
      break
    }
    case 'company_done':
    case 'company_failed':
      next = { ...next, inFlight: without(state.inFlight, text(data.name)) }
      break
    case 'progress':
      next = {
        ...next,
        costUsd: money(data.cost_usd, state.costUsd),
        webSearches: whole(data.web_searches, state.webSearches),
        claudeRequests: whole(data.claude_requests, state.claudeRequests),
        counts: readCounts(data.counts, state.counts),
      }
      break
    case 'problem':
      next = {
        ...next,
        problems: [...state.problems, text(data.message, 'Something went wrong.')].slice(
          -MAX_PROBLEMS,
        ),
      }
      break
    case 'cap_reached':
      next = { ...next, capReached: { kind: text(data.kind), detail: text(data.detail) } }
      break
    case 'run_finished':
      next = {
        ...next,
        status: readStatus(data.status) ?? state.status,
        stopReason: text(data.stop_reason) || null,
        costUsd: money(data.cost_usd, state.costUsd),
        counts: readCounts(data.counts, state.counts),
        inFlight: [],
      }
      break
    case 'company_skipped':
      break
  }

  if (event.type !== 'progress') {
    const { tone, message } = describeEvent(event, {
      mode: next.mode,
      toppedUp: next.toppedUp?.names,
    })
    const item: FeedItem = {
      seq: event.seq,
      type: event.type,
      at: event.created_at,
      tone,
      message,
      event,
    }
    const feed = [...state.feed, item]
    next = { ...next, feed: feed.length > MAX_FEED ? feed.slice(feed.length - MAX_FEED) : feed }
  }
  return next
}

/**
 * The state of a run, from its events. Pure: the same events always give the same state, and a
 * repeated event changes nothing.
 */
export function runEventsReducer(state: RunEventsState, action: RunEventsAction): RunEventsState {
  if (action.type === 'reset') {
    return initialRunEventsState
  }
  if (action.event.seq <= state.lastSeq) {
    return state
  }
  return applyEvent(state, action.event)
}

/** The state after a list of events, from nothing. For a page that reads `GET /runs/{id}/log`. */
export function foldRunEvents(events: readonly RunEvent[]): RunEventsState {
  return events.reduce<RunEventsState>(
    (state, event) => runEventsReducer(state, { type: 'event', event }),
    initialRunEventsState,
  )
}
