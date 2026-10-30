/**
 * The pages of the website. The sidebar, the command menu, Home and the tests read these lists, so
 * a page has one name and one icon everywhere (DESIGN.md: "Same thing, same look").
 *
 * Each project is a module (`AppModule`, listed in src/modules.ts) that brings its own pages. Home
 * and the Admin tabs are shared: they belong to no one project.
 */
import {
  Database,
  FileSearch,
  House,
  ListChecks,
  Settings2,
  SlidersHorizontal,
  Upload,
  type LucideIcon,
} from 'lucide-react'
import type { RouteObject } from 'react-router'

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
  /** Other addresses that count as this page in the menu: a lead card ("/leads") is in Results. */
  alsoActiveOn?: readonly string[]
}

/**
 * A project on the website, like the Lead Finder. It brings its menu pages and its addresses, and
 * the sidebar, the command menu and Home build themselves from it. Adding a project is its folder
 * under src/apps/ plus one line in src/modules.ts.
 */
export interface AppModule {
  /** A short name for code and tests, like "lead-finder". */
  id: string
  /** The name in the sidebar and on Home. */
  name: string
  icon: LucideIcon
  /** What the project does, in one sentence, for its card on Home. */
  description: string
  /** Its pages, in menu order. */
  pages: readonly NavItem[]
  /** Its addresses, inside the app frame. */
  routes: RouteObject[]
}

/**
 * The first page: one card per project. No extra words: the command menu matches loosely, and
 * "projects" would catch "csv" before Results does.
 */
export const HOME: NavItem = { to: '/', label: 'Home', icon: House }

/** The shared Admin page, at the bottom of the menu. The command menu lists its tabs instead. */
export const ADMIN: NavItem = { to: '/admin', label: 'Admin', icon: Settings2 }

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

/** True when the menu should mark `item` as the page you are on. */
export function isHere(pathname: string, item: NavItem): boolean {
  return [item.to, ...(item.alsoActiveOn ?? [])].some((to) => isWithin(pathname, to))
}
