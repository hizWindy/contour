/**
 * The Companies page as a module of the website (PLAN-V10 B1): every client and prospect in
 * HubSpot, a panel for each, and call prep. The router, the sidebar, the command menu and Home
 * read it from src/modules.ts.
 *
 * Activity (PLAN-V17 T3-6, `/companies/activity`) is its second page: the calls a rep logged, to
 * confirm and send to HubSpot in one go. Its address sits before a company's (`:key`), so
 * "/companies/activity" never reads as a company. With two pages, Companies is a group in the menu,
 * after the Lead Finder's, in the order of MODULES, as on Home and in Ctrl+K (T3-7). Activity stays
 * in the group for everyone who sees Companies, even while call notes are off (the page says so),
 * so the menu never changes shape once it has loaded. Its row shows how many calls wait to be
 * confirmed, and Ctrl+K gains "Log a call" and "Calls to confirm" (`call-note-links.tsx`, which
 * loads late through `call-note-parts.ts`, so the first visit doesn't grow).
 */
import { Building2, ClipboardCheck } from 'lucide-react'
import type { PrefetchArgs, RouteHandle } from '@/shell/crumbs'
import type { AppModule } from '@/shell/nav'
import { page } from '@/shell/page-route'
import { CallNoteCommands, ToConfirmCount } from './call-note-parts'
import { CompaniesHomeCard } from './home-card'
import { prefetchCompanies, prefetchCompaniesHome, prefetchCompany } from './prefetch'

/** Activity's address, as in `activity/params.ts`, which loads with the page, not here. */
const ACTIVITY = '/companies/activity'

/**
 * What Activity asks for first. Its query options load with them, in a small file of their own,
 * because this module is in the first visit and the call notes hooks are not (T3-5's rule).
 */
function prefetchActivity(args: PrefetchArgs): void {
  void import('./activity/prefetch')
    .then(({ prefetchActivity: start }) => {
      start(args)
    })
    .catch(() => undefined)
}

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
      notActiveOn: [ACTIVITY],
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
          // Before `:key`, so this address is never read as a company.
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
