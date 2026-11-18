/**
 * The Companies page as a module of the website (PLAN-V10 B1): every client and prospect in
 * HubSpot, a panel for each, and call prep. The router, the sidebar, the command menu and Home
 * read it from src/modules.ts.
 *
 * Since PLAN-V22 (T2-1) it holds only the Companies page, so the menu shows it as one link right
 * after Home (a one-page module is a plain link). Meetings and Call logs moved to the Assistant
 * (`apps/assistant/module.tsx`), at `/assistant/...`, with their Ctrl+K entries, the mic check and
 * the late prefetches. Their code stays in this folder (PLAN-V22 choice 3), because it shares parts
 * with call prep and the company record (`note-view.tsx`, `company-meetings.tsx`). The menu group
 * "Relationships" (17 Nov 2026) is gone with them, and the module is called Companies again.
 *
 * Its old addresses for Meetings and Call logs (`/companies/meetings...`, `/companies/call-logs`
 * and `/companies/activity`) send you on to the Assistant's (`apps/assistant/old-addresses.ts`).
 * Each is more exact than a company's own address (`:key`), so none is ever read as a company.
 *
 * Home keeps its two cards here until the Assistant has a Home card of its own (T2-3): the
 * Companies card, with Call logs' quick buttons for a person who has the Call logs tick, and
 * "Upcoming meetings", a card that comes late and goes after the others.
 */
import { Building2 } from 'lucide-react'
import { OLD_PATHS } from '@/apps/assistant/old-addresses'
import { UpcomingMeetings } from '@/apps/assistant/parts'
import type { RouteHandle } from '@/shell/crumbs'
import type { AppModule } from '@/shell/nav'
import { page } from '@/shell/page-route'
import { CompaniesHomeCard } from './home-card'
import { prefetchCompanies, prefetchCompaniesHome, prefetchCompany } from './prefetch'

export const COMPANIES: AppModule = {
  id: 'companies',
  app: 'companies',
  name: 'Companies',
  icon: Building2,
  tone: 'companies',
  homeCards: [
    { id: 'companies', component: CompaniesHomeCard },
    { id: 'meetings', component: UpcomingMeetings, late: true },
  ],
  prefetchSummary: prefetchCompaniesHome,
  // On Home, its page's code is fetched quietly (Improvements 1, #10), so the first click finds it.
  warm: true,
  description: 'Every client and prospect in HubSpot, and a call script before you ring.',
  pages: [
    {
      to: '/companies',
      label: 'Companies',
      icon: Building2,
      features: ['companies.companies'],
      // "relationships": the menu group it sat in until PLAN-V22, so old habits still find it.
      keywords: ['clients', 'prospects', 'call', 'prep', 'script', 'hubspot', 'relationships'],
      purpose: 'Find a company, see what we know, and prep a call in seconds.',
      // The Assistant's old addresses sit inside this one for the moment they send you on.
      notActiveOn: OLD_PATHS,
    },
  ],
  routes: [
    {
      path: 'companies',
      handle: { crumb: 'Companies' } satisfies RouteHandle,
      children: [
        {
          index: true,
          handle: { crumb: 'Companies', prefetch: prefetchCompanies } satisfies RouteHandle,
          ...page(() => import('./index')),
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
