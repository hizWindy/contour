/**
 * The website's addresses. Every page loads on demand (a `lazy` route), has its own error page
 * (one broken page keeps the menu working) and names itself in the breadcrumbs (`handle.crumb`).
 *
 * Each page lives in its own folder under src/apps/lead-finder/ and exports one default
 * component. The page builders replace those files; this table stays as it is.
 */
import type { ComponentType } from 'react'
import { createBrowserRouter, Navigate, type RouteObject } from 'react-router'
import { AppFrame } from '@/shell/app-frame'
import { shortId } from '@/lib/format'
import type { RouteHandle } from '@/shell/crumbs'
import { adminTabLabel } from '@/shell/nav'
import { NotFound, PageLoading, RouteError } from '@/shell/route-error'

type PageModule = { default: ComponentType }

/**
 * A route that loads its page module when it is first visited.
 *
 * If the page's code can't be fetched (the dev server's "Outdated Optimize Dep", or a new build
 * that replaced the old files), React Router 8.5 records the error but draws nothing, not even
 * `errorElement`. So the failure is handed to a component that throws it while drawing, which the
 * error page does catch: the person sees "This page couldn't be shown" and a reload button.
 */
function page(load: () => Promise<PageModule>): Pick<RouteObject, 'lazy' | 'errorElement'> {
  return {
    lazy: async () => {
      try {
        return { Component: (await load()).default }
      } catch (error) {
        return {
          Component: function PageCodeFailed(): never {
            throw error
          },
        }
      }
    },
    errorElement: <RouteError />,
  }
}

function adminTab(segment: string, load: () => Promise<PageModule>): RouteObject {
  const handle: RouteHandle = { crumb: adminTabLabel(segment) ?? segment }
  return { path: segment, handle, ...page(load) }
}

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppFrame />,
    errorElement: <RouteError />,
    hydrateFallbackElement: <PageLoading />,
    children: [
      { index: true, element: <Navigate to="/start" replace /> },
      {
        path: 'start',
        handle: { crumb: 'Start a run' } satisfies RouteHandle,
        ...page(() => import('@/apps/lead-finder/start')),
      },
      {
        path: 'runs',
        handle: { crumb: 'Runs' } satisfies RouteHandle,
        children: [
          { index: true, ...page(() => import('@/apps/lead-finder/run/list')) },
          {
            path: ':runId',
            handle: {
              crumb: (params) => `Run ${shortId(params.runId ?? '')}`,
            } satisfies RouteHandle,
            ...page(() => import('@/apps/lead-finder/run')),
          },
        ],
      },
      {
        path: 'results',
        handle: { crumb: 'Results' } satisfies RouteHandle,
        ...page(() => import('@/apps/lead-finder/results')),
      },
      {
        // A lead card has its own address, so it can be shared. Results also opens it in a panel.
        path: 'leads/:leadId',
        handle: { crumb: 'Lead' } satisfies RouteHandle,
        ...page(() => import('@/apps/lead-finder/lead')),
      },
      {
        path: 'admin',
        handle: { crumb: 'Admin' } satisfies RouteHandle,
        ...page(() => import('@/apps/lead-finder/admin')),
        children: [
          { index: true, element: <Navigate to="runs" replace /> },
          adminTab('runs', () => import('@/apps/lead-finder/admin/runs')),
          adminTab('searches', () => import('@/apps/lead-finder/admin/searches')),
          adminTab('memory', () => import('@/apps/lead-finder/admin/memory')),
          adminTab('hubspot', () => import('@/apps/lead-finder/admin/hubspot')),
          adminTab('rules', () => import('@/apps/lead-finder/admin/rules')),
          adminTab('tests', () => import('@/apps/lead-finder/admin/tests')),
          adminTab('settings', () => import('@/apps/lead-finder/admin/settings')),
        ],
      },
      { path: '*', element: <NotFound />, handle: { crumb: 'Not found' } satisfies RouteHandle },
    ],
  },
]

/** The router the app uses: real browser addresses and history. */
export function createAppRouter(): ReturnType<typeof createBrowserRouter> {
  return createBrowserRouter(routes)
}
