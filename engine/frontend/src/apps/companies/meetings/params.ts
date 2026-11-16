/**
 * Meetings keeps its view in the address, so a link, Back or a reload shows the same list:
 * Upcoming or Past (`?when=past`; Upcoming has none), whose meetings (`?who=mine` or `?who=team`;
 * All, the default, has none), the search (`?q=vitera+26+nov`) and Past's page (`?page=2`). A
 * change of view goes back to page 1. The page and its prefetch build the request the same way,
 * from here.
 *
 * An old link with `team=1` (PLAN-V17's switch) opens All, which holds the team's meetings and
 * more (PLAN-V18 T2-3). The next change of view drops it from the address.
 *
 * A pre-read has its own address under Meetings, `/companies/meetings/{form_id}` (T3-10), where
 * Track 2's morning email links. The rows, New pre-read and the email open it.
 */
import type { MeetingListQuery, MeetingWho } from '@/api/hooks/meetings'
import type { MeetingWhen } from '@/api/types'

/** Meetings' address. */
export const MEETINGS_PATH = '/companies/meetings'

/** Upcoming is the next 7 days or so: one page holds them (TBC). */
export const UPCOMING_LIMIT = 100
export const PAST_PAGE_SIZE = 25

const MAX_SEARCH = 200

export interface MeetingsView {
  when: MeetingWhen
  /** Whose meetings: everyone's (All), the rep's own, or their HubSpot team's. */
  who: MeetingWho
  /** The search, as typed. */
  q: string
  /** Past's page, from 0. The address shows it from 1. */
  page: number
}

export const FIRST_VIEW: MeetingsView = { when: 'upcoming', who: 'all', q: '', page: 0 }

/** `?who=` as the address has it: only My meetings and My team are written there. */
function readWho(value: string | null): MeetingWho {
  return value === 'mine' || value === 'team' ? value : 'all'
}

export function readMeetings(search: URLSearchParams): MeetingsView {
  const when = search.get('when') === 'past' ? 'past' : 'upcoming'
  const page = Number.parseInt(search.get('page') ?? '1', 10)
  return {
    when,
    who: readWho(search.get('who')),
    q: (search.get('q') ?? '').slice(0, MAX_SEARCH),
    // Upcoming is one page.
    page: when === 'past' && Number.isFinite(page) && page > 1 ? page - 1 : 0,
  }
}

/**
 * The address's search with `changes` made. A change to Upcoming or Past, whose meetings or the
 * search goes back to page 1. Defaults are left out, so the first view has a plain address, and
 * an old `team=1` goes.
 */
export function writeMeetings(
  search: URLSearchParams,
  changes: Partial<MeetingsView>,
): URLSearchParams {
  const before = readMeetings(search)
  const next: MeetingsView = { ...before, ...changes }
  if (changes.page === undefined) {
    const moved =
      next.when !== before.when || next.who !== before.who || next.q.trim() !== before.q.trim()
    if (moved) next.page = 0
  }
  const params = new URLSearchParams(search)
  for (const key of ['when', 'who', 'team', 'q', 'page']) params.delete(key)
  if (next.when === 'past') params.set('when', 'past')
  if (next.who !== 'all') params.set('who', next.who)
  if (next.q.trim() !== '') params.set('q', next.q)
  if (next.when === 'past' && next.page > 0) params.set('page', String(next.page + 1))
  return params
}

/** A link to Meetings with a view, like "/companies/meetings?when=past". */
export function meetingsHref(view: Partial<MeetingsView> = {}): string {
  const query = writeMeetings(new URLSearchParams(), view).toString()
  return query ? `${MEETINGS_PATH}?${query}` : MEETINGS_PATH
}

/** What the list asks the server for: every value sent, so each list has one cache entry. */
export function meetingsQuery(view: MeetingsView): MeetingListQuery {
  const q = view.q.trim()
  const query: MeetingListQuery =
    view.when === 'past'
      ? {
          when: 'past',
          who: view.who,
          limit: PAST_PAGE_SIZE,
          offset: view.page * PAST_PAGE_SIZE,
        }
      : { when: 'upcoming', who: view.who, limit: UPCOMING_LIMIT, offset: 0 }
  if (q !== '') query.q = q
  return query
}

/** A pre-read's own page, under Meetings, like "/companies/meetings/0f3c9a2e-...". */
export function preReadHref(formId: string): string {
  return `${MEETINGS_PATH}/${encodeURIComponent(formId)}`
}
