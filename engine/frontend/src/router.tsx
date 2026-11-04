/**
 * The website's addresses. Every page loads on demand (a `lazy` route, see shell/page-route.tsx),
 * has its own error page (one broken page keeps the menu working) and names itself in the
 * breadcrumbs (`handle.crumb`).
 *
 * Home and Admin are shared. Each project brings its own addresses in its module (src/modules.ts),
 * so this table doesn't change when a project is added. A project still to be developed gets one
 * page that says so.
 */
import { createBrowserRouter, Navigate, type RouteObject } from 'react-router'
import { MODULES, PLANNED } from '@/modules'
import { AppFrame } from '@/shell/app-frame'
import type { RouteHandle } from '@/shell/crumbs'
import { adminTabLabel } from '@/shell/nav'
import { page, type PageModule } from '@/shell/page-route'
import { NotFound, PageLoading, RouteError } from '@/shell/route-error'

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
      {
        index: true,
        handle: { crumb: 'Home' } satisfies RouteHandle,
        ...page(() => import('@/shell/home')),
      },
      ...MODULES.flatMap((app) => app.routes),
      // A project still to be developed has one page, at the address it will use.
      ...PLANNED.map((project): RouteObject => ({
        path: project.to.slice(1),
        handle: { crumb: project.name } satisfies RouteHandle,
        ...page(() => import('@/shell/planned')),
      })),
      {
        path: 'admin',
        handle: { crumb: 'Admin' } satisfies RouteHandle,
        ...page(() => import('@/apps/lead-finder/admin')),
        children: [
          { index: true, element: <Navigate to="runs" replace /> },
          adminTab('runs', () => import('@/apps/lead-finder/admin/runs')),
          adminTab('schedules', () => import('@/apps/lead-finder/admin/schedules')),
          adminTab('searches', () => import('@/apps/lead-finder/admin/searches')),
          adminTab('memory', () => import('@/apps/lead-finder/admin/memory')),
          adminTab('hubspot', () => import('@/apps/lead-finder/admin/hubspot')),
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
