/**
 * A test company for the call script's tests (PLAN-V14 Track 3): ABC Logistics in Perth, with an
 * open deal, a lease ending in Jun 2027 and a call with Jason Reeds on 1 Oct 2026. Tests only.
 */
import type { CompanyDetail } from '@/api/types'

export const TODAY = '2026-11-09'
export const JASON = { name: 'Jason Reeds', title: 'Head of Operations' }

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
    ...changes,
  }
}
