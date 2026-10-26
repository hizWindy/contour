/**
 * What to tell a person about a failed call, beyond the backend's own title and detail.
 *
 * The backend sends a stable `code` with some problems. This turns the code into one plain next
 * step. A problem without a known code gets no hint: its `detail` already says what to do.
 */
import { toast } from 'sonner'
import { toApiProblem, type ApiProblem } from '@/api/client'

const HINTS: Record<string, string> = {
  run_already_active: 'Only one run goes at a time. Open the run that is going, or stop it first.',
  hubspot_names_not_approved:
    'Researching from HubSpot names needs approval first. The switch is in engine/.env, so it is turned on by whoever owns that data decision, and the backend restarts.',
  run_not_active: 'That run has already ended. Reload the page to see its final state.',
  run_not_resumable:
    'Only an interrupted or failed run can continue, and only a few times. Start a new run instead.',
  too_many_rows: 'Narrow the filters so that fewer than 2,000 leads match, then export again.',
  discovery_too_large:
    'Pick fewer cities, triggers or areas, so the plan fits inside the limit for one run.',
  idempotency_key_reused:
    'This click was already used for a different run. Reload the page and try again.',
}

/** One plain next step for the problem's `code`, or `null`. */
export function problemHint(problem: ApiProblem): string | null {
  return problem.code !== null && problem.code in HINTS ? (HINTS[problem.code] ?? null) : null
}

/**
 * Shows a failed call as a toast: the title, and the detail and hint under it. For a change the
 * person made from a button (reject, stop, export), where there is no place on the page for the
 * error. The error can be anything that was thrown.
 */
export function toastProblem(error: unknown): void {
  const problem = toApiProblem(error)
  const description = [problem.detail, problemHint(problem)].filter(Boolean).join(' ')
  toast.error(problem.title, description ? { description } : undefined)
}
