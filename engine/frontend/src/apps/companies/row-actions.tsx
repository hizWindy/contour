/**
 * The action at the end of a Companies row (PLAN-V13 T2-8), shown when the pointer rests on the
 * row or focus is in it, like HubSpot's preview button: "Open in HubSpot". "Prep" is not here: it
 * is on every row, always in view, at the end of the name (`company-cell.tsx`).
 *
 * A row knows no HubSpot address, only the company's data does. A pointer resting on a row
 * already loads that data (the page prefetches it), so by the time the actions show, the address
 * is usually in the cache and the button is a real link. Before that, or for a lead that isn't in
 * HubSpot, the button opens the company instead, which has the link.
 */
import { useQuery } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'
import { companyQueryOptions } from '@/api/hooks'
import type { CompanyRow } from '@/api/types'
import { Button } from '@/components/ui/button'
import { safeHref } from '@/lib/safe-href'

export interface RowActionHandlers {
  /** "Prep" on the row: opens the prep panel. */
  onPrep: (row: CompanyRow) => void
  /** Opens the company (its dialog), where the HubSpot link always is. */
  onOpen: (key: string) => void
}

export function RowActions({ row, handlers }: { row: CompanyRow; handlers: RowActionHandlers }) {
  // Only the cache: no request of its own. The page prefetches the company on pointer rest.
  const company = useQuery({ ...companyQueryOptions(row.key), enabled: false })
  const hubspot = safeHref(company.data?.hubspot_url)
  // A lead isn't in HubSpot, so there is nothing to show.
  if (row.source === 'lead') return null
  return (
    <span
      data-slot="row-actions"
      className="absolute top-1/2 right-2 flex -translate-y-1/2 gap-1 rounded-md bg-card p-1 opacity-0 shadow-float transition-opacity group-focus-within/row:opacity-100 group-hover/row:opacity-100 has-[:focus-visible]:opacity-100"
      onClick={(event) => {
        // The row itself opens the company; the action must not do that as well.
        event.stopPropagation()
      }}
    >
      {hubspot ? (
        <Button asChild size="sm" variant="ghost">
          <a href={hubspot} target="_blank" rel="noopener noreferrer nofollow">
            <ExternalLink aria-hidden="true" />
            Open in HubSpot
          </a>
        </Button>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            handlers.onOpen(row.key)
          }}
        >
          <ExternalLink aria-hidden="true" />
          Open in HubSpot
        </Button>
      )}
    </span>
  )
}
