/**
 * The Companies page as a module of the website (PLAN-V10 B1): every client and prospect in
 * HubSpot, a panel for each, and call prep. The router, the sidebar, the command menu and Home
 * read it from src/modules.ts.
 *
 * Its other pages are Meetings (PLAN-V17 T3-9, `/companies/meetings`): the client meetings and
 * their pre-reads, and Activity (T3-6, `/companies/activity`): the calls a rep logged, to confirm
 * and send to HubSpot in one go. Their addresses sit before a company's (`:key`), so neither is
 * ever read as a company. Companies is a group in the menu (Companies, Meetings, Activity), after
 * the Lead Finder's, in the order of MODULES, as on Home and in Ctrl+K (T3-7). Meetings and
 * Activity stay in the group for everyone who sees Companies, even while their switches are off
 * (each page says so), so the menu never changes shape once it has loaded. A pre-read's own page
 * sits under Meetings (`/companies/meetings/{form_id}`, T3-10), so the menu marks Meetings there.
 * Activity's row shows how many calls wait to be confirmed, and Ctrl+K gains "Log a call" and
 * "Calls to confirm" (`call-note-links.tsx`, which loads late through `call-note-parts.ts`, so the
 * first visit doesn't grow).
 */
import { Building2, CalendarCheck, ClipboardCheck } from 'lucide-react'
import type { PrefetchArgs, RouteHandle } from '@/shell/crumbs'
import type { AppModule } from '@/shell/nav'
import { page } from '@/shell/page-route'
import { CallNoteCommands, ToConfirmCount } from './call-note-parts'
import { CompaniesHomeCard } from './home-card'
import { prefetchCompanies, prefetchCompaniesHome, prefetchCompany } from './prefetch'

/** The pages' addresses, as in each page's `params.ts`, which loads with the page, not here. */
const MEETINGS = '/companies/meetings'
const ACTIVITY = '/companies/activity'

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
const prefetchPreRead = late(
  async () => (await import('./meetings/pre-read/prefetch')).prefetchPreRead,
)
const prefetchActivity = late(async () => (await import('./activity/prefetch')).prefetchActivity)

export const COMPANIES: AppModule = {
  id: 'companies',
  app: 'companies',
  name: 'Companies',
  icon: Building2,
  tone: 'companies',
  homeCards: [{ id: 'companies', component: CompaniesHomeCard }],
  prefetchSummary: prefetchCompaniesHome,
  description:
    'Every client and prospect in HubSpot, with what we know about each, and a call script before you ring.',
  pages: [
    {
      to: '/companies',
      label: 'Companies',
      icon: Building2,
      keywords: ['clients', 'prospects', 'call', 'prep', 'script', 'hubspot'],
      purpose: 'Find a company, see what we know, and prep a call in seconds.',
      notActiveOn: [MEETINGS, ACTIVITY],
    },
    {
      to: MEETINGS,
      label: 'Meetings',
      icon: CalendarCheck,
      keywords: ['pre-read', 'pre-meeting form', 'client meeting', 'teams', 'in person'],
      purpose: 'Draft the pre-read for each client meeting, then send it to the team.',
    },
    {
      to: ACTIVITY,
      label: 'Activity',
      icon: ClipboardCheck,
      keywords: ['call notes', 'log a call', 'confirm', 'logged', 'send', 'hubspot'],
      purpose: 'Check the calls you logged, then send them to HubSpot in one go.',
      count: ToConfirmCount,
    },
  ],
  commands: CallNoteCommands,
  routes: [
    {
      path: 'companies',
      handle: { crumb: 'Companies' } satisfies RouteHandle,
      children: [
        {
          index: true,
          handle: { prefetch: prefetchCompanies } satisfies RouteHandle,
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
          path: 'activity',
          handle: { crumb: 'Activity', prefetch: prefetchActivity } satisfies RouteHandle,
          ...page(() => import('./activity')),
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
