/**
 * What to tell a person about a failed call, beyond the backend's own title and detail.
 *
 * The backend sends a stable `code` with some problems. This turns the code into one plain next
 * step. A problem without a known code gets no hint: its `detail` already says what to do.
 *
 * The words follow PLAN-V15 "Words for errors": no command, file name or local address, ever.
 */
import { toast } from 'sonner'
import { toApiProblem, type ApiProblem } from '@/api/client'
import { problemKind } from '@/api/connection'

const HINTS: Record<string, string> = {
  run_already_active: 'Only one run goes at a time. Open the run that is going, or stop it first.',
  hubspot_names_not_approved:
    'Researching from HubSpot names needs approval first. Ask an admin to switch it on.',
  run_not_active: 'That run has already ended. Reload the page to see its final state.',
  run_not_resumable:
    'Only an interrupted or failed run can continue, and only a few times. Start a new run instead.',
  too_many_rows: 'Narrow the filters so that fewer than 2,000 leads match, then export again.',
  discovery_too_large:
    'Pick fewer cities, triggers or areas, so the plan fits inside the limit for one run.',
  idempotency_key_reused:
    'This click was already used for a different run. Reload the page and try again.',
  // Call notes, Call logs and call prep (PLAN-V18 T3-8): the next step for each code. M1 checks
  // them against Track 1's words (T1-8) and drops any that only repeat the server's own.
  call_notes_off:
    'Ask an admin to switch call notes on. Until then, log your calls in HubSpot as before.',
  hubspot_writes_off:
    'Your calls wait here until HubSpot can be written to. You can still check and change them.',
  already_sending: 'Wait for that batch to finish, then send the rest.',
  note_too_long: 'Make the note shorter, or split it into two calls.',
  note_empty: 'Type a note or pick an outcome first.',
  note_sorting: 'It is still being sorted. Try again in a moment.',
  note_sent: 'It is in HubSpot already. Open it there to change it.',
  part_sent: 'Part of it is in HubSpot already. Open it there to change that part.',
  note_not_found: 'It may have been removed. Reload the page to see your calls.',
  not_your_note: 'Each rep sees and changes their own calls only.',
  nothing_to_retry: 'Everything on this call is in HubSpot already. Reload the page to see it.',
  change_twice: 'Keep one change for each field, then save.',
  called_later: "Pick a time that has passed: a call can't be logged ahead.",
  task_in_past: 'Pick today or a later day for the follow-up.',
  person_not_at_company: 'Pick someone at this company, or log the call on the company.',
  prep_off: 'Ask an admin to switch call prep on. The facts from HubSpot still show.',
}

/** One plain next step for the problem's `code`, or `null`. */
export function problemHint(problem: ApiProblem): string | null {
  return problem.code !== null && problem.code in HINTS ? (HINTS[problem.code] ?? null) : null
}

/*
  A change (a button press) is never repeated by itself, so the words a read uses ("We'll try
  again in 10 seconds") would be wrong for it. A change that ran out of time may still have gone
  through, so it says to check first.
*/
const CHANGE_DETAILS: Partial<Record<string, string>> = {
  offline: "Nothing was sent. Try again once you're back online.",
  unreachable: 'Try again in a moment.',
  updating: 'Try again in about a minute.',
  timeout: 'It may still have gone through. Reload the page to check before you try again.',
}

/** What to say under the title of a failed change. */
export function changeDetail(problem: ApiProblem): string | null {
  const kind = problemKind(problem)
  return (kind && CHANGE_DETAILS[kind]) ?? problem.detail
}

/**
 * Shows a failed call as a toast: the title, and the detail and hint under it. For a change the
 * person made from a button (reject, stop, export), where there is no place on the page for the
 * error. The error can be anything that was thrown.
 */
export function toastProblem(error: unknown): void {
  const problem = toApiProblem(error)
  const description = [changeDetail(problem), problemHint(problem)].filter(Boolean).join(' ')
  toast.error(problem.title, description ? { description } : undefined)
}
