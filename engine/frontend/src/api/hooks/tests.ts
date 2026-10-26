import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, unwrap, type ApiProblem } from '../client'
import { queryKeys } from '../query'
import type { QueryOf, Run } from '../types'

/** One summary for each past test run, so scores can be compared over time. */
export function useTests(query: QueryOf<'list_tests'> = {}) {
  return useQuery({
    queryKey: [...queryKeys.tests.all, 'list', query ?? {}] as const,
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/lead-finder/tests', { params: { query }, signal })),
    placeholderData: keepPreviousData,
  })
}

/** The report of one test run: expected and actual result for each company. */
export function useTestReport(runId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.tests.report(runId ?? ''),
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/lead-finder/tests/{run_id}', {
          params: { path: { run_id: runId ?? '' } },
          signal,
        }),
      ),
    enabled: runId !== undefined && runId !== '',
  })
}

/** Starts the test set (10 public companies). It costs money, so the page confirms first. */
export function useStartTestRun() {
  const queryClient = useQueryClient()
  return useMutation<Run, ApiProblem, void>({
    mutationFn: async () => unwrap(await api.POST('/lead-finder/tests/run')),
    onSuccess: (run) => {
      queryClient.setQueryData(queryKeys.runs.detail(run.id), run)
      void queryClient.invalidateQueries({ queryKey: queryKeys.runs.lists() })
      void queryClient.invalidateQueries({ queryKey: queryKeys.tests.all })
    },
  })
}
