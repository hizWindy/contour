/**
 * The card's own find for a company said or entered again (PLAN-V24 T3-2, choice 19; Al-khair, 21
 * Nov): `GET /companies/assistant/companies/find`. It finds the company as the command step does,
 * with no AI: the team's learned names, then our copy, then HubSpot's own search. It is for a name
 * said, or typed and then entered: typing in the box still filters our copy, key by key.
 *
 * - **One found:** it is the card's company at once, as a command's found company is, with its
 *   line when HubSpot's own search found it ("Northwind Pty Ltd is new in HubSpot. We'll use it.").
 *   On a call that needs a company it is asked first (`askFirst`, the browser check of PLAN-V24),
 *   as a one-item choice: the server takes a call's company once (409 `company_set`), and learns
 *   the words heard as that company. A tap, "yes" or "the first one" picks it (`confirm`). Other
 *   cards still take it at once, as their company can change until Send.
 * - **Two or more:** the card asks which ("Which North Wind?"), and "the first one" picks.
 * - **Nowhere:** the plan's "Still no …" words, with Add to HubSpot when HubSpot was searched.
 * - **Refused** (like a phone number in the words): the server's own words. Our copy's search
 *   still works in the box.
 * - **No find on this server** (a 404, from an older backend while a deploy runs): our copy's
 *   search stands in, as before.
 * - **Dropped** (PLAN-V24 review): a find still on its way once the box's words change, or the
 *   card's company does. HubSpot's search can take 8 seconds, and one match for words the rep has
 *   moved on from would become the company, which the server takes only once (409 `company_set`).
 *   Its answer picks nothing and shows nothing, and our copy's search stands in.
 *
 * Each answer is kept for 30 seconds by its words, so the same words said twice ask HubSpot once.
 */
import { queryOptions, useQueryClient } from '@tanstack/react-query'
import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { api, toApiProblem, unwrap } from '@/api/client'
import { queryKeys } from '@/api/query'
import type { AssistantCompanyFind, CompanyHit } from '@/api/types'
import type { Company } from './draft'

/** The most characters the find takes (the contract: 1 to 120). */
export const FIND_MAX = 120

export async function findCompany(
  words: string,
  signal?: AbortSignal,
): Promise<AssistantCompanyFind> {
  return unwrap(
    await api.GET('/companies/assistant/companies/find', {
      params: { query: { words } },
      signal,
    }),
  )
}

export function companyFindQueryOptions(words: string) {
  return queryOptions({
    queryKey: [...queryKeys.companies.all, 'assistant', 'company-find', words],
    queryFn: ({ signal }) => findCompany(words, signal),
    staleTime: 30_000,
    retry: false,
  })
}

/** What the find made of the words, short of one company found and taken at once. */
export type FindAnswer =
  /** On its way. */
  | { kind: 'looking' }
  /** Two or more: the card asks which, from these, best first. */
  | { kind: 'choices'; choices: readonly CompanyHit[] }
  /**
   * One, on a call that needs a company: shown as a one-item choice, picked by a tap, "yes" or "the
   * first one" (`confirm`). `fromHubspot`: HubSpot's own search found it.
   */
  | { kind: 'confirm'; choice: CompanyHit; fromHubspot: boolean }
  /** Found nowhere. `canAdd`: after HubSpot was searched, so the card offers Add to HubSpot. */
  | { kind: 'nowhere'; canAdd: boolean }
  /** Refused, in the server's own words. */
  | { kind: 'problem'; words: string }
  /** No find on this server: our copy's search stands in. */
  | { kind: 'copy' }
  /**
   * Dropped while it looked: the box's words or the card's company changed. Our copy's search
   * stands in, and nothing is said to be nowhere.
   */
  | { kind: 'dropped' }

/** The company said or entered again, which time (the same words twice find twice), and the find. */
export interface CompanySaid {
  words: string
  n: number
  find: FindAnswer
}

/** One company found: the card takes it. `fromHubspot`: HubSpot's own search found it. */
export type OnFound = (company: Company, fromHubspot: boolean) => void

/** The words cut to what the find takes. Too short to name a company: nothing. */
function findWords(words: string): string | null {
  const tidy = words.trim().slice(0, FIND_MAX).trim()
  return tidy.length >= 2 ? tidy : null
}

/**
 * The card's find: `find(words)` for a name said or entered, and `said`, what it found for the
 * newest words. A find replaced by a newer one is dropped, and so is one still on its way when
 * `drop()` is called (the box's words changed) or `picked`, the card's company, changes. With
 * `askFirst`, one found waits as a one-item choice until `confirm()` picks it.
 */
export function useCompanyFind(
  onFound: OnFound,
  picked: string | null,
  askFirst = false,
): {
  said: CompanySaid | null
  find: (words: string) => void
  drop: () => void
  confirm: (key: string) => boolean
} {
  const client = useQueryClient()
  const [said, setSaid] = useState<CompanySaid | null>(null)
  const asked = useRef(0)
  const found = useRef(onFound)
  const asks = useRef(askFirst)
  const saidNow = useRef(said)
  useLayoutEffect(() => {
    found.current = onFound
    asks.current = askFirst
    saidNow.current = said
  })
  // The words stay, so the box isn't filled with them again; only an answer still to come goes.
  const drop = useCallback(() => {
    asked.current += 1
    setSaid((now) => (now?.find.kind === 'looking' ? { ...now, find: { kind: 'dropped' } } : now))
  }, [])
  const pickedBefore = useRef(picked)
  useLayoutEffect(() => {
    if (pickedBefore.current === picked) return
    pickedBefore.current = picked
    drop()
  }, [picked, drop])
  /**
   * The one company a confirm shows is picked, as one found is: with its HubSpot line. False when
   * no confirm shows, or it shows another company.
   */
  const confirm = useCallback((key: string): boolean => {
    const now = saidNow.current?.find
    if (now?.kind !== 'confirm' || now.choice.key !== key) return false
    setSaid(null)
    found.current({ key: now.choice.key, name: now.choice.name }, now.fromHubspot)
    return true
  }, [])
  const find = useCallback(
    (words: string) => {
      const tidy = findWords(words)
      if (tidy === null) return
      asked.current += 1
      const n = asked.current
      setSaid({ words: tidy, n, find: { kind: 'looking' } })
      client.fetchQuery(companyFindQueryOptions(tidy)).then(
        ({ company }) => {
          if (asked.current !== n) return
          if (company.found) {
            const fromHubspot = company.from_hubspot === true
            if (asks.current) {
              setSaid({
                words: tidy,
                n,
                find: { kind: 'confirm', choice: company.found, fromHubspot },
              })
              return
            }
            setSaid(null)
            found.current({ key: company.found.key, name: company.found.name }, fromHubspot)
            return
          }
          setSaid({
            words: tidy,
            n,
            find:
              company.choices.length > 0
                ? { kind: 'choices', choices: company.choices }
                : { kind: 'nowhere', canAdd: company.can_add === true },
          })
        },
        (error: unknown) => {
          if (asked.current !== n) return
          const problem = toApiProblem(error)
          setSaid({
            words: tidy,
            n,
            find:
              problem.status === 404
                ? { kind: 'copy' }
                : {
                    kind: 'problem',
                    words: [problem.title, problem.detail].filter(Boolean).join('. '),
                  },
          })
        },
      )
    },
    [client],
  )
  return { said, find, drop, confirm }
}
