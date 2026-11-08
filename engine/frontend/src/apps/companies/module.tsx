/**
 * The Companies page as a module of the website (PLAN-V10 B1): every client and prospect in
 * HubSpot, a panel for each, and call prep. It has one page, so the menu shows it as a plain link
 * under Home. The router, the sidebar, the command menu and Home read it from src/modules.ts.
 */
import { Building2 } from 'lucide-react'
import type { RouteHandle } from '@/shell/crumbs'
import type { AppModule } from '@/shell/nav'
import { page } from '@/shell/page-route'
import { prefetchCompanies, prefetchCompany } from './prefetch'

export const COMPANIES: AppModule = {
  id: 'companies',
  app: 'companies',
  name: 'Companies',
  icon: Building2,
  tone: 'companies',
  description:
    'Every client and prospect in HubSpot, with what we know about each, and a call script before you ring.',
  pages: [
    {
      to: '/companies',
      label: 'Companies',
      icon: Building2,
      keywords: ['clients', 'prospects', 'call', 'prep', 'script', 'hubspot'],
      purpose: 'Find a company, see what we know, and prep a call in seconds.',
    },
  ],
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
          // A company has its own address, so it can be shared. The list also opens it in a panel.
          path: ':key',
          handle: { crumb: 'Company', prefetch: prefetchCompany } satisfies RouteHandle,
          ...page(() => import('./company-page')),
        },
      ],
    },
  ],
}
