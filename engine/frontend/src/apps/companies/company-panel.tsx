/**
 * The company panel (PLAN-V10 B5): a Sheet from the right, so the list stays in view behind it.
 * It answers "what do we know about this client?". A call script is something else: "Prep a call"
 * opens it in a modal over the page.
 *
 * It never opens empty: the row the person opened is already in the list, so the name, the place
 * and the four boxes show at once, and the rest fades in when it arrives (a hover or focus on the
 * row has usually loaded it already). Esc or the close button closes it, and focus goes back to
 * the row.
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
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { safeHref } from '@/lib/safe-href'
import { melbourneDate } from '@/lib/format'
import { PHONE, useMediaQuery } from '@/lib/use-media-query'
import { cn } from '@/lib/utils'
import { CompanyView, CompanyViewPending, QuickBoxes } from './company-view'
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

export interface CompanyPanelProps {
  /** The company to show, or nothing to close the panel. */
  companyKey: string | null
  onClose: () => void
  onOpenFullPage?: (key: string) => void
  /** "Prep a call": for the company (person null), or for one of its people. */
  onPrep?: (company: CompanyDetail, person: CompanyPerson | null) => void
  /** The rows on screen. The company's own row shows while the rest loads. */
  rows?: readonly CompanyRow[]
}

export function CompanyPanel({
  companyKey,
  onClose,
  onOpenFullPage,
  onPrep,
  rows,
}: CompanyPanelProps) {
  // While the panel slides shut, it keeps showing the company it had.
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
    <Sheet
      open={companyKey !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <SheetContent
        side="right"
        showCloseButton={!phone}
        // Full screen on a phone; wider on a laptop, where the sections need the room.
        className="w-full gap-0 overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-2xl"
        onCloseAutoFocus={(event) => {
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
        <SheetHeader
          className={cn(
            'gap-3 pr-12',
            // On a phone the header stays put while the sections scroll under it.
            phone &&
              'sticky top-0 z-10 border-b bg-popover pt-[max(1rem,env(safe-area-inset-top))]',
          )}
        >
          {phone ? (
            <SheetClose asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="absolute top-[max(0.75rem,env(safe-area-inset-top))] right-3"
              >
                <XIcon aria-hidden="true" />
                <span className="sr-only">Close</span>
              </Button>
            </SheetClose>
          ) : null}
          <div className="flex flex-col gap-1">
            <SheetTitle>{known?.name ?? 'Company'}</SheetTitle>
            <SheetDescription>
              {known ? companyPlace(known) || 'What we know about this company.' : 'Loading.'}
            </SheetDescription>
          </div>
          {known ? (
            <CompanyActions
              company={known}
              // On a phone "Prep a call" is the big button at the bottom instead.
              onPrep={phone ? undefined : prepCompany}
              fullPage={{ onOpen: onOpenFullPage }}
            />
          ) : null}
        </SheetHeader>
        <div className="flex flex-col gap-5 px-4 pb-8">
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
          <div className="sticky bottom-0 z-10 mt-auto border-t bg-popover p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
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
      </SheetContent>
    </Sheet>
  )
}
