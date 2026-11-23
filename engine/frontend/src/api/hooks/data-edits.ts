/** The Data tab's edit screens (PLAN-V26 T4-3). They load with that tab. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, unwrap, type ApiProblem } from '../client'
import { markNotesOld } from './call-notes'
import { refreshLeads } from './leads'
import type { Schemas } from '../types'

export type EditField = Schemas['EditFieldOut']
export type DataEdit = Schemas['EditOut']
type Done = Schemas['EditDoneOut']

export function useEditForm(table: string, rowId: string | null) {
  return useQuery({
    queryKey: ['data', 'row', table, rowId],
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/data/tables/{table}/rows/{row_id}', {
          params: { path: { table, row_id: rowId ?? '' } },
          signal,
        }),
      ),
    enabled: rowId !== null,
    gcTime: 0, // the row can change under us, so each opening reads it again
    refetchOnWindowFocus: false, // never while someone is typing
  })
}

export function useTableEdits(table: string, offset: number) {
  return useQuery({
    queryKey: ['data', 'edits', table, offset],
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/data/edits', { params: { query: { table, offset } }, signal })),
  })
}

/** What an edit changes: the table's rows, its edits, and the screens that show the same rows. */
function useRefresh() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['data', 'rows'] })
    void queryClient.invalidateQueries({ queryKey: ['data', 'edits'] })
    void queryClient.invalidateQueries({ queryKey: ['memory'] })
    refreshLeads(queryClient)
    markNotesOld(queryClient) // Call logs and To confirm show the same notes
  }
}

export function useEditRow(table: string) {
  const onSuccess = useRefresh()
  return useMutation<Done, ApiProblem, { rowId: string; values: Record<string, string | null> }>({
    mutationFn: async ({ rowId, values }) =>
      unwrap(
        await api.PATCH('/data/tables/{table}/rows/{row_id}', {
          params: { path: { table, row_id: rowId } },
          body: { values },
        }),
      ),
    onSuccess,
  })
}

export function useDeleteRow(table: string) {
  const onSuccess = useRefresh()
  return useMutation<Done, ApiProblem, string>({
    mutationFn: async (rowId) =>
      unwrap(
        await api.DELETE('/data/tables/{table}/rows/{row_id}', {
          params: { path: { table, row_id: rowId } },
        }),
      ),
    onSuccess,
  })
}

export function useUndoEdit() {
  const onSuccess = useRefresh()
  return useMutation<Done, ApiProblem, string>({
    mutationFn: async (editId) =>
      unwrap(
        await api.POST('/data/edits/{edit_id}/undo', { params: { path: { edit_id: editId } } }),
      ),
    onSuccess,
  })
}
