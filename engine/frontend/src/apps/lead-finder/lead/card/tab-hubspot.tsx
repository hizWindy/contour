/**
 * The HubSpot and look-alikes tab: whether HubSpot has the company (its label, owner, open deals,
 * the last dissolved deal, and possible matches for a person to confirm), then the clients with
 * deals and the other leads that read alike.
 */
import { Link } from 'react-router'
import { useLeadHubSpot, useLeadSimilar } from '@/api/hooks'
import type { LeadDetail } from '@/api/types'
import { ErrorState } from '@/components/error-state'
import { InHubSpotBadge } from '@/components/hubspot'
import { ResultBadge } from '@/components/result-badge'
import { formatDate, formatPercent } from '@/lib/format'
import { Section, ShowFirst } from './parts'
import { REASON_WORDS } from './words'

function HubSpot({ lead }: { lead: LeadDetail }) {
  const hubspot = lead.hubspot
  const sent = useLeadHubSpot(lead.id).data
  return (
    <Section title="HubSpot">
      <div className="flex flex-wrap items-center gap-2">
        <InHubSpotBadge
          status={hubspot.status}
          name={hubspot.name}
          href={sent?.hubspot_url ?? null}
        />
        {hubspot.owner ? (
          <span className="text-muted-foreground">Owner: {hubspot.owner}</span>
        ) : null}
      </div>
      {hubspot.open_deals.length > 0 ? <p>Open deals: {hubspot.open_deals.join('; ')}</p> : null}
      {hubspot.last_dissolved ? (
        <p className="text-muted-foreground">
          Last deal dissolved {formatDate(hubspot.last_dissolved)}
        </p>
      ) : null}
      {hubspot.candidates.length > 0 ? (
        <div className="flex flex-col gap-1">
          <p className="font-semibold">Might be the same company. A person confirms.</p>
          <ShowFirst
            items={hubspot.candidates}
            label="Possible matches in HubSpot"
            className="gap-1"
            keyOf={(candidate) => candidate.hubspot_id}
            render={(candidate) => (
              <>
                {candidate.name}{' '}
                <span className="text-muted-foreground">
                  ({REASON_WORDS[candidate.reason] ?? candidate.reason},{' '}
                  {formatPercent(candidate.score * 100)} alike
                  {candidate.open_deals.length > 0 ? ', has an open deal' : ''})
                </span>
              </>
            )}
          />
        </div>
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
        <p className="text-muted-foreground">Loading.</p>
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
