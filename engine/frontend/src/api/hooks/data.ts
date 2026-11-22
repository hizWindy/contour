/**
 * Admin's Data tab (PLAN-V26 T4-1). Not in `hooks/index.ts`: that file is in the first visit, and
 * only this tab uses these, so they load with it.
 */
import { useQuery } from '@tanstack/react-query'
import { api, unwrap } from '../client'
import type { Schemas } from '../types'

export type DataTableInfo = Schemas['DataTableOut']

export interface DataQuery {
  q?: string
  sort?: string
  order?: 'asc' | 'desc'
  offset: number
}

export function useDataTables() {
  return useQuery({
    queryKey: ['data', 'tables'],
    queryFn: async ({ signal }) => unwrap(await api.GET('/data/tables', { signal })),
    staleTime: Infinity, // the list is in the backend's code
  })
}

export function useDataRows(table: string, query: DataQuery) {
  return useQuery({
    queryKey: ['data', 'rows', table, query],
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/data/tables/{table}', { params: { path: { table }, query }, signal })),
    // The last page stays while the next loads, but never another table's rows.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[2] === table ? previous : undefined,
  })
}
