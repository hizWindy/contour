import {
  keepPreviousData,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { api, unwrap, type ApiProblem } from '../client'
import { queryKeys } from '../query'
import type { QueryOf, Run, RunCreate } from '../types'

/** One run. The key is `queryKeys.runs.detail(runId)`. */
export function runQueryOptions(runId: string) {
  return queryOptions({
    queryKey: queryKeys.runs.detail(runId),
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/runs/{run_id}', { params: { path: { run_id: runId } }, signal })),
  })
}

export interface UseRunOptions {
  enabled?: boolean
  /** Poll this often, in milliseconds. `false` (the default) does not poll. */
  refetchInterval?: number | false
}

export function useRun(runId: string | undefined, options: UseRunOptions = {}) {
  return useQuery({
    ...runQueryOptions(runId ?? ''),
    enabled: runId !== undefined && runId !== '' && (options.enabled ?? true),
    refetchInterval: options.refetchInterval ?? false,
  })
}

/** A page of runs, newest first. */
export function runsQueryOptions(query: QueryOf<'list_runs'> = {}) {
  return queryOptions({
    queryKey: queryKeys.runs.list(query),
    queryFn: async ({ signal }) => unwrap(await api.GET('/runs', { params: { query }, signal })),
  })
}

/** A page of runs, newest first. The previous page stays on screen while the next one loads. */
export function useRuns(query: QueryOf<'list_runs'> = {}) {
  return useQuery({ ...runsQueryOptions(query), placeholderData: keepPreviousData })
}

/** The events of a run after `after`, oldest first. The live feed uses `useRunEvents` instead. */
export function useRunLog(runId: string | undefined, after = 0) {
  return useQuery({
    queryKey: queryKeys.runs.log(runId ?? '', after),
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/runs/{run_id}/log', {
          params: { path: { run_id: runId ?? '' }, query: { after } },
          signal,
        }),
      ),
    enabled: runId !== undefined && runId !== '',
  })
}

/** Cost and run counts by day, for the cost chart. `since` is a Melbourne date (YYYY-MM-DD). */
export function useRunSummary(since?: string) {
  return useQuery({
    queryKey: queryKeys.runs.summary(since),
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/runs/summary', { params: { query: { since } }, signal })),
  })
}

/**
 * What a run would cost. Pass `null` to switch it off (nothing to estimate yet). The answer for
 * the old body stays on screen while the new one loads, so the number does not flicker. A page
 * that estimates as the person types should debounce the body (300 ms) before it passes it here.
 */
export function useEstimateRun(body: RunCreate | null) {
  return useQuery({
    queryKey: queryKeys.runs.estimate(body),
    queryFn: async ({ signal }) =>
      unwrap(await api.POST('/runs/estimate', { body: body as RunCreate, signal })),
    enabled: body !== null,
    placeholderData: keepPreviousData,
    // An estimate is a quick calculation, and the answer changes with the settings and history.
    staleTime: 0,
  })
}

export interface CreateRunVariables {
  body: RunCreate
  /** Send the same key for the same click, so a double click starts one run (`newIdempotencyKey()`). */
  idempotencyKey?: string
}

/** Starts a run (`POST /runs`). A 409 `run_already_active` carries `run_id` of the run that is going. */
export function useCreateRun() {
  const queryClient = useQueryClient()
  return useMutation<Run, ApiProblem, CreateRunVariables>({
    mutationFn: async ({ body, idempotencyKey }) =>
      unwrap(
        await api.POST('/runs', {
          body,
          params: { header: idempotencyKey ? { 'idempotency-key': idempotencyKey } : {} },
        }),
      ),
    onSuccess: (run) => {
      queryClient.setQueryData(queryKeys.runs.detail(run.id), run)
      void queryClient.invalidateQueries({ queryKey: queryKeys.runs.lists() })
    },
  })
}

/** Stops a run. A run that already ended comes back as it is, not as an error. */
export function useCancelRun() {
  const queryClient = useQueryClient()
  return useMutation<Run, ApiProblem, string>({
    mutationFn: async (runId) =>
      unwrap(await api.POST('/runs/{run_id}/cancel', { params: { path: { run_id: runId } } })),
    onSuccess: (run) => {
      queryClient.setQueryData(queryKeys.runs.detail(run.id), run)
      void queryClient.invalidateQueries({ queryKey: queryKeys.runs.lists() })
    },
  })
}

/** Continues an interrupted or failed run from where it stopped. Nothing resumes by itself. */
export function useResumeRun() {
  const queryClient = useQueryClient()
  return useMutation<Run, ApiProblem, string>({
    mutationFn: async (runId) =>
      unwrap(await api.POST('/runs/{run_id}/resume', { params: { path: { run_id: runId } } })),
    onSuccess: (run) => {
      queryClient.setQueryData(queryKeys.runs.detail(run.id), run)
      void queryClient.invalidateQueries({ queryKey: queryKeys.runs.lists() })
    },
  })
}
