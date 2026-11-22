/**
 * How long sign-in records are kept, for the sign-in page's line (PLAN-V26 choice 15). The public
 * health answer says it, and says nothing until Levi's OK.
 */
import { useQuery } from '@tanstack/react-query'
import { api, unwrap } from '../client'

export function useSignInRecords(): number | null {
  const health = useQuery({
    queryKey: ['health', 'sign-in-records'],
    queryFn: async ({ signal }) => unwrap(await api.GET('/health', { signal })),
    retry: false,
    staleTime: Infinity,
  })
  const days = health.data?.sign_in_records_days
  return typeof days === 'number' ? days : null
}
