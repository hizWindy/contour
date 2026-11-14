/**
 * The company's record (PLAN-V10 B5): a dialog in the middle of the page. It answers "what do we
 * know about this client?", the long read before or after a call, so it gets the width. A call
 * script is something else: "Prep a call" closes this and opens the narrow prep panel on the right
 * (`prep-sheet.tsx`), which is the thing done all day.
 *
 * It never opens empty: the row the person opened is already in the list, so the name, the place
 * and the four boxes show at once, and the rest fades in when it arrives (a hover or focus on the
 * row has usually loaded it already). Its header stays put while the sections scroll. Esc or the
 * close button closes it, and focus goes back to the row.
 *
 * Motion: it fades in and rises 8 px (250 ms), and leaves in 150 ms.
 *
 * On a phone (PLAN-V10 G1) it fills the screen. Its header stays at the top with the close button
 * while the sections scroll, and "Prep a call" is a full-width button at the bottom, where a thumb
 * reaches it.
 */
import { ExternalLink, Maximize2, PhoneCall, XIcon } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { useCompany } from '@/api/hooks'
import type { CompanyDetail, CompanyPerson, CompanyRow } from '@/api/types'
import { ErrorState } from '@/components/error-state'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { safeHref } from '@/lib/safe-href'
import { melbourneDate } from '@/lib/format'
import { PHONE, useMediaQuery } from '@/lib/use-media-query'
import { cn } from '@/lib/utils'
import { CompanyView, CompanyViewPending, QuickBoxes } from './company-view'
import { focusMovedOn } from './focus'
import { NotInHubSpot } from './marks'
import { companyPlace } from './words'

/** The parts of a row that stand in for the company while it loads. */
function fromRow(row: CompanyRow): CompanyDetail {
  return {
    key: row.key,
    source: row.source,
    name: row.name,
    domain: row.domain,
    website: null,
    city: row.city,
    state: null,
    industry: row.industry,
    staff: row.staff,
    linkedin_staff: null,
    description: null,
    owner: row.owner,
    lifecycle_stage: null,
    last_talk: row.last_talk,
    last_talk_note: null,
    next_lease_end: row.next_lease_end,
    deal: row.deal,
    hubspot_url: null,
    offices: [],
    deals: [],
    notes: [],
    people: [],
    calls: [],
    people_status: 'waiting',
    lead: null,
  }
}

/** A plain left click, not one that opens a new tab or window. */
function isPlainClick(event: React.MouseEvent): boolean {
  return event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey
}

export interface CompanyActionsProps {
  company: Pick<CompanyDetail, 'key' | 'name' | 'hubspot_url'>
  onPrep?: () => void
  /** "Open full page", and what a plain click on it does (the panel closes first). */
  fullPage?: { onOpen?: (key: string) => void }
}

/** "Prep a call", "Open in HubSpot" and "Open full page". */
export function CompanyActions({ company, onPrep, fullPage }: CompanyActionsProps) {
  const hubspot = safeHref(company.hubspot_url)
  return (
    <div className="flex flex-wrap items-center gap-2">
      {onPrep ? (
        <Button type="button" size="sm" onClick={onPrep}>
          <PhoneCall aria-hidden="true" />
          Prep a call
        </Button>
      ) : null}
      {hubspot ? (
        <Button asChild variant="outline" size="sm">
          <a href={hubspot} target="_blank" rel="noopener noreferrer nofollow">
            <ExternalLink aria-hidden="true" />
            Open in HubSpot
          </a>
        </Button>
      ) : null}
      {fullPage ? (
        <Button asChild variant="ghost" size="sm">
          <Link
            to={`/companies/${encodeURIComponent(company.key)}`}
            onClick={(event) => {
              if (fullPage.onOpen && isPlainClick(event)) {
                event.preventDefault()
                fullPage.onOpen(company.key)
              }
            }}
          >
            <Maximize2 aria-hidden="true" />
            Open full page
          </Link>
        </Button>
      ) : null}
    </div>
  )
}

