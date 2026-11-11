/**
 * Script edits and style notes (PLAN-V14 T1-3), for the call prep card.
 *
 * - A **line edit** is my own wording for one slot of one call (`opener.0`, `goal` ...). Only I see
 *   it. The card lays it over the newest draft, so it survives "Research again".
 * - The **style** is mine (one note) and the team's (notes an Admin approved). Every style change
 *   answers with the whole style, so the cache is set from the answer, with no second request.
 */
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, unwrap } from '../client'
import { queryKeys } from '../query'
import type { ScriptEditIn, ScriptEditOut, ScriptStyleOut } from '../types'

/** One slot of one call. `contactId` is null for a cold call. */
export interface ScriptSlotKey {
  companyKey: string
  contactId: string | null
  slot: string
}

function callQuery(companyKey: string, contactId: string | null) {
  return { company_key: companyKey, ...(contactId ? { contact_id: contactId } : {}) }
}

function bySlot(edits: ScriptEditOut[]): ScriptEditOut[] {
  return [...edits].sort((a, b) => a.slot.localeCompare(b.slot))
}

// --- Line edits ---------------------------------------------------------------------------------

/** My lines for a call to this person (or a cold call). */
export function scriptEditsQueryOptions(companyKey: string, contactId: string | null) {
  return queryOptions({
    queryKey: queryKeys.companies.edits(companyKey, contactId),
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/companies/script-edits', {
          params: { query: callQuery(companyKey, contactId) },
          signal,
        }),
      ),
  })
}

/** `undefined` asks for nothing (no company picked yet). */
export function useScriptEdits(companyKey: string | undefined, contactId: string | null) {
  return useQuery({
    ...scriptEditsQueryOptions(companyKey ?? '', contactId),
    enabled: companyKey !== undefined && companyKey !== '',
  })
}

/** Saves my wording for one slot. 422 `contact_details` for an email address or a phone number. */
export function useSaveScriptEdit() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (body: ScriptEditIn): Promise<ScriptEditOut> =>
      unwrap(await api.PUT('/companies/script-edits', { body })),
    onSuccess: (saved, body) => {
      client.setQueryData<ScriptEditOut[]>(
        queryKeys.companies.edits(body.company_key, body.contact_id ?? null),
        (old) => bySlot([...(old ?? []).filter((edit) => edit.slot !== saved.slot), saved]),
      )
    },
  })
}

/** Removes my line for one slot, so the draft shows again. */
export function useResetScriptEdit() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({ companyKey, contactId, slot }: ScriptSlotKey): Promise<void> => {
      unwrap(
        await api.DELETE('/companies/script-edits', {
          params: { query: { ...callQuery(companyKey, contactId), slot } },
        }),
      )
    },
    onSuccess: (_done, { companyKey, contactId, slot }) => {
      client.setQueryData<ScriptEditOut[]>(
        queryKeys.companies.edits(companyKey, contactId),
        (old) => (old ?? []).filter((edit) => edit.slot !== slot),
      )
    },
  })
}

// --- Style notes --------------------------------------------------------------------------------

/** My style, the team's active notes, and the suggestions I may see. */
export function scriptStyleQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.companies.style(),
    queryFn: async ({ signal }) => unwrap(await api.GET('/companies/script-style', { signal })),
  })
}

export function useScriptStyle() {
  return useQuery(scriptStyleQueryOptions())
}

/** Every style change answers with the whole style: it goes straight into the cache. */
function useStyleChange<Input>(send: (input: Input) => Promise<ScriptStyleOut>) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: send,
    onSuccess: (style) => {
      client.setQueryData(queryKeys.companies.style(), style)
    },
  })
}

/** Saves my style. An empty text clears it. */
export function useSaveMyStyle() {
  return useStyleChange(async (text: string) =>
    unwrap(await api.PUT('/companies/script-style/mine', { body: { text } })),
  )
}

/** Suggests a team note. An Admin's own is active at once (TBC). */
export function useSuggestTeamNote() {
  return useStyleChange(async (text: string) =>
    unwrap(await api.POST('/companies/script-style/team', { body: { text } })),
  )
}

/** Admins: approve or reject a waiting team note. */
export function useDecideTeamNote() {
  return useStyleChange(async ({ id, approve }: { id: string; approve: boolean }) =>
    unwrap(
      approve
        ? await api.POST('/companies/script-style/team/{note_id}/approve', {
            params: { path: { note_id: id } },
          })
        : await api.POST('/companies/script-style/team/{note_id}/reject', {
            params: { path: { note_id: id } },
          }),
    ),
  )
}

/** Admins: retire an active team note. It leaves everyone's next scripts. */
export function useRetireTeamNote() {
  return useStyleChange(async (id: string) =>
    unwrap(
      await api.DELETE('/companies/script-style/team/{note_id}', {
        params: { path: { note_id: id } },
      }),
    ),
  )
}
