/**
 * The prep card's own parts (PLAN-V10 F1), in the side panel's one column:
 *
 * - **Last time we talked:** the last call's note, in the serif because it is a quote. It sits
 *   above the script, because it is the one thing to read before you say the opener.
 * - **More about:** quick facts (the company, the lease, the deal, the owner) and "Company info"
 *   for everything else. Folded away by default, so the script fits without much scrolling.
 *
 * The card's other parts have their own files (PLAN-V14 T2-2): "Before you dial" is in
 * `before-you-dial.tsx`, the script in `sales-script.tsx` and its title in `script-header.tsx`.
 */
import { Building2, ChevronDown } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'
import type { CompanyDetail, PrepFacts } from '@/api/types'
import { Pending, SkeletonLines } from '@/components/skeletons'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { formatDate, formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { CallNote } from './company-view'
import { DealMark, LeaseEnd } from './marks'
import { shortMoney } from './playbook'
import { Quiet } from './sales-script'
import { WAITING_FOR_PEOPLE } from './words'

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-ui">{children}</dd>
    </>
  )
}

export interface LastTalkProps {
  company: CompanyDetail | undefined
  facts: PrepFacts | undefined
}

/** The last call: when, who, by whom and how it went, then its note. */
export function LastTalk({ company, facts }: LastTalkProps) {
  const title = useId()
  const call = facts?.last_call ?? company?.calls[0] ?? null
  const waiting = (facts?.people_status ?? company?.people_status) === 'waiting'
  return (
    <section aria-labelledby={title} className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <h3 id={title} className="text-ui font-semibold text-foreground">
          Last time we talked
        </h3>
        {call ? (
          <p className="text-caption text-muted-foreground">
            {[
              call.called_at ? formatDate(call.called_at) : null,
              call.person,
              call.owner ? `by ${call.owner}` : null,
              call.outcome,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        ) : null}
      </div>
      {call ? (
        call.note ? (
          <CallNote text={call.note} />
        ) : (
          <Quiet>No note on this call.</Quiet>
        )
      ) : waiting ? (
        <Quiet>{WAITING_FOR_PEOPLE}</Quiet>
      ) : (
        <Quiet>No call logged in HubSpot.</Quiet>
      )}
    </section>
  )
}

export interface MoreAboutProps {
  company: CompanyDetail | undefined
  /** The name to show before the company loads. */
  companyName: string
  today: string
  onOpenCompany: () => void
}

/** Quick facts and "Company info", folded away under "More about ...". */
export function MoreAbout({ company, companyName, today, onOpenCompany }: MoreAboutProps) {
  const [open, setOpen] = useState(false)
  const deal = company?.deals.find((item) => item.state === 'open') ?? null
  const lease = company?.offices
    .filter((office) => office.lease_end && office.lease_end >= today)
    .sort((a, b) => ((a.lease_end ?? '') < (b.lease_end ?? '') ? -1 : 1))[0]
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border-t pt-3">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 rounded-md py-1 text-left text-ui font-semibold text-foreground"
        >
          More about {company?.name ?? companyName}
          <ChevronDown
            aria-hidden="true"
            className={cn(
              'size-4 shrink-0 text-muted-foreground transition-transform duration-150',
              open && 'rotate-180',
            )}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="animate-in pt-3 duration-150 fade-in-0">
        {company ? (
          <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-2.5">
            <Fact label="Company">
              {[
                company.city,
                company.staff === null ? null : `${formatNumber(company.staff)} staff`,
              ]
                .filter(Boolean)
                .join(' · ') || 'Nothing more on record'}
            </Fact>
            <Fact label="Lease">
              {lease ? (
                <span className="flex flex-col">
                  <span className="text-caption text-muted-foreground">{lease.label}</span>
                  <LeaseEnd date={lease.lease_end} today={today} stacked={false} />
                </span>
              ) : (
                <span className="text-muted-foreground">None on record</span>
              )}
            </Fact>
            <Fact label="Deal">
              {deal ? (
                <span>
                  {deal.stage ?? deal.name}
                  {shortMoney(deal.amount_aud) ? ` · ${shortMoney(deal.amount_aud) ?? ''}` : ''}
                </span>
              ) : (
                <DealMark deal={company.deal} />
              )}
            </Fact>
            <Fact label="Owner">
              {company.owner ?? <span className="text-muted-foreground">No owner</span>}
            </Fact>
          </dl>
        ) : (
          <Pending label="Loading the quick facts.">
            <SkeletonLines count={4} />
          </Pending>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3 w-fit"
          onClick={onOpenCompany}
        >
          <Building2 aria-hidden="true" />
          Company info
        </Button>
      </CollapsibleContent>
    </Collapsible>
  )
}
