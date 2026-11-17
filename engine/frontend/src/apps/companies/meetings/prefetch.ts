/**
 * What Meetings' pages ask for first (PLAN-V7 C1). The route loads this file when a navigation
 * starts or a link is pointed at (module.tsx), so the meetings hooks stay out of the first visit.
 * Each page asks with the same query options, so its request joins the one started here.
 *
 * - **Meetings:** the list for the view in the address (Upcoming, the rep's own, by default). The
 *   list also says whether pre-meeting forms are on (a 409 when they are off): there is no options
 *   route.
 * - **A pre-read** (T3-10): its form, by the id in the address, also on a first visit from the
 *   morning email's link, so the form downloads while the page's code does. One file for both
 *   keeps the first visit's list of files to fetch one shorter.
 *
 * Once a list is on screen, `warmOtherViews` asks quietly for the lists a click on the toolbar
 * shows next (Improvements 1, #10), so Upcoming, Past and Whose open at once.
 */
import type { QueryClient } from '@tanstack/react-query'
import type { SignIn } from '@/api/hooks/auth'
import { meetingFormQueryOptions, meetingsQueryOptions } from '@/api/hooks/meetings'
import { queryKeys } from '@/api/query'
import type { MeetingWho } from '@/api/types'
import { canUse } from '@/auth/can'
import type { PrefetchArgs } from '@/shell/crumbs'
import { whenQuiet } from '@/shell/warm'
import { meetingsQuery, readMeetings, type MeetingsView } from './params'

function allowed(client: QueryClient): boolean {
  return canUse(client.getQueryData<SignIn>(queryKeys.auth.me()), 'companies.meetings')
}

export function prefetchMeetings({ client, search }: PrefetchArgs): void {
  if (!allowed(client)) return
  void client.prefetchQuery(meetingsQueryOptions(meetingsQuery(readMeetings(search))))
}

export function prefetchPreRead({ client, params }: PrefetchArgs): void {
  if (!allowed(client)) return
  const formId = params.formId
  if (formId) void client.prefetchQuery(meetingFormQueryOptions(formId))
}

/**
 * The views a click on the toolbar opens from `view`: the other of Upcoming and Past, and each
 * other choice of whose meetings (`whos`, the ones the toolbar offers). Each keeps the owner, and
 * opens on its first page. Not one more: an owner or a search is a deliberate narrowing, and the
 * people to pick from are many.
 */
export function otherViews(view: MeetingsView, whos: readonly MeetingWho[]): MeetingsView[] {
  return [
    { ...view, when: view.when === 'past' ? 'upcoming' : 'past', page: 0 },
    ...whos.filter((who) => who !== view.who).map((who) => ({ ...view, who, page: 0 })),
  ]
}

/**
 * Asks for those views' lists once the browser is idle. The page calls it after its own list is in
 * (so it never slows it down), and only with no search typed. Returns a way to stop it, for a page
 * that is left first.
 */
export function warmOtherViews(
  client: QueryClient,
  view: MeetingsView,
  whos: readonly MeetingWho[],
): () => void {
  return whenQuiet(() => {
    for (const other of otherViews(view, whos)) {
      void client.prefetchQuery(meetingsQueryOptions(meetingsQuery(other)))
    }
  })
}
