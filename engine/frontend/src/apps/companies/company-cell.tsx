/**
 * The Company cell of the table: the name (a button, so Enter opens the panel through the row's
 * own click), and under it the website and industry, or "Not in HubSpot yet" for a lead.
 */
import type { CompanyRow } from '@/api/types'
import { NotInHubSpot } from './marks'

export function CompanyCell({ row }: { row: CompanyRow }) {
  const detail = [row.domain, row.industry].filter(Boolean).join(' · ')
  return (
    <span className="flex min-w-0 flex-col">
      <button
        type="button"
        className="min-w-0 truncate rounded-sm text-left font-semibold underline-offset-4 hover:underline"
      >
        {row.name}
      </button>
      {row.source === 'lead' ? (
        <NotInHubSpot />
      ) : (
        <span className="truncate text-caption text-muted-foreground">
          {/* On a phone the city column is hidden, so it sits under the name. */}
          <span className="sm:hidden">{[row.city, detail].filter(Boolean).join(' · ')}</span>
          <span className="max-sm:hidden">{detail || 'No website on record'}</span>
        </span>
      )}
    </span>
  )
}
