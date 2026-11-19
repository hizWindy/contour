/**
 * The names the mic is fixed against (PLAN-V22 T3-2, `name-fix.ts`).
 *
 * - **The names on screen:** on a company's page, or with a company open in Companies' panel, the
 *   company's name and its people's, as HubSpot has them. So "Vitara" heard on Vitera's page
 *   becomes "Vitera", and the bar says so once. Read from what the page has already loaded.
 * - **The hint list** (PLAN-V23 T1-5): the names this person is most likely to say, from the
 *   server, on every page. So "Vitara" becomes "Vitera" on Today too. The names on screen come
 *   first; the list's fixed words ("fitout", "follow up") are for the speech service only, never
 *   for the fix, which changes names, not words.
 */
import type { QueryClient } from '@tanstack/react-query'
import { namesQueryOptions } from '@/api/hooks/assistant-names'
import { queryKeys } from '@/api/query'
import type { AssistantNames, AssistantOnPage, CompanyDetail } from '@/api/types'

export function namesOnPage(client: QueryClient, onPage: AssistantOnPage | null): string[] {
  const key = onPage?.company_key
  if (!key) return []
  const company = client.getQueryData<CompanyDetail>(queryKeys.companies.detail(key))
  if (!company) return []
  return [company.name, ...company.people.map((person) => person.name)]
}

/** Each name once, as first given. */
function once(names: readonly string[]): string[] {
  const seen = new Set<string>()
  return names.filter((name) => {
    const key = name.trim().toLowerCase()
    if (key === '' || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** The names the fix uses: the names on screen, then the hint list's names. */
export function fixNamesOf(onScreen: readonly string[], list?: AssistantNames | null): string[] {
  const listed = (list?.names ?? []).flatMap((name) => (name.kind === 'word' ? [] : [name.text]))
  return once([...onScreen, ...listed])
}

/** The hints for the speech service: the names on screen, then the whole hint list. */
export function hintsOf(onScreen: readonly string[], list?: AssistantNames | null): string[] {
  return once([...onScreen, ...(list?.names ?? []).map((name) => name.text)])
}

/** The first company of the hint list, for "Try saying" (PLAN-V23 T4-3), or null. */
export function firstCompanyOf(list?: AssistantNames | null): string | null {
  return list?.names.find((name) => name.kind === 'company')?.text.trim() || null
}

/**
 * The hint list the page has for this company, else the person's own (no company): while the
 * company's own list loads, the person's companies, meetings and teammates still fix a name.
 */
export function cachedNames(client: QueryClient, key: string | null): AssistantNames | undefined {
  return (
    client.getQueryData(namesQueryOptions(key).queryKey) ??
    client.getQueryData(namesQueryOptions(null).queryKey)
  )
}
