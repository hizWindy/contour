import { TriangleAlert } from 'lucide-react'
import { Link, useInRouterContext } from 'react-router'
import { toApiProblem } from '@/api/client'
import { Button } from '@/components/ui/button'
import { humanise } from '@/lib/format'
import { problemHint } from '@/lib/problems'
import { cn } from '@/lib/utils'

export interface ErrorStateProps {
  /** What was thrown. An `ApiProblem` shows its own words. Anything else shows a generic message. */
  error: unknown
  /** What the page was doing, like "The runs could not be loaded." Shown under the title. */
  context?: string
  /** Shows a "Try again" button that calls this. */
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

/**
 * A failed call, in plain words: the title, what to do next (the backend's `detail`, and a
 * hint for a known `code`), and the wrong fields of a 422. It never shows a stack trace or text
 * the backend did not mean for a person.
 */
export function ErrorState({ error, context, onRetry, retryLabel, className }: ErrorStateProps) {
  const problem = toApiProblem(error)
  const hint = problemHint(problem)
  const inRouter = useInRouterContext()
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
      <div className="flex min-w-0 flex-col gap-1">
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
        {onRetry ? (
          <div className="mt-2">
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>
              {retryLabel ?? 'Try again'}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
