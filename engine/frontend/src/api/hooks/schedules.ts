import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, unwrap, type ApiProblem } from '../client'
import { queryKeys } from '../query'
import type { RunNow, Schedule, ScheduleEdit } from '../types'

const REFRESH_MS = 30_000

/**
 * Every schedule, with its next and last run and what one start costs. It is read again every 30
 * seconds, so "running" and the last result stay true without a reload.
 */
export function useSchedules() {
  return useQuery({
    queryKey: queryKeys.schedules.all,
    queryFn: async ({ signal }) => unwrap(await api.GET('/schedules', { signal })),
    refetchInterval: REFRESH_MS,
  })
}

/** What a change (or a start by hand) changes: the schedules, and the runs a start makes. */
function useRefreshSchedules() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.schedules.all })
    void queryClient.invalidateQueries({ queryKey: queryKeys.runs.all })
  }
}

/**
 * Changes one schedule (`PATCH /schedules/{id}`): on or off, when it runs, what it looks for.
 * What can't be done comes back as field errors `body.<name>`.
 */
export function useUpdateSchedule() {
  const refresh = useRefreshSchedules()
  return useMutation<Schedule, ApiProblem, { id: string; change: ScheduleEdit }>({
    mutationFn: async ({ id, change }) =>
      unwrap(
        await api.PATCH('/schedules/{schedule_id}', {
          params: { path: { schedule_id: id } },
          body: change,
        }),
      ),
    onSuccess: refresh,
  })
}

/** Starts the job once now (`POST /schedules/{id}/run`). A refusal is an answer, not an error. */
export function useRunScheduleNow() {
  const refresh = useRefreshSchedules()
  return useMutation<RunNow, ApiProblem, string>({
    mutationFn: async (id) =>
      unwrap(
        await api.POST('/schedules/{schedule_id}/run', {
          params: { path: { schedule_id: id } },
        }),
      ),
    onSuccess: refresh,
  })
}
