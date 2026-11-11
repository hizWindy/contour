import { QueryClientContext, type QueryClient } from '@tanstack/react-query'
import { Copy, TriangleAlert } from 'lucide-react'
import { useContext, useEffect, useState } from 'react'
import { Link, useInRouterContext } from 'react-router'
import { toApiProblem, type ApiProblem } from '@/api/client'
import { runFailedReadsAgain } from '@/api/connection'
import { Button } from '@/components/ui/button'
import { humanise } from '@/lib/format'
import { problemHint } from '@/lib/problems'
import { supportLines, supportText } from '@/lib/support'
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
    window.location.reload()
  }
}

/** The folded "Details for support" part, with a Copy button for all of it. */
function SupportDetails({ problem }: { problem: ApiProblem }) {
  const lines = supportLines(problem)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => {
      setCopied(false)
    }, 2000)
    return () => {
      clearTimeout(timer)
    }
  }, [copied])
  const text = supportText(lines)
  return (
    <details data-slot="support-details" className="mt-2 text-caption">
      <summary className="w-fit cursor-pointer rounded-sm font-semibold underline-offset-4 hover:underline touch:py-2.5">
        Details for support
      </summary>
      <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
        {lines.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="font-semibold">{label}</dt>
            <dd className="break-all tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-2"
        onClick={() => {
          void navigator.clipboard.writeText(text).then(
            () => {
              setCopied(true)
            },
            () => undefined,
          )
        }}
      >
        <Copy aria-hidden="true" />
        <span aria-live="polite">{copied ? 'Copied' : 'Copy the details'}</span>
      </Button>
    </details>
  )
}

/**
 * A failed call, in plain words (PLAN-V15 "Words for errors"): the title, what to do next (the
 * backend's `detail`, and a hint for a known `code`), and the wrong fields of a 422. "Try again"
 * is always there. The technical part (status, code, request id, time, page) is folded away under
 * "Details for support", with a Copy button, for whoever helps. It never shows a stack trace or
 * text the backend did not mean for a person.
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
        <SupportDetails problem={problem} />
      </div>
    </div>
  )
}
