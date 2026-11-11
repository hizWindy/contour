/**
 * The prep card's side (PLAN-V10 F1, from the prototype): beside the sales script, the last time
 * we talked (the call note, in the serif: it is a quote), quick facts, and "Company info" for
 * everything else.
 *
 * The card's other parts have their own files (PLAN-V14 T2-2): "Before you dial" is in
 * `before-you-dial.tsx`, the script in `sales-script.tsx` and its title in `script-header.tsx`.
 */
import { Building2 } from 'lucide-react'
import type { ReactNode } from 'react'
import type { CompanyDetail, PrepFacts } from '@/api/types'
import { Pending, SkeletonLines } from '@/components/skeletons'
import { Button } from '@/components/ui/button'
import { formatDate, formatNumber } from '@/lib/format'
import { CallNote } from './company-view'
import { DealMark, LeaseEnd } from './marks'
import { shortMoney } from './playbook'
import { Quiet } from './sales-script'
import { WAITING_FOR_PEOPLE } from './words'

function SideSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-ui font-semibold text-foreground">{title}</h3>
      {children}
    </section>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-ui">{children}</dd>
    </>
  )
}

export interface CallSideProps {
  company: CompanyDetail | undefined
  facts: PrepFacts | undefined
  today: string
  onOpenCompany: () => void
}

/** The last time we talked, quick facts, and the way to everything else. */
export function CallSide({ company, facts, today, onOpenCompany }: CallSideProps) {
  const call = facts?.last_call ?? company?.calls[0] ?? null
  const waiting = (facts?.people_status ?? company?.people_status) === 'waiting'
  const deal = company?.deals.find((item) => item.state === 'open') ?? null
  const lease = company?.offices
    .filter((office) => office.lease_end && office.lease_end >= today)
    .sort((a, b) => ((a.lease_end ?? '') < (b.lease_end ?? '') ? -1 : 1))[0]
  return (
    <aside aria-label="What we know" className="flex flex-col gap-6 lg:border-l lg:pl-6">
      <SideSection title="Last time we talked">
        {call ? (
          <div className="flex flex-col gap-2">
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
            {call.note ? <CallNote text={call.note} /> : <Quiet>No note on this call.</Quiet>}
          </div>
        ) : waiting ? (
          <Quiet>{WAITING_FOR_PEOPLE}</Quiet>
        ) : (
          <Quiet>No call logged in HubSpot.</Quiet>
        )}
      </SideSection>
      <SideSection title="Quick facts">
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
          className="mt-1 w-fit"
          onClick={onOpenCompany}
        >
          <Building2 aria-hidden="true" />
          Company info
        </Button>
      </SideSection>
    </aside>
  )
}
