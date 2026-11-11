/**
 * The route part every page shares: it loads the page's code on first visit (a `lazy` route) and
 * has its own error page, so one broken page keeps the menu working. The router and each project's
 * module (src/apps/<name>/module.tsx) build their routes with it.
 */
import { onlineManager } from '@tanstack/react-query'
import { useEffect, useState, type ComponentType } from 'react'
import type { RouteObject } from 'react-router'
import { isCodeLoadError, mayReloadForNewCode, reloadForNewCode } from '@/lib/reload'
import { ReloadingPage } from './error-pages/pages'
import { RouteError } from './route-error'

export type PageModule = { default: ComponentType }

/**
 * What a page whose code failed to load draws instead (PLAN-V15 T2-4).
 *
 * After a deploy, an open tab asks for code files the new version no longer has. Online, the page
 * reloads itself once to get the new version ("Contour was updated. Reloading…"). If its code
 * still fails within a minute, the error is thrown to the route's error page, which says "Contour
 * was updated" with a Reload button. Offline, the code simply couldn't come: the error page says
 * so and reloads when the connection is back.
 *
 * The reload happens here, when the page is drawn, and never inside `lazy`: the quiet preloaders
 * (`preload.ts`, `intent.ts`) call `lazy` too, and a preload that fails must not reload the page
 * someone is working on.
 */
function codeFailed(error: unknown): ComponentType {
  return function PageCodeFailed() {
    const [reload] = useState(
      () => isCodeLoadError(error) && onlineManager.isOnline() && mayReloadForNewCode(),
    )
    useEffect(() => {
      if (reload) reloadForNewCode()
    }, [reload])
    if (!reload) {
      throw error
    }
    return <ReloadingPage />
  }
}

/**
 * A route that loads its page module when it is first visited.
 *
 * If the page's code can't be fetched, React Router 8.5 records the error but draws nothing, not
 * even `errorElement`. So the failure is handed to a component that draws it (`codeFailed`), which
 * the error page does catch.
 */
export function page(load: () => Promise<PageModule>): Pick<RouteObject, 'lazy' | 'errorElement'> {
  return {
    lazy: async () => {
      try {
        return { Component: (await load()).default }
      } catch (error) {
        return { Component: codeFailed(error) }
      }
    },
    errorElement: <RouteError />,
  }
}
