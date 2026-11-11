/**
 * The pages of the website. The sidebar, the command menu, Home and the tests read these lists, so
 * a page has one name and one icon everywhere (DESIGN.md: "Same thing, same look").
 *
 * Each project is a module (`AppModule`, listed in src/modules.ts) that brings its own pages. Home
 * and the Admin tabs are shared: they belong to no one project.
 */
import {
  Activity,
  CalendarClock,
  Database,
  FileSearch,
  House,
  ListChecks,
  Settings2,
  SlidersHorizontal,
  Upload,
  Users,
  type LucideIcon,
} from 'lucide-react'
import type { QueryClient } from '@tanstack/react-query'
import type { ComponentType } from 'react'
import type { RouteObject } from 'react-router'
import type { ProjectTone } from './tone'

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
  /**
   * The backend's name for the project, like "lead_finder". A person whose account doesn't list it
   * (and who isn't an Admin) doesn't see the project in the menu, on Home or in Ctrl+K (PLAN-V9 E1).
   */
  app?: string
  /** The name in the sidebar and on Home. */
  name: string
  icon: LucideIcon
  /** Its quiet colour (DESIGN.md "Project colour"), for its icon tiles, menu icon and Home card. */
  tone?: ProjectTone
  /** What the project does, in one sentence, for its card on Home. */
  description: string
  /** Where the project stands, for its Home card (the last run, the leads). Optional. */
  summary?: ComponentType
  /** Starts what `summary` asks for, while Home's code downloads (PLAN-V7 C1). Optional. */
  prefetchSummary?: (client: QueryClient) => void
  /** Its pages, in menu order. On Home each shows with its `purpose`. */
  pages: readonly NavItem[]
  /** Its addresses, inside the app frame. */
  routes: RouteObject[]
}

/**
 * A project still to be developed. It has a row in the menu, a card on Home and one page that says
 * what it will do and where it stands. Once it is built, it becomes an `AppModule`.
 */
export interface PlannedModule {
  /** A short name for code and tests, like "meeting-prep". */
  id: string
  name: string
  icon: LucideIcon
  /** Its page for now, at the address the project will use, like "/meeting-prep". */
  to: string
  /** What it will do, in a sentence or two. */
  description: string
  /** Where it stands and who said so, like "On hold (Levi, 23 Oct)". */
  status: string
}

/**
 * The first page: one card per project. No extra words: the command menu matches loosely, and
 * "projects" would catch "csv" before Results does.
 */
export const HOME: NavItem = { to: '/', label: 'Home', icon: House }

/** The shared Admin page, at the bottom of the menu. The command menu lists its tabs instead. */
export const ADMIN: NavItem = { to: '/admin', label: 'Admin', icon: Settings2 }

/**
 * The tabs of the Admin page, in tab order. Each has its own address under /admin, and its purpose
 * is one short line under the tabs (PLAN-V13 T1-6). Admin opens on Health.
 */
export const ADMIN_TABS: readonly NavItem[] = [
  {
    to: '/admin/health',
    label: 'Health',
    icon: Activity,
    keywords: ['status', 'working', 'errors', 'api', 'check'],
    purpose: 'Is everything working?',
  },
  {
    to: '/admin/runs',
    label: 'Runs and cost',
    icon: ListChecks,
    keywords: ['spend', 'chart'],
    purpose: 'What each run found, and what it cost.',
  },
  {
    to: '/admin/schedules',
    label: 'Schedules',
    icon: CalendarClock,
    keywords: ['automatic', 'every', 'fortnight', 'daily', 'round', 'budget'],
    purpose: 'What starts on its own, and when.',
  },
  {
    to: '/admin/searches',
    label: 'Search log',
    icon: FileSearch,
    keywords: ['claude', 'sources'],
    purpose: 'Every request to Claude, and where the money went.',
  },
  {
    to: '/admin/memory',
    label: 'Memory',
    icon: Database,
    keywords: ['notes', 'search'],
    purpose: 'What the engine remembers from past research.',
  },
  {
    to: '/admin/hubspot',
    label: 'HubSpot',
    icon: Upload,
    keywords: ['import', 'watchlist'],
    purpose: 'The connection, the syncs and the writes.',
  },
  {
    to: '/admin/people',
    label: 'People',
    icon: Users,
    keywords: ['accounts', 'access', 'users', 'staff'],
    purpose: 'Who can sign in, and which projects each may use.',
  },
  {
    to: '/admin/settings',
    label: 'Settings',
    icon: SlidersHorizontal,
    keywords: ['caps', 'models'],
    purpose: 'Spending limits, models, and how much runs at once.',
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
