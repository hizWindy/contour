/**
 * The top of the lead card (PLAN-V6, F1): what a person needs to decide, without scrolling on a
 * laptop. The result with its stage and where the company came from; the score as a bar with its
 * band; one line on why to call now (the Why now's reason, PLAN-V12 D1), or else why it fits; the
 * best sign with its date and page; staff and office size, each with its source; the HubSpot
 * label with the owner; the first person to talk to; and the actions.
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
import { formatM2, formatScore, formatStaff } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Actions } from './actions'
import { BAND_WORDS, bestTrigger, firstPerson, sourceWord } from './words'
import { rejectReasonLabel } from '../../reject-reasons-data'

/** The points earned out of the points the tool could check, as words and as a bar. */
function ScoreBar({ lead }: { lead: LeadDetail }) {
  const checked = lead.score_checked
  const words = `Score ${formatScore(lead.score, checked)}${checked ? ' checked' : ''}`
  const band = lead.band ? (
    <Badge variant="outline">{BAND_WORDS[lead.band] ?? lead.band}</Badge>
  ) : null
  if (!checked) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-ui font-semibold tabular-nums">{words}</span>
        {band}
      </div>
    )
  }
  const share = Math.max(0, Math.min(100, Math.round((lead.score / checked) * 100)))
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-ui font-semibold tabular-nums">{words}</span>
        {band}
      </div>
      <div
        role="meter"
        aria-label="Score"
        aria-valuemin={0}
        aria-valuemax={checked}
        aria-valuenow={lead.score}
        aria-valuetext={`${String(lead.score)} of ${String(checked)} points checked`}
        className="h-2 w-full max-w-sm overflow-hidden rounded-sm bg-muted"
      >
        <div
          className="h-full rounded-sm bg-muted-foreground"
          style={{ width: `${String(share)}%` }}
        />
      </div>
    </div>
  )
}

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
  // The size the rules used: the research's own number, or an estimate from the staff.
  const m2 =
    lead.office_m2 ?? (typeof facts.office_m2.value === 'number' ? facts.office_m2.value : null)
  const m2Source =
    lead.office_m2_estimated && facts.office_m2.value === null
      ? 'the staff number'
      : facts.office_m2.source_url
        ? 'Claude'
        : null
  const best = bestTrigger(lead)
  const person = firstPerson(lead)
  const reason = lead.why_now?.reason ? lead.why_now.reason : null // PLAN-V12 D1
  return (
    <section aria-label="Quick view" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <ResultBadge result={lead.result} />
        {lead.stage ? <span className="text-ui text-muted-foreground">{lead.stage}</span> : null}
        <SourceMark origin={lead.origin} className="text-ui" />
        <StatusBadge status={lead.status} />
        {lead.is_test ? <Badge variant="outline">Test set</Badge> : null}
      </div>

      <ScoreBar lead={lead} />

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
              value={formatM2(m2, lead.office_m2_estimated)}
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
