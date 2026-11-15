import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { api, unwrap, type ApiProblem } from '../client'
import { queryKeys } from '../query'
import type { PropertySource, ToolList, ToolOut } from '../types'

/**
 * Property Daily and Arealytics for Admin's Sources tab (PLAN-V16 T3-6, the contract's part 4):
 * each tool's switch, sign-in, last read, pages today, records, pause and last problem. Admin
 * only.
 */
export function useSources() {
  return useQuery({
    queryKey: queryKeys.sources.all,
    queryFn: async ({ signal }) => unwrap(await api.GET('/sources', { signal })),
  })
}

/** One tool's new state goes into the list, and the Start page's sources read again. */
function putSource(queryClient: QueryClient, source: ToolOut): void {
  queryClient.setQueryData<ToolList>(queryKeys.sources.all, (list) =>
    list ? { items: list.items.map((item) => (item.id === source.id ? source : item)) } : list,
  )
  void queryClient.invalidateQueries({ queryKey: queryKeys.runOptions.all })
  void queryClient.invalidateQueries({ queryKey: queryKeys.health.all })
}

/** "Check now": a free sign-in check that reads one page. A failed check fills `last_problem`. */
export function useCheckSource() {
  const queryClient = useQueryClient()
  return useMutation<ToolOut, ApiProblem, PropertySource>({
    mutationFn: async (sourceId) =>
      unwrap(
        await api.POST('/sources/{source_id}/check', {
          params: { path: { source_id: sourceId } },
        }),
      ),
    onSuccess: (source) => {
      putSource(queryClient, source)
    },
  })
}

/** "Resume": lifts a 24-hour pause. */
export function useResumeSource() {
  const queryClient = useQueryClient()
  return useMutation<ToolOut, ApiProblem, PropertySource>({
    mutationFn: async (sourceId) =>
      unwrap(
        await api.POST('/sources/{source_id}/resume', {
          params: { path: { source_id: sourceId } },
        }),
      ),
    onSuccess: (source) => {
      putSource(queryClient, source)
    },
  })
}
