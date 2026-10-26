/**
 * The pages of the website, in one list. The sidebar, the command menu and the tests read it, so
 * a page has one name and one icon everywhere (DESIGN.md: "Same thing, same look").
 */
import {
  Database,
  FileSearch,
  FlaskConical,
  ListChecks,
  MapPinned,
  ScrollText,
  Settings2,
  SlidersHorizontal,
  Table2,
  Upload,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  /** The address, like "/results". */
  to: string
  /** The name in the sidebar, the breadcrumbs and the command menu. */
  label: string
  icon: LucideIcon
  /** Extra words the command menu also matches, like "csv" for Results. */
  keywords?: string[]
}

/** The main pages, in sidebar order. */
export const NAV_ITEMS: readonly NavItem[] = [
  { to: '/start', label: 'Start a run', icon: MapPinned, keywords: ['new', 'discovery', 'map'] },
  { to: '/runs', label: 'Runs', icon: ListChecks, keywords: ['progress', 'live', 'history'] },
  { to: '/results', label: 'Results', icon: Table2, keywords: ['leads', 'table', 'csv', 'export'] },
  { to: '/admin', label: 'Admin', icon: Settings2, keywords: ['settings', 'rules'] },
]

/** The tabs of the Admin page, in tab order. Each has its own address under /admin. */
export const ADMIN_TABS: readonly NavItem[] = [
  { to: '/admin/runs', label: 'Runs and cost', icon: ListChecks, keywords: ['spend', 'chart'] },
  { to: '/admin/searches', label: 'Search log', icon: FileSearch, keywords: ['claude', 'sources'] },
  { to: '/admin/memory', label: 'Memory', icon: Database, keywords: ['notes', 'search'] },
  { to: '/admin/hubspot', label: 'HubSpot', icon: Upload, keywords: ['import', 'watchlist'] },
  { to: '/admin/rules', label: 'Rules', icon: ScrollText, keywords: ['criteria', 'tbc'] },
  { to: '/admin/tests', label: 'Test set', icon: FlaskConical, keywords: ['scores', 'quality'] },
  {
    to: '/admin/settings',
    label: 'Settings',
    icon: SlidersHorizontal,
    keywords: ['caps', 'models'],
  },
]

/** The name of an Admin tab from the last part of its address ("searches" gives "Search log"). */
export function adminTabLabel(segment: string): string | undefined {
  return ADMIN_TABS.find((tab) => tab.to === `/admin/${segment}`)?.label
}

/** True when `pathname` is the page `to`, or a page inside it ("/runs/123" is in "/runs"). */
export function isWithin(pathname: string, to: string): boolean {
  return pathname === to || pathname.startsWith(`${to}/`)
}
