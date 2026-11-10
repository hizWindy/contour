/**
 * Where a company on the Companies page came from (PLAN-V13 T2-8), from the row's own fields:
 *
 *   HubSpot       in HubSpot only
 *   Lead Finder   found by the Lead Finder and not in HubSpot (`source = lead`)
 *   Both          in HubSpot, with a Lead Finder result
 *
 * The words and the icons live here; `source.tsx` draws the mark.
 */
import { Database, Layers2, Target, type LucideIcon } from 'lucide-react'
import type { CompanyRow } from '@/api/types'

export type CompanySourceKind = 'hubspot' | 'lead' | 'both'

export function companySource(row: Pick<CompanyRow, 'source' | 'lead_result'>): CompanySourceKind {
  if (row.source === 'lead') return 'lead'
  return row.lead_result ? 'both' : 'hubspot'
}

export const SOURCE_MARKS: Record<
  CompanySourceKind,
  { label: string; hint: string; icon: LucideIcon }
> = {
  hubspot: { label: 'HubSpot', hint: 'In HubSpot only.', icon: Database },
  lead: {
    label: 'Lead Finder',
    hint: 'Found by the Lead Finder. Not in HubSpot yet.',
    icon: Target,
  },
  both: { label: 'Both', hint: 'In HubSpot, with a Lead Finder result.', icon: Layers2 },
}

/** "AL" for "ABC Logistics", "HL" for "Harbourline Logistics Pty Ltd": the first two words' letters. */
export function initialsOf(name: string): string {
  const words = name
    .split(/[\s&/-]+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return (words[0] ?? '').slice(0, 2).toUpperCase()
  return words
    .slice(0, 2)
    .map((word) => word[0] ?? '')
    .join('')
    .toUpperCase()
}
