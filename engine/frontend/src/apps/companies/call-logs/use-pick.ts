/**
 * Picking the company of a call saved before it was found (PLAN-V24 T3-3, choices 20 and 21):
 * PATCH /call-notes/{note_id} with `company_key` alone. The server then sorts the call as it sorts
 * a new one (it answers `sorting`, or `to_confirm` with the AI off), and teaches the mic the words
 * heard (PLAN-V23's learned names), so nothing more is asked of the website.
 *
 * - **At once:** the call leaves "Needs a company", and the counts move one from it to To confirm,
 *   before the server answers. A toast then says where the call went.
 * - **No, from the server** (422 `company_not_found`, or anything else): the call comes back, the
 *   counts move back, and a toast says why in the server's own words.
 * - **409 `company_set`** is no error: the call has its company already (a pick sent twice, or one
 *   made in another tab). The call is read again and shown where it is, with no error.
 * - When the server has answered, the counts are marked old and the lists asked for again, so To
 *   confirm shows the call, and follows it while it is sorted.
 *
 * The callbacks live on the mutation, not on one `mutate` call, so they still run if the rep has
 * moved to another page meanwhile.
 */
import { useMutation, useQueryClient, type Query, type QueryKey } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, isApiProblem, unwrap, type ApiProblem } from '@/api/client'
import {
  bumpCounts,
  callNoteQueryOptions,
  dropNoteFromLists,
  markCountsOld,
  refreshCallNoteLists,
} from '@/api/hooks/call-notes'
import { queryKeys } from '@/api/query'
import type { CallNoteOut, CallNotePage, CallNoteQuery } from '@/api/types'
import { changeDetail } from '@/lib/problems'
import { callCompany, NOT_PICKED, pickedWords } from './words'

export interface PickVariables {
  /** The call that needs its company. */
  id: string
  /** The company picked: a HubSpot company id, or lead:<id>. */
  companyKey: string
}

interface PickContext {
  /** The pages of calls that need a company, as they were before the call left them. */
  before: [QueryKey, CallNotePage | undefined][]
}

const PICK_KEY = [...queryKeys.companies.callNotes(), 'pick'] as const

/** The pages of the calls that need a company, among the pages of notes in the cache. */
const NEEDS_COMPANY_PAGES = {
  queryKey: queryKeys.companies.callNoteLists(),
  predicate: (query: Query) =>
    (query.queryKey[3] as CallNoteQuery | undefined)?.state === 'needs_company',
}

/** The server's 409 `company_set`: the call has its company already. */
function isCompanySet(error: unknown): boolean {
  return isApiProblem(error) && error.status === 409 && error.code === 'company_set'
}

export function usePickCompany() {
  const client = useQueryClient()
  return useMutation<CallNoteOut, ApiProblem, PickVariables, PickContext>({
    mutationKey: PICK_KEY,
    mutationFn: async ({ id, companyKey }) =>
      unwrap(
        await api.PATCH('/companies/call-notes/{note_id}', {
          params: { path: { note_id: id } },
          body: { company_key: companyKey },
        }),
      ),
    onMutate: async ({ id }) => {
      // An older answer on its way must not bring the call back.
      await client.cancelQueries({ queryKey: queryKeys.companies.callNoteLists() })
      const before = client.getQueriesData<CallNotePage>(NEEDS_COMPANY_PAGES)
      dropNoteFromLists(client, id, 'needs_company')
      await bumpCounts(client, { needs_company: -1, to_confirm: 1 })
      return { before }
    },
    onSuccess: (note) => {
      client.setQueryData(queryKeys.companies.callNote(note.id), note)
      toast(pickedWords(callCompany(note)))
    },
    onError: async (error, { id }, context) => {
      if (isCompanySet(error)) {
        const now = await client
          .fetchQuery({ ...callNoteQueryOptions(id), staleTime: 0 })
          .catch(() => undefined)
        if (now && now.status !== 'needs_company') {
          toast(pickedWords(callCompany(now)))
          // The counts as the server has them: the call may have left the group before this pick.
          void client.invalidateQueries({ queryKey: queryKeys.companies.callNoteSummary() })
          return
        }
      }
      for (const [key, page] of context?.before ?? []) {
        client.setQueryData(key, page)
      }
      void bumpCounts(client, { needs_company: 1, to_confirm: -1 })
      const detail = changeDetail(error)
      toast.error(NOT_PICKED, detail ? { description: detail } : undefined)
    },
    onSettled: () => {
      markCountsOld(client)
      void refreshCallNoteLists(client)
    },
  })
}
