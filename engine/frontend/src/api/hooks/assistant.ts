/**
 * The Assistant's requests (PLAN-V22, the contract parts 1 to 3). They load with the Assistant's
 * pages, its Home card and the voice bar, never in the first visit, so this file isn't in
 * `index.ts`.
 *
 * - **The command step** (T1-1): one thing a rep said or typed, read into one action. It writes
 *   nothing and sends nothing: the review card does that (T3-3).
 * - **Today** (T1-3): the rep's tasks, meetings, calls to confirm and quiet deals. The server keeps
 *   the tasks it read from HubSpot for 5 minutes a person, so opening Today again costs HubSpot
 *   nothing. Sync (`fresh=true`) reads them again, at most once a minute a person.
 * - **A task done, or open again** (T1-4): each at once, in HubSpot. Undo is the reopen.
 */
import { queryOptions, useQuery, type QueryClient } from '@tanstack/react-query'
import { api, unwrap } from '../client'
import { queryKeys } from '../query'
import type { AssistantCommand, AssistantCommandIn, Today } from '../types'

/** What the command would do, or the `ApiProblem` (409 `assistant_off`, 429, 503 and the rest). */
export async function readCommand(
  body: AssistantCommandIn,
  signal?: AbortSignal,
): Promise<AssistantCommand> {
  return unwrap(await api.POST('/companies/assistant/command', { body, signal }))
}

// --- Today ---------------------------------------------------------------------------------------

/**
 * Today's answer. Its key sits here, under Companies' (the API is Companies'), and not in
 * `query.ts`, which is in the first visit.
 */
export function todayKey() {
  return [...queryKeys.companies.all, 'assistant', 'today'] as const
}

export function todayQueryOptions() {
  return queryOptions({
    queryKey: todayKey(),
    queryFn: async ({ signal }): Promise<Today> =>
      unwrap(await api.GET('/companies/assistant/today', { signal })),
  })
}

/** Today: the server's 5-minute copy of the tasks, and the rest from our HubSpot copy. */
export function useToday(enabled = true) {
  return useQuery({ ...todayQueryOptions(), enabled })
}

/** Sync: the tasks read from HubSpot again, and Today on screen with them. */
export async function readTodayAgain(client: QueryClient): Promise<Today> {
  const today = unwrap(
    await api.GET('/companies/assistant/today', { params: { query: { fresh: true } } }),
  )
  client.setQueryData(todayKey(), today)
  return today
}

/** Ticks my HubSpot task done (204), or the `ApiProblem`. */
export async function tickTaskDone(taskId: string): Promise<void> {
  unwrap(
    await api.POST('/companies/assistant/tasks/{task_id}/done', {
      params: { path: { task_id: taskId } },
    }),
  )
}

/** Opens my HubSpot task again, the Undo of Done (204), or the `ApiProblem`. */
export async function reopenTask(taskId: string): Promise<void> {
  unwrap(
    await api.POST('/companies/assistant/tasks/{task_id}/reopen', {
      params: { path: { task_id: taskId } },
    }),
  )
}
