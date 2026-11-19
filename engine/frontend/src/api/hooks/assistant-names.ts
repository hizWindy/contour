/**
 * The Assistant's names (PLAN-V23 Part 1, the contract parts 1, 2 and 4). They load with the voice
 * bar, the review card and Admin's Settings, never in the first visit, so this file isn't in
 * `index.ts`. Kept apart from `assistant.ts` (the command step and Today).
 *
 * - **The hint list:** the names this person is most likely to say, for the company on screen.
 *   The server keeps each list 5 minutes, and so does the page.
 * - **Learned names:** the card teaches one after a send; an Admin lists them and removes one.
 * - **Adding a company to HubSpot** from the card: the preview first, then the add, with a key.
 */
import { queryOptions, useQuery } from '@tanstack/react-query'
import { api, unwrap } from '../client'
import { queryKeys } from '../query'
import type {
  AssistantCompanyAdded,
  AssistantCompanyIn,
  AssistantCompanyPreview,
  AssistantNames,
  LearnedNameIn,
  LearnedNamePage,
} from '../types'

// --- The hint list (PLAN-V23 T1-1, T1-5) ---------------------------------------------------------

/** How long a hint list is kept: the server keeps it as long. */
export const NAMES_FRESH_MS = 5 * 60_000

/** The hint list for the company on screen (none: the person's own list). */
export function namesQueryOptions(companyKey: string | null) {
  return queryOptions({
    queryKey: [...queryKeys.companies.all, 'assistant', 'names', companyKey ?? ''] as const,
    queryFn: async ({ signal }): Promise<AssistantNames> =>
      unwrap(
        await api.GET('/companies/assistant/names', {
          params: { query: companyKey ? { company_key: companyKey } : {} },
          signal,
        }),
      ),
    staleTime: NAMES_FRESH_MS,
    // A list that can't load leaves the words as heard: nothing to retry for.
    retry: false,
  })
}

// --- Learned names (PLAN-V23 T1-2, T1-5) --------------------------------------------------------

/** Teaches the mic a name the rep picked by hand (204). */
export async function teachName(body: LearnedNameIn): Promise<void> {
  unwrap(await api.POST('/companies/assistant/learned', { body }))
}

/** The most learned names Settings shows at once. */
export const LEARNED_PAGE = 100

export function learnedNamesKey() {
  return [...queryKeys.companies.all, 'assistant', 'learned'] as const
}

/** Every learned name, the newest first: Admins only. */
export function useLearnedNames() {
  return useQuery({
    queryKey: learnedNamesKey(),
    queryFn: async ({ signal }): Promise<LearnedNamePage> =>
      unwrap(
        await api.GET('/companies/assistant/learned', {
          params: { query: { limit: LEARNED_PAGE } },
          signal,
        }),
      ),
  })
}

/** Removes one learned name (204). */
export async function removeLearnedName(id: string): Promise<void> {
  unwrap(
    await api.DELETE('/companies/assistant/learned/{pair_id}', {
      params: { path: { pair_id: id } },
    }),
  )
}

// --- Adding a company to HubSpot (PLAN-V23 T1-4, T1-6) ------------------------------------------

/** What adding the company would do: companies like it, the same name, and whether it can be. */
export async function previewCompany(
  body: AssistantCompanyIn,
  signal?: AbortSignal,
): Promise<AssistantCompanyPreview> {
  return unwrap(await api.POST('/companies/assistant/companies/preview', { body, signal }))
}

/** Adds the company to HubSpot and our copy. The same key gives back the same company. */
export async function addCompany(
  body: AssistantCompanyIn,
  key: string,
): Promise<AssistantCompanyAdded> {
  return unwrap(
    await api.POST('/companies/assistant/companies', {
      body,
      params: { header: { 'idempotency-key': key } },
    }),
  )
}