export interface CompanyDialogProps {
  /** The company to show, or nothing to close the dialog. */
  companyKey: string | null
  onClose: () => void
  onOpenFullPage?: (key: string) => void
  /** "Prep a call": for the company (person null), or for one of its people. */
  onPrep?: (company: CompanyDetail, person: CompanyPerson | null) => void
  /** The rows on screen. The company's own row shows while the rest loads. */
  rows?: readonly CompanyRow[]
}

export function CompanyDialog({
  companyKey,
  onClose,
  onOpenFullPage,
  onPrep,
  rows,
}: CompanyDialogProps) {
  // While the dialog fades out, it keeps showing the company it had.
  const [shown, setShown] = useState(companyKey)
  if (companyKey !== null && companyKey !== shown) {
    setShown(companyKey)
  }
  const company = useCompany(shown ?? undefined)
  const row = rows?.find((item) => item.key === shown)
  const known = company.data ?? (row ? fromRow(row) : undefined)
  const today = melbourneDate()
  const phone = useMediaQuery(PHONE)
  const prepCompany =
    onPrep && company.data
      ? () => {
          onPrep(company.data, null)
        }
      : undefined
  return (
    <Dialog
      open={companyKey !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        showCloseButton={!phone}
        // Full screen on a phone; 768 px in the middle on a laptop, where the sections need room.
        className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 data-open:slide-in-from-bottom-2 sm:max-w-3xl max-sm:top-0 max-sm:left-0 max-sm:h-dvh max-sm:max-h-none max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none max-sm:border-0"
        onCloseAutoFocus={(event) => {
          if (focusMovedOn()) {
            event.preventDefault()
            return
          }
          // Back to the row it came from, so J and K carry on from there. On a phone the row is a
          // card, which is the button itself.
          const id = shown ? CSS.escape(shown) : null
          const button = id
            ? document.querySelector<HTMLElement>(
                `[data-row-id="${id}"] button, button[data-row-id="${id}"]`,
              )
            : null
          if (button) {
            event.preventDefault()
            button.focus()
          }
        }}
      >
        <DialogHeader
          className={cn(
            // The header stays put while the sections scroll under it.
            'gap-3 border-b p-5 pr-14 text-left max-sm:p-4 max-sm:pr-12',
            phone && 'pt-[max(1rem,env(safe-area-inset-top))]',
          )}
        >
          {phone ? (
            <DialogClose asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="absolute top-[max(0.75rem,env(safe-area-inset-top))] right-3"
              >
                <XIcon aria-hidden="true" />
                <span className="sr-only">Close</span>
              </Button>
            </DialogClose>
          ) : null}
          <div className="flex flex-col gap-1">
            <DialogTitle className="text-section">{known?.name ?? 'Company'}</DialogTitle>
            <DialogDescription>
              {known ? companyPlace(known) || 'What we know about this company.' : 'Loading.'}
            </DialogDescription>
          </div>
          {known ? (
            <CompanyActions
              company={known}
              // On a phone "Prep a call" is the big button at the bottom instead.
              onPrep={phone ? undefined : prepCompany}
              fullPage={{ onOpen: onOpenFullPage }}
            />
          ) : null}
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain p-5 pb-8 max-sm:p-4">
          {known?.source === 'lead' ? <NotInHubSpot /> : null}
          {known ? <QuickBoxes company={known} today={today} /> : null}
          {company.error ? (
            <ErrorState
              error={company.error}
              context="This company couldn't be loaded."
              onRetry={() => void company.refetch()}
            />
          ) : company.data ? (
            // The rest fades in under the boxes, which stay where they are.
            <div key={company.data.key} className="animate-in duration-150 fade-in-0">
              <CompanyView
                company={company.data}
                today={today}
                boxes={false}
                onPrep={
                  onPrep
                    ? (person) => {
                        onPrep(company.data, person)
                      }
                    : undefined
                }
              />
            </div>
          ) : (
            <CompanyViewPending boxes={known === undefined} />
          )}
        </div>
        {phone && onPrep ? (
          <div className="border-t bg-popover p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <Button
              type="button"
              size="lg"
              className="w-full"
              disabled={!prepCompany}
              onClick={prepCompany}
            >
              <PhoneCall aria-hidden="true" />
              Prep a call
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
