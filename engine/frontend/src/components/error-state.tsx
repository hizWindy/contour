import { QueryClientContext, type QueryClient } from '@tanstack/react-query'
import { CloudOff, TriangleAlert } from 'lucide-react'
import { useContext } from 'react'
import { Link, useInRouterContext } from 'react-router'
import { toApiProblem } from '@/api/client'
import { problemKind, runFailedReadsAgain } from '@/api/connection'
import { SupportDetails } from '@/components/support-details'
import { Button } from '@/components/ui/button'
import { humanise } from '@/lib/format'
import { problemHint } from '@/lib/problems'
import { browser } from '@/lib/reload'
import { cn } from '@/lib/utils'

export interface ErrorStateProps {
  /** What was thrown. An `ApiProblem` shows its own words. Anything else shows a generic message. */
  error: unknown
  /** What the page was doing, like "The runs could not be loaded." Shown under the title. */
  context?: string
  /**
   * What "Try again" does. Without one, it asks again for every read on screen that failed, which
   * is what a page's own retry would do.
   */
  onRetry?: () => void
  retryLabel?: string
  className?: string
}

const FIELD_PREFIXES = ['body.params.', 'body.', 'values.', 'query.']

function fieldLabel(field: string): string {
  const prefix = FIELD_PREFIXES.find((candidate) => field.startsWith(candidate))
  const name = prefix ? field.slice(prefix.length) : field
  return name === '' ? 'Request' : humanise(name)
}

/** Asks again for the failed reads on screen. With no query client (a bare test), it reloads. */
function retryFailedReads(client: QueryClient | undefined): void {
  if (client) {
    runFailedReadsAgain(client)
  } else {
    browser.reload()
  }
}

/**
 * A failed call, in plain words (PLAN-V15 "Words for errors"): the title, what to do next (the
 * backend's `detail`, and a hint for a known `code`), and the wrong fields of a 422. "Try again"
 * is always there. The technical part (status, code, request id, time, page) is folded away under
 * "Details for support", with a Copy button, for whoever helps. It never shows a stack trace or
 * text the backend did not mean for a person.
 *
 * When the connection itself is the problem (offline, the server out of reach, or updating), the
 * bar at the top of the app says so once (T2-4). Each card then shows a quiet line instead of a
 * red box, so an outage doesn't turn the whole page red.
 */
export function ErrorState({ error, context, onRetry, retryLabel, className }: ErrorStateProps) {
  const problem = toApiProblem(error)
  const hint = problemHint(problem)
  const inRouter = useInRouterContext()
  const queryClient = useContext(QueryClientContext)
  const retry =
    onRetry ??
    (() => {
      retryFailedReads(queryClient)
    })
  const kind = problemKind(problem)
  if (kind === 'offline' || kind === 'unreachable' || kind === 'updating') {
    return (
      <div
        role="status"
        data-slot="error-state"
        data-code={problem.code ?? undefined}
        className={cn(
          'flex items-start gap-3 rounded-lg border bg-card p-4 text-ui text-muted-foreground',
          className,
        )}
      >
        <CloudOff aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="font-semibold text-foreground">{problem.title}</p>
          {context ? <p>{context}</p> : null}
          <p>The bar at the top shows when the connection is back.</p>
          <div className="mt-2">
            <Button type="button" variant="outline" size="sm" onClick={retry}>
              {retryLabel ?? 'Try again'}
            </Button>
          </div>
        </div>
      </div>
    )
  }
  return (
    <div
      role="alert"
      data-slot="error-state"
      data-code={problem.code ?? undefined}
      className={cn(
        'flex items-start gap-3 rounded-lg border border-destructive bg-destructive-soft p-4 text-ui text-destructive-ink',
        className,
      )}
    >
      <TriangleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="font-semibold">{problem.title}</p>
        {context ? <p>{context}</p> : null}
        {problem.detail ? <p>{problem.detail}</p> : null}
        {hint ? <p>{hint}</p> : null}
        {problem.errors.length > 0 ? (
          <ul className="list-disc pl-5">
            {problem.errors.map((item, index) => (
              <li key={`${item.field}-${index}`}>
                <span className="font-semibold">{fieldLabel(item.field)}</span>: {item.message}
              </li>
            ))}
          </ul>
        ) : null}
        {problem.run_id && inRouter ? (
          <p>
            <Link
              to={`/runs/${encodeURIComponent(problem.run_id)}`}
              className="rounded-sm font-semibold underline underline-offset-4"
            >
              Open the run
            </Link>
          </p>
        ) : null}
        <div className="mt-2">
          <Button type="button" variant="outline" size="sm" onClick={retry}>
            {retryLabel ?? 'Try again'}
          </Button>
        </div>
        <SupportDetails problem={problem} className="mt-2" />
      </div>
    </div>
  )
}
