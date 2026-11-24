/**
 * The HubSpot and look-alikes tab: whether HubSpot has the company (its label, owner, open deals,
 * the last dissolved deal, and possible matches for a person to confirm), then the clients with
 * deals and the other leads that read alike.
 *
 * A possible match is settled here (PLAN-V27 T1-3, choice 4): "Same company" beside each candidate
 * links the lead to it, and "It's new" says HubSpot doesn't have it. Someone who can't change
 * Results (a Viewer) sees the candidates without the buttons. A settled card says who settled it.
 */
import { Link } from 'react-router'
import { toast } from 'sonner'
import { useLeadHubSpot, useLeadSimilar, usePickHubSpotMatch } from '@/api/hooks'
import type { HubSpotPick, LeadDetail } from '@/api/types'
import { useCan, useCanWrite } from '@/auth/can'
import { ErrorState } from '@/components/error-state'
import { PendingText } from '@/components/skeletons'
import { InHubSpotBadge } from '@/components/hubspot'
import { ResultBadge } from '@/components/result-badge'
import { Button } from '@/components/ui/button'
import { formatDate, formatPercent } from '@/lib/format'
import { IN_HUBSPOT_STATUSES } from '@/lib/labels'
import { Section, ShowFirst } from './parts'
import { REASON_WORDS } from './words'

/** What a settled match did, in one line for the toast. */
function settledWords(lead: LeadDetail): string {
  const hubspot = lead.hubspot
  if (hubspot.status === 'new') {
    return `${lead.company} is marked as new.`
  }
  const linked = `${lead.company} is linked to ${hubspot.name ?? 'its HubSpot company'}.`
  if (hubspot.status === 'quiet') {
    return `${linked} Nobody has worked it for a year, so it stays a new lead.`
  }
  return IN_HUBSPOT_STATUSES.includes(hubspot.status)
    ? `${linked} Results now keeps it under "In HubSpot".`
    : linked
}

function HubSpot({ lead }: { lead: LeadDetail }) {
  const hubspot = lead.hubspot
  const canSendHubSpot = useCan('lead_finder.send_to_hubspot')
  const canSettle = useCanWrite('lead_finder.results') && hubspot.status === 'possible_match'
  const sent = useLeadHubSpot(lead.id, canSendHubSpot).data
  const settle = usePickHubSpotMatch()
  const pick = (choice: HubSpotPick): void => {
    settle.mutate(
      { leadId: lead.id, pick: choice },
      {
        onSuccess: (settled) => {
          toast(settledWords(settled))
        },
      },
    )
  }
  return (
    <Section title="HubSpot">
      <div className="flex flex-wrap items-center gap-2">
        <InHubSpotBadge
          status={hubspot.status}
          lastActivity={hubspot.last_activity}
          name={hubspot.name}
          href={sent?.hubspot_url ?? null}
        />
        {hubspot.owner ? (
          <span className="text-muted-foreground">Owner: {hubspot.owner}</span>
        ) : null}
      </div>
      {hubspot.confirmed_by ? (
        <p className="text-muted-foreground">Settled by {hubspot.confirmed_by}.</p>
      ) : null}
      {hubspot.open_deals.length > 0 ? <p>Open deals: {hubspot.open_deals.join('; ')}</p> : null}
      {hubspot.last_dissolved ? (
        <p className="text-muted-foreground">
          Last deal dissolved {formatDate(hubspot.last_dissolved)}
        </p>
      ) : null}
      {hubspot.candidates.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="font-semibold">Might be the same company. A person confirms.</p>
          <ShowFirst
            items={hubspot.candidates}
            label="Possible matches in HubSpot"
            className={canSettle ? 'gap-2' : 'gap-1'}
            keyOf={(candidate) => candidate.hubspot_id}
            render={(candidate) => (
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <span className="min-w-0">
                  {candidate.name}{' '}
                  <span className="text-muted-foreground">
                    ({REASON_WORDS[candidate.reason] ?? candidate.reason},{' '}
                    {formatPercent(candidate.score * 100)} alike
                    {candidate.open_deals.length > 0 ? ', has an open deal' : ''})
                  </span>
                </span>
                {canSettle ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={`Same company as ${candidate.name}`}
                    disabled={settle.isPending}
                    onClick={() => {
                      pick({ pick: 'same', hubspot_id: candidate.hubspot_id })
                    }}
                  >
                    Same company
                  </Button>
                ) : null}
              </div>
            )}
          />
          {canSettle ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={settle.isPending}
                onClick={() => {
                  pick({ pick: 'new' })
                }}
              >
                It&apos;s new
              </Button>
              <span className="text-caption text-muted-foreground">
                None of these: HubSpot doesn&apos;t have {lead.company}.
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
      {settle.error ? (
        <ErrorState
          error={settle.error}
          context="The match wasn't saved."
          onRetry={() => {
            if (settle.variables) {
              pick(settle.variables.pick)
            }
          }}
        />
      ) : null}
    </Section>
  )
}

function LookAlikes({ leadId }: { leadId: string }) {
  const similar = useLeadSimilar(leadId)
  if (similar.error) {
    return (
      <Section title="Look-alikes">
        <ErrorState error={similar.error} context="The look-alikes couldn't be loaded." />
      </Section>
    )
  }
  const data = similar.data
  return (
    <Section title="Look-alikes">
      {!data ? (
        <PendingText />
      ) : data.basis === 'none' ? (
        <p className="text-muted-foreground">{data.note ?? 'This lead has no profile yet.'}</p>
      ) : (
        <>
          <p className="text-muted-foreground">
            Clients with deals, and other leads, that read alike.
          </p>
          {data.deals.length > 0 ? (
            <ShowFirst
              items={data.deals}
              label="Similar clients"
              className="gap-1"
              keyOf={(deal) => deal.hubspot_id}
              render={(deal) => (
                <>
                  {deal.name}{' '}
                  <span className="text-muted-foreground">
                    ({formatPercent(deal.similarity * 100)} alike
                    {deal.deal_names.length > 0 ? `: ${deal.deal_names.join('; ')}` : ''})
                  </span>
                </>
              )}
            />
          ) : null}
          {data.leads.length > 0 ? (
            <ShowFirst
              items={data.leads}
              label="Similar leads"
              className="gap-1"
              keyOf={(item) => item.lead_id}
              render={(item) => (
                <span className="flex flex-wrap items-center gap-2">
                  <Link
                    to={`/leads/${item.lead_id}`}
                    className="underline-offset-4 hover:underline"
                  >
                    {item.name}
                  </Link>
                  <ResultBadge result={item.result} />
                  <span className="text-muted-foreground">
                    {formatPercent(item.similarity * 100)} alike
                  </span>
                </span>
              )}
            />
          ) : null}
          {data.deals.length === 0 && data.leads.length === 0 ? (
            <p className="text-muted-foreground">Nothing reads alike yet.</p>
          ) : null}
        </>
      )}
    </Section>
  )
}

export function HubSpotTab({ lead }: { lead: LeadDetail }) {
  return (
    <>
      <HubSpot lead={lead} />
      <LookAlikes leadId={lead.id} />
    </>
  )
}
