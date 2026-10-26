import { CircleQuestionMark } from 'lucide-react'
import { isRouteErrorResponse, Link, useRouteError } from 'react-router'
import { ApiProblem, isApiProblem } from '@/api/client'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { Button } from '@/components/ui/button'

/** A page for an address the website does not have. */
export function NotFound() {
  return (
    <EmptyState
      icon={CircleQuestionMark}
      title="This page doesn't exist."
      description="Check the address, or go back to the start."
      headingLevel={1}
      action={
        <Button asChild variant="outline" size="sm">
          <Link to="/start">Start a run</Link>
        </Button>
      }
    />
  )
}

/**
 * What a page shows when it fails to load or breaks while it draws: a plain message and a way
 * to try again, never a stack trace. Each route has it, so one broken page keeps the menu working.
 */
export function RouteError() {
  const error = useRouteError()
  if (isRouteErrorResponse(error) && error.status === 404) {
    return <NotFound />
  }
  // A failed call explains itself. Anything else broke inside the page (or its code didn't load),
  // which is not the backend's fault, so it gets its own plain words.
  const shown = isApiProblem(error)
    ? error
    : new ApiProblem({
        title: "This page couldn't be shown",
        detail: 'Reload the page. If it keeps happening, tell the team.',
        status: 0,
        code: 'page_error',
      })
  return (
    <ErrorState
      error={shown}
      onRetry={() => {
        window.location.reload()
      }}
      retryLabel="Reload the page"
    />
  )
}

/** Shown while the first page of a visit loads. */
export function PageLoading() {
  return (
    <p role="status" className="p-6 text-ui text-muted-foreground">
      Loading the page.
    </p>
  )
}
