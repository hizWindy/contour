/**
 * Call logs was called Activity, at `/companies/activity` (PLAN-V17), until PLAN-V18 T3-2. An old
 * link, a bookmark or Back still works: the route sends it on to `/companies/call-logs` with its
 * tab and `log=1`, and the old tab Logged opens History, which took its place. It replaces the old
 * address in the history, so Back doesn't bounce.
 *
 * It is small and in the first visit (module.tsx draws the route), so it doesn't load the page's
 * own `params.ts`.
 */

/** The old address. */
export const OLD_PATH = '/companies/activity'

const NEW_PATH = '/companies/call-logs'

/** Where an old address goes: the same search, with `tab=logged` read as `tab=history`. */
export function movedTo(search: string, hash = ''): string {
  const params = new URLSearchParams(search)
  if (params.get('tab') === 'logged') params.set('tab', 'history')
  const query = params.toString()
  return `${NEW_PATH}${query ? `?${query}` : ''}${hash}`
}
