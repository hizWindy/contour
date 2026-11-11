/**
 * "Details for support" (PLAN-V15 T2-3): what an admin needs to find a failure in the backend's
 * log. The request id ties it to the log line; the exact time (in UTC too) and the page narrow it
 * down when there is no id. Never anything the person typed.
 */
import type { ApiProblem } from '@/api/client'
import { formatDateTime } from './format'

/** The page the person was on: the path and query, never the whole address. */
function currentPage(): string {
  return `${window.location.pathname}${window.location.search}`
}

/** The lines, as label and value. */
export function supportLines(
  problem: ApiProblem,
  page: string = currentPage(),
): [string, string][] {
  return [
    ['Status', problem.status === 0 ? 'No answer' : String(problem.status)],
    ['Code', problem.code ?? 'None'],
    ['Request id', problem.request_id ?? 'None'],
    ['Time', `${formatDateTime(problem.at)} (${problem.at.toISOString()})`],
    ['Page', page],
  ]
}

/** The same lines as one block of text, for the Copy button. */
export function supportText(lines: readonly [string, string][]): string {
  return lines.map(([label, value]) => `${label}: ${value}`).join('\n')
}
