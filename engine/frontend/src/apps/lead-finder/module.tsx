/**
 * The Lead Finder as a module of the website: its menu pages and its addresses. The router, the
 * sidebar, the command menu and Home read it from src/modules.ts.
 *
 * Its own admin lives here too (Rules and the Test set). Admin in the menu holds only what every
 * project shares.
 */
import { FlaskConical, ListChecks, MapPinned, ScrollText, Table2, Target } from 'lucide-react'
import { Navigate } from 'react-router'
import { shortId } from '@/lib/format'
import type { RouteHandle } from '@/shell/crumbs'
import type { AppModule } from '@/shell/nav'
import { page } from '@/shell/page-route'

export const LEAD_FINDER: AppModule = {
  id: 'lead-finder',
  name: 'Lead Finder',
  icon: Target,
  description:
    'Finds companies that fit Contour and show signs of an office change, and ranks them for sales.',
  pages: [
    { to: '/start', label: 'Start a run', icon: MapPinned, keywords: ['new', 'discovery', 'map'] },
    { to: '/runs', label: 'Runs', icon: ListChecks, keywords: ['progress', 'live', 'history'] },
    {
      to: '/results',
      label: 'Results',
      icon: Table2,
      keywords: ['leads', 'table', 'csv', 'export'],
      alsoActiveOn: ['/leads'],
    },
    { to: '/rules', label: 'Rules', icon: ScrollText, keywords: ['criteria', 'tbc'] },
    { to: '/test-set', label: 'Test set', icon: FlaskConical, keywords: ['tests', 'scores'] },
  ],
  routes: [
    {
      path: 'start',
      handle: { crumb: 'Start a run' } satisfies RouteHandle,
      ...page(() => import('./start')),
    },
    {
      path: 'runs',
      handle: { crumb: 'Runs' } satisfies RouteHandle,
      children: [
        { index: true, ...page(() => import('./run/list')) },
        {
          path: ':runId',
          handle: {
            crumb: (params) => `Run ${shortId(params.runId ?? '')}`,
          } satisfies RouteHandle,
          ...page(() => import('./run')),
        },
      ],
    },
    {
      path: 'results',
      handle: { crumb: 'Results' } satisfies RouteHandle,
      ...page(() => import('./results')),
    },
    {
      // A lead card has its own address, so it can be shared. Results also opens it in a panel.
      path: 'leads/:leadId',
      handle: { crumb: 'Lead' } satisfies RouteHandle,
      ...page(() => import('./lead')),
    },
    {
      path: 'rules',
      handle: { crumb: 'Rules' } satisfies RouteHandle,
      ...page(() => import('./rules')),
    },
    {
      path: 'test-set',
      handle: { crumb: 'Test set' } satisfies RouteHandle,
      ...page(() => import('./test-set')),
    },
    // Rules and the Test set were Admin tabs. Their old addresses still work.
    { path: 'admin/rules', element: <Navigate to="/rules" replace /> },
    { path: 'admin/tests', element: <Navigate to="/test-set" replace /> },
  ],
}
