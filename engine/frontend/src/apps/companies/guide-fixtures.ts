/**
 * A test company for the call script's tests (PLAN-V14 Track 3): ABC Logistics in Perth, with an
 * open deal, a lease ending in Jun 2027 and a call with Jason Reeds on 1 Oct 2026. Tests only.
 *
 * PLAN-V15: its relationship stage is an open deal. A test that changes the deals or the calls
 * gives the stage too, with `stage(...)`, as the backend works it out.
 */
import type { Relationship } from '@/api/hooks/companies'
import type { CompanyDetail } from '@/api/types'

export const TODAY = '2026-11-09'
export const JASON = { name: 'Jason Reeds', title: 'Head of Operations' }

const REASONS: Record<Relationship['stage'], Omit<Relationship, 'stage'>> = {
  open_deal: {
    since: null,
    reason: 'Open deal: Perth fit-out, at Qualified Deal.',
    source: 'HubSpot deal',
  },
  customer: {
    since: '2026-10-01',
    reason: 'A customer: we won Perth fit-out in 2023, and a call with Jason Reeds on 1 Oct 2026.',
    source: 'HubSpot call, 1 Oct 2026',
  },
  past_customer: {
    since: '2023-05-01',
    reason: 'A past customer: we won Perth fit-out in 2023. No talk since 4 Feb 2024.',
    source: 'HubSpot deal',
  },
  lost_deal: {
    since: '2025-06-01',
    reason: 'Lost deal: Perth fit-out, closed 1 Jun 2025.',
    source: 'HubSpot deal',
  },
  contacted: {
    since: '2026-10-01',
    reason: 'Contacted before: the last talk on record, on 1 Oct 2026.',
    source: 'HubSpot: last contacted',
  },
  cold: {
    since: null,
    reason: 'No deal, and no talk on record in the last 24 months.',
    source: 'HubSpot copy',
  },
}

/** A relationship stage as the backend sends it, with sample words. */
export function stage(
  name: Relationship['stage'],
  changes: Partial<Relationship> = {},
): Relationship {
  return { stage: name, ...REASONS[name], ...changes }
}

export function detail(changes: Partial<CompanyDetail> = {}): CompanyDetail {
  return {
    key: '101',
    source: 'hubspot',
    name: 'ABC Logistics',
    domain: 'abclogistics.com.au',
    website: null,
    city: 'Perth',
    state: 'WA',
    industry: 'Logistics',
    staff: 300,
    linkedin_staff: 280,
    description: null,
    owner: 'Levi',
    lifecycle_stage: 'Opportunity',
    last_talk: '2026-10-01',
    last_talk_note: null,
    next_lease_end: '2027-06-30',
    deal: 'open',
    hubspot_url: null,
    offices: [
      {
        label: 'Perth',
        city: 'Perth',
        street: null,
        level: null,
        lease_end: '2027-06-30',
        moved_in: null,
        office_m2: null,
        linkedin_staff: null,
        quality: null,
      },
    ],
    deals: [
      {
        name: 'Perth fit-out',
        stage: 'Qualified Deal',
        state: 'open',
        pipeline: null,
        amount_aud: '1500000',
        close_date: '2027-03-01',
        owner: 'Levi',
        next_step: 'Site visit',
        hubspot_url: null,
      },
    ],
    notes: [],
    people: [],
    calls: [
      {
        id: '301',
        called_at: '2026-10-01T01:00:00Z',
        person: 'Jason Reeds',
        owner: 'Levi',
        minutes: 7,
        outcome: 'Connected',
        note: 'Lease ends next year.',
        hubspot_url: null,
      },
    ],
    people_status: 'ready',
    lead: null,
    relationship: stage('open_deal'),
    ...changes,
  }
}
