import { useContext } from 'react'
import { useRouteError } from 'react-router'
import { isApiProblem } from '@/api/client'
import { browser } from '@/lib/reload'
import { errorPageKind } from './error-pages/choose'
import {
  ConnectionLostPage,
  NewVersionPage,
  NoAccessPage,
  NotFoundPage,
  PageBrokePage,
  ProblemPage,
  UpdatingPage,
} from './error-pages/pages'
import { InFrameContext } from './in-frame'

/** A page for an address the website does not have (PLAN-V15 T2-4: "Go to Home"). */
export function NotFound() {
  return <NotFoundPage />
}

/**
 * What a page shows when it fails to load or breaks while it draws (PLAN-V15 T2-4): the full
 * error page that fits, never a stack trace. Each route has it, so one broken page keeps the menu
 * working.
 *
 * - A 404 or 403 (a detail page throws those, `throwOnError`): Not found, or No access.
 * - The connection: Connection lost or Updating. Coming back reloads the page: the router keeps a
 *   route's error (and a page's failed code) until the next visit, so a new read wouldn't clear it.
 * - Code gone after a deploy (`page-route.tsx` already reloaded once): New version.
 * - Any other failed answer: its own words, Try again (a reload) and the details for support.
 * - A bug inside the page: "This page couldn't be shown", with a reload.
 */
export function RouteError() {
  const error = useRouteError()
  const standalone = !useContext(InFrameContext)
  const problem = isApiProblem(error) ? error : undefined
  switch (errorPageKind(error)) {
    case 'notFound':
      return <NotFoundPage problem={problem} />
    case 'forbidden':
      return <NoAccessPage problem={problem} />
    case 'connection':
      return <ConnectionLostPage problem={problem} standalone={standalone} reloadWhenBack />
    case 'updating':
      return <UpdatingPage problem={problem} standalone={standalone} reloadWhenBack />
    case 'newVersion':
      return <NewVersionPage />
    case 'problem':
      return problem ? (
        <ProblemPage
          problem={problem}
          standalone={standalone}
          onTryAgain={() => {
            browser.reload()
          }}
        />
      ) : (
        <PageBrokePage />
      )
    case 'page':
      return <PageBrokePage />
  }
}
