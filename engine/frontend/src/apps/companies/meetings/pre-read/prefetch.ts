/**
 * What the pre-read's page asks for first (PLAN-V7 C1): its form, by the id in the address. The
 * route loads this file when a navigation starts or a link is pointed at (module.tsx), and on a
 * first visit from the email's link, so the form downloads while the page's code does. The page
 * asks with the same query options, so its request joins this one.
 */
import { meetingFormQueryOptions } from '@/api/hooks/meetings'
import type { PrefetchArgs } from '@/shell/crumbs'

export function prefetchPreRead({ client, params }: PrefetchArgs): void {
  const formId = params.formId
  if (formId) void client.prefetchQuery(meetingFormQueryOptions(formId))
}
