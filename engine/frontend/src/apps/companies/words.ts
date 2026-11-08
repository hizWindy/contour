/** Words and small helpers the Companies page shares (PLAN-V10). */
import { formatNumber } from '@/lib/format'

export const WAITING_FOR_PEOPLE = 'Waiting for HubSpot access to contacts and calls.'

/** "Logistics · Perth · 300 staff", from what is known. */
export function companyPlace(company: {
  industry: string | null
  city: string | null
  staff: number | null
}): string {
  return [
    company.industry,
    company.city,
    company.staff === null ? null : `${formatNumber(company.staff)} staff`,
  ]
    .filter(Boolean)
    .join(' · ')
}
