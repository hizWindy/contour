import type { HubSpotWrite } from '@/api/types'

/** A sample HubSpot write for tests: a preview of a new company, with writing off. */
export function makeWrite(changes: Partial<HubSpotWrite> = {}): HubSpotWrite {
  return {
    id: '11111111-2222-3333-4444-555555555555',
    app: 'lead_finder',
    subject: 'lead:1',
    status: 'previewed',
    plan: {
      action: 'create',
      company_id: null,
      company_name: 'Acme Logistics',
      company_url: null,
      domain: 'acme.com.au',
      fields: [
        {
          property: 'city',
          label: 'City',
          value: 'Perth',
          current: null,
          write: true,
          reason: null,
        },
        {
          property: 'industry',
          label: 'Industry',
          value: 'LOGISTICS',
          current: 'Law Practice',
          write: false,
          reason: 'HubSpot already has a value. It is kept.',
        },
        {
          property: 'contour_ai_trigger',
          label: 'AI trigger',
          value: '<b>Lease expiry</b>',
          current: null,
          write: false,
          reason: 'HubSpot has no such field yet, so it goes in the note.',
        },
      ],
      note: 'Suggested by Contour.\nScore: 82.',
      list_name: 'AI suggested',
      list_id: '9',
      warnings: ['This company has an open deal in HubSpot.'],
    },
    steps: [],
    hubspot_company_id: null,
    hubspot_url: null,
    error: null,
    created_at: '2026-11-04T01:00:00Z',
    applied_at: null,
    finished_at: null,
    can_write: false,
    waiting_for: 'Waiting for write access',
    ...changes,
  }
}
