/**
 * The Company cell of the table (PLAN-V13 T2-8): the company's initials in a small square, the
 * name (a button, so Enter opens the panel through the row's own click), and the website under
 * it, or "Not in HubSpot yet" for a lead. Industry has its own column now.
 */
import type { CompanyRow } from '@/api/types'
import { NotInHubSpot } from './marks'
import { initialsOf } from './source-words'

export function CompanyCell({ row }: { row: CompanyRow }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <span
        aria-hidden="true"
        data-slot="company-initials"
        className="flex size-8 shrink-0 items-center justify-center rounded-md bg-secondary text-caption font-semibold text-foreground"
      >
        {initialsOf(row.name)}
      </span>
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
            <span className="sm:hidden">
              {[row.city, row.domain].filter(Boolean).join(' · ') || 'No website on record'}
            </span>
            <span className="max-sm:hidden">{row.domain || 'No website on record'}</span>
          </span>
        )}
      </span>
    </span>
  )
}
