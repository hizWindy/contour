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
import { LeadFinderSummary } from './home-summary'
import {
  prefetchLead,
  prefetchLeadFinderSummary,
  prefetchResults,
  prefetchRules,
  prefetchRun,
  prefetchRuns,
  prefetchStart,
} from './prefetch'

export const LEAD_FINDER: AppModule = {
  id: 'lead-finder',
  name: 'Lead Finder',
  icon: Target,
  tone: 'lead',
  summary: LeadFinderSummary,
  prefetchSummary: prefetchLeadFinderSummary,
  description:
    'Finds companies that fit Contour and show signs of an office change, and ranks them for sales.',
  pages: [
    {
      to: '/start',
      label: 'Start a run',
      icon: MapPinned,
      keywords: ['new', 'discovery', 'map'],
      purpose: 'Pick cities and signs, see the cost, then start.',
    },
    {
      to: '/runs',
      label: 'Runs',
      icon: ListChecks,
      keywords: ['progress', 'live', 'history'],
      purpose: 'Every run, newest first, with its progress and cost.',
    },
    {
      to: '/results',
      label: 'Results',
      icon: Table2,
      keywords: ['leads', 'table', 'csv', 'export'],
      alsoActiveOn: ['/leads'],
      purpose: 'Every lead, best first. Open one to see why it fits.',
    },
    {
      to: '/rules',
      label: 'Rules',
      icon: ScrollText,
      keywords: ['criteria', 'tbc'],
      purpose: 'What decides each result: cities, size and signs. Read only.',
    },
    {
      to: '/test-set',
      label: 'Test set',
      icon: FlaskConical,
      keywords: ['tests', 'scores'],
      purpose: '10 public companies, to check the scores still hold.',
    },
  ],
  routes: [
    {
      path: 'start',
      handle: { crumb: 'Start a run', prefetch: prefetchStart } satisfies RouteHandle,
      ...page(() => import('./start')),
    },
    {
      path: 'runs',
      handle: { crumb: 'Runs' } satisfies RouteHandle,
      children: [
        {
          index: true,
          handle: { prefetch: prefetchRuns } satisfies RouteHandle,
          ...page(() => import('./run/list')),
        },
        {
          path: ':runId',
          handle: {
            crumb: (params) => `Run ${shortId(params.runId ?? '')}`,
            prefetch: prefetchRun,
          } satisfies RouteHandle,
          ...page(() => import('./run')),
        },
      ],
    },
    {
      path: 'results',
      handle: { crumb: 'Results', prefetch: prefetchResults } satisfies RouteHandle,
      ...page(() => import('./results')),
    },
    {
      // A lead card has its own address, so it can be shared. Results also opens it in a panel.
      path: 'leads/:leadId',
      handle: { crumb: 'Lead', prefetch: prefetchLead } satisfies RouteHandle,
      ...page(() => import('./lead')),
    },
    {
      path: 'rules',
      handle: { crumb: 'Rules', prefetch: prefetchRules } satisfies RouteHandle,
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
