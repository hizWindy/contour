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
 * - **The word list** (PLAN-V25 T4-1): the places in our copy (the hint list's `places`) and the
 *   office words (`au-words.ts`). The fix gets the places and the one-word office words; the
 *   speech service's hints get the office words and the first places (TBC at PLAN-V24's S1).
 */
import type { QueryClient } from '@tanstack/react-query'
import { namesQueryOptions } from '@/api/hooks/assistant-names'
import { queryKeys } from '@/api/query'
import type { AssistantNames, AssistantOnPage, CompanyDetail } from '@/api/types'
import { OFFICE_WORDS } from '@/apps/companies/call-notes/mic/au-words'

/** The most places the speech service's hints get (TBC at PLAN-V24's S1). */
export const HINT_PLACES = 50

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

/** The office words the fix may put right: one word each, never two ("make good"). */
const OFFICE_NAMES = OFFICE_WORDS.filter((word) => !word.includes(' '))

/**
 * The names the fix uses: the names on screen, then the hint list's names, then the word list's
 * places and office words.
 */
export function fixNamesOf(onScreen: readonly string[], list?: AssistantNames | null): string[] {
  const listed = (list?.names ?? []).flatMap((name) => (name.kind === 'word' ? [] : [name.text]))
  return once([...onScreen, ...listed, ...(list?.places ?? []), ...OFFICE_NAMES])
}

/**
 * The hints for the speech service: the names on screen, the whole hint list, the office words,
 * then the first places.
 */
export function hintsOf(onScreen: readonly string[], list?: AssistantNames | null): string[] {
  const listed = (list?.names ?? []).map((name) => name.text)
  const places = (list?.places ?? []).slice(0, HINT_PLACES)
  return once([...onScreen, ...listed, ...OFFICE_WORDS, ...places])
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
