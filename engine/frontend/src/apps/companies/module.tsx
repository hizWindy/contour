/**
 * The Companies page as a module of the website (PLAN-V10 B1): every client and prospect in
 * HubSpot, a panel for each, and call prep. The router, the sidebar, the command menu and Home
 * read it from src/modules.ts.
 *
 * The module is called **Relationships** in the menu (Al-khair, 17 Nov 2026: "think of a really
 * good name"). It holds Companies, Meetings and Call logs, which are all about the people and
 * firms Contour works with, so a name for the group that was also the name of its first page read
 * as "Companies, Companies". Relationships covers a prospect, a client and a firm met only once,
 * and keeps working when a page is added. The pages keep their names, and so do the addresses
 * (`/companies/...`): old links, bookmarks and the morning email's pre-read link still work. The
 * Companies page is still "Companies" in its title, its breadcrumb and Home's card.
 *
 * Its other pages are Meetings (PLAN-V17 T3-9, `/companies/meetings`): the client meetings and
 * their pre-reads, and Call logs (T3-6, `/companies/call-logs`; called Activity, at
 * `/companies/activity`, until PLAN-V18 T3-2, and the old address sends you on): the calls a rep
 * logged, to confirm, send to HubSpot in one go, and look back at. Their addresses sit before a
 * company's (`:key`), so neither is ever read as a company. Relationships is a group in the menu
 * (Companies, Meetings, Call logs), after the Lead Finder's, in the order of MODULES, as on Home
 * and in Ctrl+K (T3-7). Meetings and Call logs stay in the group for everyone who sees
 * Relationships, even while their switches are off (each page says so), so the menu never changes shape once it
 * has loaded. A pre-read's own page sits under Meetings (`/companies/meetings/{form_id}`, T3-10),
 * so the menu marks Meetings there. Call logs' row shows how many calls wait to be confirmed, and
 * Ctrl+K gains "Log a call" and "Calls to confirm" (`call-note-links.tsx`, which loads late through
 * `call-note-parts.ts`, so the first visit doesn't grow). Ctrl+K still finds Call logs by
 * "activity", so old habits work. With pre-meeting forms on (T3-11), Home gains "Upcoming
 * meetings", a card that comes late and goes after the others, and Ctrl+K "Pre-read for a
 * meeting", loaded the same way.
 */
import { Building2, CalendarCheck, Handshake, PhoneLog } from 'lucide-react'
import type { PrefetchArgs, RouteHandle } from '@/shell/crumbs'
import type { AppModule } from '@/shell/nav'
import { page } from '@/shell/page-route'
import {
  CompaniesCommands,
  MicCheckHost,
  MicCheckMenuItem,
  ToConfirmCount,
  UpcomingMeetings,
} from './call-note-parts'
import { OLD_PATH } from './call-logs/old-address'
import { OldActivityAddress } from './call-logs/old-route'
import { CompaniesHomeCard } from './home-card'
import { prefetchCompanies, prefetchCompaniesHome, prefetchCompany } from './prefetch'

/** The pages' addresses, as in each page's `params.ts`, which loads with the page, not here. */
const MEETINGS = '/companies/meetings'
const CALL_LOGS = '/companies/call-logs'

type Prefetch = (args: PrefetchArgs) => void

/**
 * A page's prefetch whose query options load with it, in a small file of its own: this module is
 * in the first visit, and the call notes and meetings hooks are not (T3-5's rule).
 */
function late(load: () => Promise<Prefetch>): Prefetch {
  return (args) => {
    void load()
      .then((start) => {
        start(args)
      })
      .catch(() => undefined)
  }
}

const prefetchMeetings = late(async () => (await import('./meetings/prefetch')).prefetchMeetings)
const prefetchPreRead = late(async () => (await import('./meetings/prefetch')).prefetchPreRead)
const prefetchCallLogs = late(async () => (await import('./call-logs/prefetch')).prefetchCallLogs)

export const COMPANIES: AppModule = {
  id: 'companies',
  app: 'companies',
  // The group's name and icon. Its first page keeps the name Companies and the building.
  name: 'Relationships',
  icon: Handshake,
  tone: 'companies',
  homeCards: [
    { id: 'companies', component: CompaniesHomeCard },
    { id: 'meetings', component: UpcomingMeetings, late: true },
  ],
  prefetchSummary: prefetchCompaniesHome,
  // Its pages' first reads are cheap, so while someone is on one, the code and first reads of the
  // others are fetched quietly (Improvements 1, #10): a switch between them finds both.
  warm: true,
  description:
    'Every client and prospect in HubSpot, a call script before you ring, your client meetings and the calls you logged.',
  pages: [
    {
      to: '/companies',
      label: 'Companies',
      icon: Building2,
      features: ['companies.companies'],
      keywords: ['clients', 'prospects', 'call', 'prep', 'script', 'hubspot'],
      purpose: 'Find a company, see what we know, and prep a call in seconds.',
      notActiveOn: [MEETINGS, CALL_LOGS, OLD_PATH],
    },
    {
      to: MEETINGS,
      label: 'Meetings',
      icon: CalendarCheck,
      features: ['companies.meetings'],
      keywords: ['pre-read', 'pre-meeting form', 'client meeting', 'teams', 'in person'],
      purpose: 'Draft the pre-read for each client meeting, then send it to the team.',
    },
    {
      to: CALL_LOGS,
      label: 'Call logs',
      icon: PhoneLog,
      features: ['companies.call_logs'],
      // "activity" is its old name (PLAN-V18 T3-2), so old habits still find it.
      keywords: ['activity', 'call notes', 'log a call', 'confirm', 'history', 'send', 'hubspot'],
      purpose: 'Check the calls you logged, send them to HubSpot, and look back at old ones.',
      count: ToConfirmCount,
    },
  ],
  commands: CompaniesCommands,
  // "Check my mic" (PLAN-V18 T3-4): a row in the account menu, and the card it opens.
  accountItems: MicCheckMenuItem,
  frame: MicCheckHost,
  routes: [
    {
      path: 'companies',
      // The group's name, so Meetings reads "Relationships > Meetings" and Companies below it.
      handle: { crumb: 'Relationships' } satisfies RouteHandle,
      children: [
        {
          index: true,
          handle: { crumb: 'Companies', prefetch: prefetchCompanies } satisfies RouteHandle,
          ...page(() => import('./index')),
        },
        {
          // Before `:key`, so these addresses are never read as a company.
          path: 'meetings',
          handle: { crumb: 'Meetings' } satisfies RouteHandle,
          children: [
            {
              index: true,
              handle: { prefetch: prefetchMeetings } satisfies RouteHandle,
              ...page(() => import('./meetings')),
            },
            {
              // A pre-read's own page (T3-10), where Track 2's morning email links.
              path: ':formId',
              handle: { crumb: 'Pre-read', prefetch: prefetchPreRead } satisfies RouteHandle,
              ...page(() => import('./meetings/pre-read')),
            },
          ],
        },
        {
          path: 'call-logs',
          handle: { crumb: 'Call logs', prefetch: prefetchCallLogs } satisfies RouteHandle,
          ...page(() => import('./call-logs')),
        },
        {
          // Call logs' old address (PLAN-V17): sent on with its tab and `log=1`.
          path: 'activity',
          element: <OldActivityAddress />,
        },
        {
          // A company has its own address, so it can be shared. The list also opens it in a panel.
          path: ':key',
          handle: { crumb: 'Company', prefetch: prefetchCompany } satisfies RouteHandle,
          ...page(() => import('./company-page')),
        },
      ],
    },
  ],
}
