/**
 * The Assistant's pages lived under Companies until PLAN-V22 (T2-1): Meetings at
 * `/companies/meetings`, a pre-read at `/companies/meetings/{form_id}`, and Call logs at
 * `/companies/call-logs` (called Activity, at `/companies/activity`, until PLAN-V18 T3-2). An old
 * link, a bookmark, the morning email's pre-read link or Back still works: the route sends it on to
 * the new address with the same query (the tab, the view, the filters, `log=1`) and hash, and
 * replaces the old address in the history, so Back doesn't bounce (`old-route.tsx`). Activity's old
 * tab Logged opens History, which took its place.
 *
 * It is small and in the first visit (the module draws the routes), so it doesn't load the pages'
 * own `params.ts`.
 */
import { isWithin } from '@/shell/nav'
import { CALL_LOGS_PATH, MEETINGS_PATH } from './paths'

/** Each old address, and where it went. A pre-read keeps its id: only the start changes. */
const MOVED: readonly (readonly [old: string, now: string])[] = [
  ['/companies/meetings', MEETINGS_PATH],
  ['/companies/call-logs', CALL_LOGS_PATH],
  ['/companies/activity', CALL_LOGS_PATH],
]

/** The old addresses. */
export const OLD_PATHS: readonly string[] = MOVED.map(([old]) => old)

/** Activity's tab Logged (PLAN-V17): History took its place. */
const OLD_LOGGED = 'logged'

/**
 * Where an old address goes now, with its query and hash: "/companies/meetings/f1?x=1" gives
 * "/assistant/meetings/f1?x=1". Call logs' `tab=logged` is read as `tab=history`. An address that
 * didn't move comes back as it was.
 */
export function movedTo(pathname: string, search = '', hash = ''): string {
  const move = MOVED.find(([old]) => isWithin(pathname, old))
  if (!move) return `${pathname}${search}${hash}`
  const [old, now] = move
  const params = new URLSearchParams(search)
  if (now === CALL_LOGS_PATH && params.get('tab') === OLD_LOGGED) params.set('tab', 'history')
  const query = params.toString()
  return `${now}${pathname.slice(old.length)}${query ? `?${query}` : ''}${hash}`
}
