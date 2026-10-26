import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, unwrap, type ApiProblem } from '../client'
import { queryKeys } from '../query'
import type { QueryOf, Schemas } from '../types'

/** Searches memory by meaning. Pass `null` while the search box is empty. */
export function useMemorySearch(query: QueryOf<'search_memory'> | null) {
  return useQuery({
    queryKey: queryKeys.memory.search(query ?? { q: '' }),
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/memory/search', { params: { query: query ?? { q: '' } }, signal })),
    enabled: query !== null && query.q.trim() !== '',
  })
}

/** Saves a note to memory. Only notes can be saved from the website. */
export function useSaveNote() {
  const queryClient = useQueryClient()
  return useMutation<Schemas['MemoryOut'], ApiProblem, Schemas['MemoryIn']>({
    mutationFn: async (body) => unwrap(await api.POST('/memory', { body })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.memory.all })
    },
  })
}
