/**
 * The top of the lead card (PLAN-V6, F1): what a person needs to decide, without scrolling on a
 * laptop. An excluded lead's reason first, with its Override (PLAN-V16 T3-4); the result with its
 * stage and where the company came from; the headline "A · 82 · Medium" with what changed (it
 * replaced the score bar and its band); one line on why to call now (the Why now's reason,
 * PLAN-V12 D1), or else why it fits; the best sign with its date and page; staff and office size,
 * each with its source; the HubSpot label with the owner; the first person to talk to; and the
 * actions.
 *
 * The name is the page's title (or the side panel's), so it is not repeated here. The details are
 * in the tabs below.
 */
import type { ReactNode } from 'react'
import { useLeadHubSpot } from '@/api/hooks'
import type { LeadDetail } from '@/api/types'
import { InHubSpotBadge } from '@/components/hubspot'
import { ResultBadge } from '@/components/result-badge'
import { SourceLink } from '@/components/source-link'
import { SourceMark } from '@/components/source-mark'
import { StatusBadge } from '@/components/status-badge'
import { Badge } from '@/components/ui/badge'
import { formatM2, formatStaff } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Actions } from './actions'
import { ExclusionNotice, TierHeadline } from './headline'
import { activeExclusion, officeSource } from './v16-words'
import { bestTrigger, firstPerson, sourceWord } from './words'
import { rejectReasonLabel } from '../../reject-reasons-data'

function Item({
  label,
  children,
  wide = false,
}: {
  label: string
  children: ReactNode
  wide?: boolean
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-0.5', wide && 'sm:col-span-2')}>
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-ui">{children}</dd>
    </div>
  )
}

/** A value and, in quieter words, where it came from. */
function WithSource({ value, source }: { value: string; source: string | null }) {
  return (
    <span className="flex flex-wrap items-baseline gap-x-2">
      <span>{value}</span>
      {source ? <span className="text-caption text-muted-foreground">from {source}</span> : null}
    </span>
  )
}

export function QuickView({ lead }: { lead: LeadDetail }) {
  const sent = useLeadHubSpot(lead.id).data
  const facts = lead.facts
  const staff = typeof facts.staff_in_city.value === 'number' ? facts.staff_in_city.value : null
  // The size: the current office's own area when a source gave one (PLAN-V16 T1-8's order:
  // Property Daily, Arealytics, HubSpot, the research), else the size the rules used, the
  // research's own number or an estimate from the staff.
  const office = lead.office
  const officeArea = office?.area_m2 ?? null
  const m2 =
    officeArea ??
    lead.office_m2 ??
    (typeof facts.office_m2.value === 'number' ? facts.office_m2.value : null)
  const m2Estimated =
    officeArea !== null ? office?.area_basis === 'estimated' : lead.office_m2_estimated
  const m2Source =
    officeArea !== null && office
      ? officeSource(office)
      : lead.office_m2_estimated && facts.office_m2.value === null
        ? 'the staff number'
        : facts.office_m2.source_url
          ? 'Claude'
          : null
  const excluded = activeExclusion(lead) !== null
  const best = bestTrigger(lead)
  const person = firstPerson(lead)
  const reason = lead.why_now?.reason ? lead.why_now.reason : null // PLAN-V12 D1
  return (
    <section aria-label="Quick view" className="flex flex-col gap-4">
      <ExclusionNotice lead={lead} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <ResultBadge result={lead.result} />
        {lead.stage ? <span className="text-ui text-muted-foreground">{lead.stage}</span> : null}
        <SourceMark origin={lead.origin} className="text-ui" />
        <StatusBadge status={lead.status} />
        {lead.is_test ? <Badge variant="outline">Test set</Badge> : null}
      </div>

      {/* An excluded lead is not scored, so its reason above stands in for the headline. */}
      {excluded ? null : <TierHeadline lead={lead} />}

      {lead.form_failed ? (
        <p role="status" className="max-w-prose rounded-md border border-destructive px-3 py-2">
          <span className="font-semibold">Facts missing.</span> Claude couldn&apos;t fill in the
          answer form, so every fact below is unknown, although the search found notes. Re-check
          this lead.
        </p>
      ) : null}
      {lead.status === 'rejected' && lead.reject_reason ? (
        <p className="text-ui text-muted-foreground">
          Rejected: {rejectReasonLabel(lead.reject_reason)}
          {lead.reject_note ? `. ${lead.reject_note}` : ''}
        </p>
      ) : null}

      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {/* Why now's reason says why to call, so it takes the line when there is one. */}
        <Item label={reason ? 'Why now' : 'Why it fits'} wide>
          <span className="line-clamp-2 max-w-prose" title={reason ?? lead.why_it_fits}>
            {reason ?? lead.why_it_fits}
          </span>
        </Item>
        <Item label="Best sign" wide>
          {best ? (
            <span className="flex flex-col gap-0.5">
              <span className="line-clamp-2 max-w-prose">{best.trigger.what_happened}</span>
              <span className="flex flex-wrap items-center gap-x-2 text-caption text-muted-foreground">
                <span>{best.trigger.date ?? 'Date not known'}</span>
                <SourceLink href={best.trigger.source_url} />
              </span>
            </span>
          ) : (
            <span className="text-muted-foreground">No sign that counts was found.</span>
          )}
        </Item>
        <Item label="Staff in the city">
          {staff === null ? (
            <span className="text-muted-foreground">Not known</span>
          ) : (
            <WithSource
              value={`${formatStaff(staff)}${facts.staff_from_linkedin ? ' on LinkedIn' : ''}`}
              source={sourceWord(lead, 'staff_in_city')}
            />
          )}
        </Item>
        <Item label="Office size">
          {m2 === null ? (
            <span className="text-muted-foreground">Not known</span>
          ) : (
            <WithSource
              value={formatM2(m2, m2Estimated)}
              // Office size has no entry of its own in the sources: it comes from the research,
              // or the rules estimate it from the staff.
              source={m2Source}
            />
          )}
        </Item>
        <Item label="HubSpot">
          <span className="flex flex-wrap items-center gap-2">
            <InHubSpotBadge
              status={lead.hubspot.status}
              name={lead.hubspot.name}
              href={sent?.hubspot_url ?? null}
            />
            {lead.hubspot.owner ? (
              <span className="text-caption text-muted-foreground">
                Owner: {lead.hubspot.owner}
              </span>
            ) : null}
          </span>
        </Item>
        <Item label="Talk to first">
          {person ? (
            <span className="flex flex-col">
              <span>{person}</span>
              {lead.contact_role ? (
                <span className="text-caption text-muted-foreground">
                  Role to ask for: {lead.contact_role}
                </span>
              ) : null}
            </span>
          ) : (
            <span>{lead.contact_role ?? 'Not known yet.'}</span>
          )}
        </Item>
      </dl>

      <Actions lead={lead} />
    </section>
  )
}
