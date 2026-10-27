/** A lead for the lead card tests: Acme Software in Melbourne, a pass, with a hostile note. */
import type { LeadDetail } from '@/api/types'

export const LEAD_ID = '99999999-2222-3333-4444-555555555555'
export const HOSTILE = '<img src=x onerror=alert(1)>'

function fact<T>(value: T, label: 'confirmed' | 'estimated' | null = 'confirmed') {
  return {
    value,
    label: value === null ? null : label,
    source_url: value === null ? null : 'https://www.afr.com/property/acme-moves',
    source_date: value === null ? null : '2026-10-01',
  }
}

export function makeLead(changes: Partial<LeadDetail> = {}): LeadDetail {
  return {
    id: LEAD_ID,
    company: 'Acme Software',
    result: 'pass',
    score: 78,
    summary: "Acme's Melbourne lease ends in 2028 and it is looking for a bigger office.",
    why_it_fits: 'City: Melbourne. Size: about 2,500 m². Result: Pass.',
    contact_role: 'Head of Property',
    opening_line: 'Congratulations on the growth. Is a new office on the cards?',
    checks: [
      { rule: 'City', outcome: 'ok', detail: 'Melbourne is a city we work in' },
      { rule: 'Size', outcome: 'ok', detail: 'About 2,500 m², over 1,000 m²' },
      { rule: 'HubSpot', outcome: 'ok', detail: 'Not in HubSpot yet' },
    ],
    triggers: [
      {
        trigger: {
          id: 'lease_ending',
          what_happened: "Acme's Collins Street lease ends in March 2028.",
          date: '2028-03',
          source_url: 'https://www.afr.com/property/acme-moves',
          label: 'confirmed',
        },
        group: 'main',
        source_kind: 'other_news',
        points: 63,
      },
    ],
    office_m2: 2500,
    office_m2_estimated: false,
    fitout_aud: '3750000',
    facts: {
      name: 'Acme Software',
      website: fact('acme.com.au'),
      city: fact('Melbourne'),
      industry: fact('Software'),
      industry_group: null,
      owner: fact('ASX-listed, Australian'),
      staff_in_city: fact(250),
      staff_from_linkedin: false,
      office_m2: fact(2500),
      local_team_runs_project: fact(true),
      healthy: fact(true),
      triggers: [],
      boosters: [],
      expected_move: fact('2027', 'estimated'),
      contact_role: 'Head of Property',
      summary: "Acme's Melbourne lease ends in 2028.",
      opening_line: null,
    },
    hubspot: {
      status: 'new',
      hubspot_id: null,
      name: null,
      owner: null,
      matched_by: null,
      open_deals: [],
      last_dissolved: null,
      candidates: [],
    },
    notes: [
      {
        claim: HOSTILE,
        url: 'javascript:alert(1)',
        published: '2026-10-01',
        angle: 'property',
        from_memory: false,
      },
      {
        claim: "Acme's Collins Street lease ends in March 2028.",
        url: 'https://www.afr.com/property/acme-moves',
        published: '2026-10-01',
        angle: 'property',
        from_memory: true,
      },
    ],
    dropped: [],
    problems: [],
    research: {
      cost_usd: '0.400000',
      cap_usd: '2.50',
      web_searches: 6,
      claude_requests: 4,
      angles_from_memory: [],
    },
    rules_version: 'r1',
    prompt_version: 'p1',
    created_at: '2026-10-26T04:00:00Z',
    status: 'new',
    reject_reason: null,
    note: null,
    useful: null,
    run_id: null,
    origin: 'typed',
    is_test: false,
    updated_at: '2026-10-26T04:00:00Z',
    previous: [],
    ...changes,
  }
}
