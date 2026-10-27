/**
 * The lead card in a side panel (a Sheet from the right), so the list stays in view behind it. Esc
 * or the close button closes it, and focus goes back to the list. The card also has its own page,
 * linked at the top.
 */
import { ExternalLink } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { useLead } from '@/api/hooks'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { LeadCardView } from '../lead/lead-card-view'

export interface LeadPanelProps {
  /** The lead to show, or nothing to close the panel. */
  leadId: string | null
  onClose: () => void
  /**
   * A plain click on "Open the full page" calls this with the lead's id, so the list can drop the
   * panel from its address before the page opens, and Back then lands on the list, not on the list
   * with the panel open. A click with Ctrl, Shift or the middle button keeps the link's own way.
   */
  onOpenFullPage?: (leadId: string) => void
}

export function LeadPanel({ leadId, onClose, onOpenFullPage }: LeadPanelProps) {
  // While the panel slides shut, it keeps showing the lead it had.
  const [shown, setShown] = useState(leadId)
  if (leadId !== null && leadId !== shown) {
    setShown(leadId)
  }
  const lead = useLead(shown ?? undefined)
  const place = lead.data
    ? [lead.data.facts.industry.value, lead.data.facts.city.value].filter(Boolean).join(', ')
    : ''
  return (
    <Sheet
      open={leadId !== null}
      onOpenChange={(open) => {
        if (!open) {
          onClose()
        }
      }}
    >
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-2xl"
      >
        <SheetHeader className="pr-12">
          <SheetTitle>{lead.data?.company ?? 'Lead'}</SheetTitle>
          <SheetDescription>{place || 'The lead card, rule by rule.'}</SheetDescription>
          {shown ? (
            <Link
              to={`/leads/${shown}`}
              onClick={(event) => {
                const plain =
                  event.button === 0 &&
                  !event.ctrlKey &&
                  !event.metaKey &&
                  !event.shiftKey &&
                  !event.altKey
                if (onOpenFullPage && plain) {
                  event.preventDefault()
                  onOpenFullPage(shown)
                }
              }}
              className="inline-flex w-fit items-center gap-1 text-ui underline underline-offset-4"
            >
              <ExternalLink aria-hidden="true" className="size-4" />
              Open the full page
            </Link>
          ) : null}
        </SheetHeader>
        <div className="px-4 pb-6">
          {lead.error ? (
            <ErrorState
              error={lead.error}
              context="This lead couldn't be loaded."
              onRetry={() => void lead.refetch()}
            />
          ) : lead.data ? (
            <LeadCardView lead={lead.data} compact />
          ) : (
            <EmptyState title="Loading the lead." headingLevel={3} />
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
