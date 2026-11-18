/**
 * Today (PLAN-V22), at /assistant: the Assistant's first page. For now it holds its place, so the
 * address, the menu, the breadcrumbs and the tab title ("Today - Contour") work (T2-1). T2-2 builds
 * the page itself: the rep's HubSpot tasks, meetings, calls to confirm and quiet deals, the most
 * urgent first (choice 6), against `GET /companies/assistant/today`.
 *
 * It opens for anyone with the Call logs or the Meetings tick, as the Assistant does (choice 4).
 * Its code loads with the page, not in the first visit.
 */
import { ListTodo } from 'lucide-react'
import { FeatureGuard } from '@/auth/guard'
import { PageHeader } from '@/components/page-header'
import { TODAY, TODAY_PURPOSE } from '../words'

/** Until T2-2: what the rep can open instead (Meetings, Call logs or both, by their ticks). */
const NOT_BUILT = "Today's list isn't built yet. The Assistant's other pages are in the menu."

function TodayContent() {
  return (
    <>
      <PageHeader icon={ListTodo} tone="companies" title={TODAY} description={TODAY_PURPOSE} />
      <p className="max-w-prose text-ui text-muted-foreground">{NOT_BUILT}</p>
    </>
  )
}

export default function TodayPage() {
  return (
    <FeatureGuard feature={['companies.call_logs', 'companies.meetings']} page={TODAY}>
      <TodayContent />
    </FeatureGuard>
  )
}
