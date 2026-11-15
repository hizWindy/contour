/**
 * An edit on Activity answers at once (DESIGN.md "Act at once, undo after"; PLAN-V17 "It answers
 * at once"): the card shows the change, then PATCH /call-notes/{note_id} tells the server. If the
 * server says no, every page of notes goes back to what it was, and a toast says why in the
 * server's own words. When the last edit in flight has answered, the pages are asked for again,
 * so what shows is what the server holds.
 *
 * The callbacks live on the mutation, not on one `mutate` call, so a rollback still happens if the
 * rep has moved to another page meanwhile.
 */
import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query'
import { toast } from 'sonner'
import { unwrap, type ApiProblem } from '@/api/client'
import { putNoteInLists, refreshCallNoteLists, updateNoteInLists } from '@/api/hooks/call-notes'
import { queryKeys } from '@/api/query'
import type { CallNoteOut, CallNotePage, CallNotePatch } from '@/api/v17'
import { apiV17 } from '@/api/v17-client'
import { changeDetail } from '@/lib/problems'
import { NOT_CHANGED } from './words'

export interface EditVariables {
  id: string
  /** What the server is told. Changes and tasks replace the note's lists. */
  patch: CallNotePatch
  /** The same edit, made to the note on screen at once. */
  apply: (note: CallNoteOut) => CallNoteOut
}

interface EditContext {
  before: [QueryKey, CallNotePage | undefined][]
}

const EDIT_KEY = [...queryKeys.companies.callNotes(), 'edit'] as const

export function useEditCallNote() {
  const client = useQueryClient()
  return useMutation<CallNoteOut, ApiProblem, EditVariables, EditContext>({
    mutationKey: EDIT_KEY,
    mutationFn: async ({ id, patch }) =>
      unwrap(
        await apiV17.PATCH('/companies/call-notes/{note_id}', {
          params: { path: { note_id: id } },
          body: patch,
        }),
      ),
    onMutate: async ({ id, apply }) => {
      // An older answer on its way must not land on top of the edit.
      await client.cancelQueries({ queryKey: queryKeys.companies.callNoteLists() })
      const before = client.getQueriesData<CallNotePage>({
        queryKey: queryKeys.companies.callNoteLists(),
      })
      updateNoteInLists(client, id, apply)
      return { before }
    },
    onError: (error, _variables, context) => {
      for (const [key, page] of context?.before ?? []) {
        client.setQueryData(key, page)
      }
      const detail = changeDetail(error)
      toast.error(NOT_CHANGED, detail ? { description: detail } : undefined)
    },
    onSuccess: (note) => {
      putNoteInLists(client, note)
    },
    onSettled: () => {
      // This edit still counts while it settles: 1 means no other edit is on its way.
      if (client.isMutating({ mutationKey: EDIT_KEY }) <= 1) {
        void refreshCallNoteLists(client)
      }
    },
  })
}
