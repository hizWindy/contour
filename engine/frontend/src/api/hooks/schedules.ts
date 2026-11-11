import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, unwrap, type ApiProblem } from '../client'
import { queryKeys } from '../query'
import type { LeadFinderRound, LeadFinderRoundIn, RunNow, Schedule, ScheduleEdit } from '../types'

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

/**
 * The Lead Finder's four city schedules as one plan, the round so far and its budget
 * (`GET /schedules/lead-finder`, PLAN-V13 T1-3). Read again every 30 seconds, like the list.
 */
export function useLeadFinderRound() {
  return useQuery({
    queryKey: queryKeys.schedules.round(),
    queryFn: async ({ signal }) => unwrap(await api.GET('/schedules/lead-finder', { signal })),
    refetchInterval: REFRESH_MS,
  })
}

/**
 * Saves the whole plan (`PUT /schedules/lead-finder`): the four schedules change in one step, and
 * the budget is a setting, so the settings are read again too. What can't be saved comes back as
 * field errors `body.<name>`.
 */
export function useSaveLeadFinderRound() {
  const queryClient = useQueryClient()
  return useMutation<LeadFinderRound, ApiProblem, LeadFinderRoundIn>({
    mutationFn: async (body) => unwrap(await api.PUT('/schedules/lead-finder', { body })),
    onSuccess: (round) => {
      queryClient.setQueryData(queryKeys.schedules.round(), round)
      // The list only (its city rows changed); the plan itself is the answer above.
      void queryClient.invalidateQueries({ queryKey: queryKeys.schedules.all, exact: true })
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.all })
    },
  })
}
