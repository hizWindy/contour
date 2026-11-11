/**
 * The route part every page shares: it loads the page's code on first visit (a `lazy` route) and
 * has its own error page, so one broken page keeps the menu working. The router and each project's
 * module (src/apps/<name>/module.tsx) build their routes with it.
 */
import { onlineManager } from '@tanstack/react-query'
import type { ComponentType } from 'react'
import type { RouteObject } from 'react-router'
import { isCodeLoadError, reloadOnceForNewCode } from '@/lib/reload'
import { ReloadingPage } from './error-pages/pages'
import { RouteError } from './route-error'

export type PageModule = { default: ComponentType }

/**
 * A route that loads its page module when it is first visited.
 *
 * If the page's code can't be fetched, React Router 8.5 records the error but draws nothing, not
 * even `errorElement`. So the failure is handed to a component that throws it while drawing, which
 * the error page does catch.
 *
 * After a deploy (PLAN-V15 T2-4), an open tab asks for code files the new version no longer has.
 * Online, the page reloads itself once to get the new version ("Contour was updated. Reloading…").
 * If its code still fails within a minute, the error page says "Contour was updated" with a Reload
 * button. Offline, the code simply couldn't come: the error page says so and reloads when the
 * connection is back.
 */
export function page(load: () => Promise<PageModule>): Pick<RouteObject, 'lazy' | 'errorElement'> {
  return {
    lazy: async () => {
      try {
        return { Component: (await load()).default }
      } catch (error) {
        if (isCodeLoadError(error) && onlineManager.isOnline() && reloadOnceForNewCode()) {
          return { Component: ReloadingPage }
        }
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
