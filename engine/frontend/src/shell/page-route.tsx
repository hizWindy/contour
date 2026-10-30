/**
 * The route part every page shares: it loads the page's code on first visit (a `lazy` route) and
 * has its own error page, so one broken page keeps the menu working. The router and each project's
 * module (src/apps/<name>/module.tsx) build their routes with it.
 */
import type { ComponentType } from 'react'
import type { RouteObject } from 'react-router'
import { RouteError } from './route-error'

export type PageModule = { default: ComponentType }

/**
 * A route that loads its page module when it is first visited.
 *
 * If the page's code can't be fetched (the dev server's "Outdated Optimize Dep", or a new build
 * that replaced the old files), React Router 8.5 records the error but draws nothing, not even
 * `errorElement`. So the failure is handed to a component that throws it while drawing, which the
 * error page does catch: the person sees "This page couldn't be shown" and a reload button.
 */
export function page(load: () => Promise<PageModule>): Pick<RouteObject, 'lazy' | 'errorElement'> {
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
