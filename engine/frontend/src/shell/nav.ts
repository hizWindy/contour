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
  /** What the page is for, in a sentence a person outside the team would understand. */
  purpose?: string
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
  {
    to: '/admin/runs',
    label: 'Runs and cost',
    icon: ListChecks,
    keywords: ['spend', 'chart'],
    purpose:
      'See how much each run cost and what you have spent day by day. Open a run to see what it found.',
  },
  {
    to: '/admin/searches',
    label: 'Search log',
    icon: FileSearch,
    keywords: ['claude', 'sources'],
    purpose:
      'Every request sent to Claude: what it searched, which pages it read and what it cost. Use it to check where the money went.',
  },
  {
    to: '/admin/memory',
    label: 'Memory',
    icon: Database,
    keywords: ['notes', 'search'],
    purpose:
      'What the engine remembers from past research. Search it in your own words to see which notes it would use.',
  },
  {
    to: '/admin/hubspot',
    label: 'HubSpot',
    icon: Upload,
    keywords: ['import', 'watchlist'],
    purpose:
      'Load your HubSpot export and see which companies the watchlist would look at again. Nothing is sent back to HubSpot.',
  },
  {
    to: '/admin/rules',
    label: 'Rules',
    icon: ScrollText,
    keywords: ['criteria', 'tbc'],
    purpose:
      "The rules that decide each lead's result: cities, company size and signs of an office change. Read only. Points marked TBC still wait for Levi.",
  },
  {
    to: '/admin/tests',
    label: 'Test set',
    icon: FlaskConical,
    keywords: ['scores', 'quality'],
    purpose:
      'Ten public companies to check that a change to a prompt or a rule has not made results worse. Running it costs money.',
  },
  {
    to: '/admin/settings',
    label: 'Settings',
    icon: SlidersHorizontal,
    keywords: ['caps', 'models'],
    purpose:
      'Spending limits, which Claude model each step uses, and how many things run at once. A change applies from the next run.',
  },
]

/** The name of an Admin tab from the last part of its address ("searches" gives "Search log"). */
export function adminTabLabel(segment: string): string | undefined {
  return ADMIN_TABS.find((tab) => tab.to === `/admin/${segment}`)?.label
}

/** The Admin tab that is open at `pathname` ("/admin/searches"), if any. */
export function adminTabAt(pathname: string): NavItem | undefined {
  return ADMIN_TABS.find((tab) => isWithin(pathname, tab.to))
}

/** True when `pathname` is the page `to`, or a page inside it ("/runs/123" is in "/runs"). */
export function isWithin(pathname: string, to: string): boolean {
  return pathname === to || pathname.startsWith(`${to}/`)
}
