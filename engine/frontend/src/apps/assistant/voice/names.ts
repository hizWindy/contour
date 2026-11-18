/**
 * The names on screen, for the name fix (PLAN-V22 T3-2, `name-fix.ts`): on a company's page, or
 * with a company open in Companies' panel, the company's name and its people's, as HubSpot has
 * them. So "Vitara" heard on Vitera's page becomes "Vitera", and the bar says so once.
 *
 * Read from what the page has already loaded, so it asks the server for nothing. Elsewhere there
 * are no names, and the words stay as heard: the command step finds the company in our HubSpot
 * copy itself (T1-2).
 */
import type { QueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/api/query'
import type { AssistantOnPage, CompanyDetail } from '@/api/types'

export function namesOnPage(client: QueryClient, onPage: AssistantOnPage | null): string[] {
  const key = onPage?.company_key
  if (!key) return []
  const company = client.getQueryData<CompanyDetail>(queryKeys.companies.detail(key))
  if (!company) return []
  return [company.name, ...company.people.map((person) => person.name)]
}
