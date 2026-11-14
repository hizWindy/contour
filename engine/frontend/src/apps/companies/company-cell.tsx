/**
 * The Company cell of the table (PLAN-V13 T2-8): the company's initials in a small square, the
 * name (a button, so Enter opens the company through the row's own click), and the website under
 * it, or "Not in HubSpot yet" for a lead. Industry has its own column now.
 *
 * "Prep" sits at the end of the cell, on every row and always in view: the name column stays put
 * when the table scrolls sideways, so the button does too. It is the page's everyday action, so it
 * is never hidden behind a hover.
 */
import { PhoneCall } from 'lucide-react'
import type { CompanyRow } from '@/api/types'
import { Button } from '@/components/ui/button'
import { PREP_BUTTON } from './focus'
import { NotInHubSpot } from './marks'
import { initialsOf } from './source-words'

export function CompanyCell({
  row,
  onPrep,
}: {
  row: CompanyRow
  /** "Prep": opens the prep panel for this company. Without it, no button. */
  onPrep?: (row: CompanyRow) => void
}) {
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
      {onPrep ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="ml-auto shrink-0"
          aria-label={`Prep a call to ${row.name}`}
          {...{ [PREP_BUTTON]: row.key }}
          onClick={(event) => {
            // The row itself opens the company; Prep must not do that as well.
            event.stopPropagation()
            onPrep(row)
          }}
        >
          <PhoneCall aria-hidden="true" />
          Prep
        </Button>
      ) : null}
    </span>
  )
}
