import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { HubSpotSync } from '@/api/types'
import { mockApi, type Call } from '@/test/mock-api'
import { renderWithProviders } from '@/test/render'
import AdminHubSpotTab from './hubspot'

const HUBSPOT_STATUS = {
  key_set: true,
  api_version: '2026-09',
  write_enabled: false,
  check: {
    key_set: true,
    connected: true,
    portal_id: 1234567,
    problem: null,
    checked_at: '2026-11-04T01:00:00Z',
    scopes: [
      {
        scope: 'crm.objects.companies.read',
        access: 'read',
        label: 'Read companies',
        state: 'yes',
        detail: null,
      },
      {
        scope: 'crm.objects.companies.write',
        access: 'write',
        label: 'Add and update companies, and add notes to them',
        state: 'no',
        detail: 'HubSpot said this permission is missing.',
      },
    ],
  },
  projects: [
    {
      app: 'lead_finder',
      title: 'Lead Finder',
      uses: 'Reads companies for the watchlist.',
      reading: 'ready',
      sending: 'waiting',
      waiting_for: ['crm.objects.companies.write'],
      summary: 'Lead Finder: reading ready. Sending waits for crm.objects.companies.write.',
    },
  ],
  running_sync: null,
  last_good_sync: null,
  recent_syncs: [],
  copy_counts: {
    companies: 0,
    offices: 0,
    deals: 0,
    owners: 0,
    last_imported_at: null,
    companies_by_source: { export: 0, api: 0 },
  },
}

describe('Admin, HubSpot', () => {
  it('shows the local copy, the watchlist and keeps Upload off until a file is chosen', async () => {
    mockApi({
      '/api/v1/hubspot/summary': {
        companies: 100,
        offices: 185,
        deals: 12,
        last_imported_at: '2026-10-25T01:00:00Z',
      },
      '/api/v1/lead-finder/watchlist': {
        total: 1,
        items: [
          {
            hubspot_id: '1',
            name: 'Synechron Australia',
            city: 'Melbourne',
            industry: 'Information Technology And Services',
            office_based: 'likely',
            linkedin_staff: 120,
            estimated_staff: 240,
            owner: null,
            last_dissolved: null,
            note: null,
          },
        ],
        director: [],
        staff_unknown: [],
        counts: {
          companies: 99,
          watch: 47,
          likely: 11,
          unlikely: 36,
          director: 15,
          open_deal: 7,
          dropped_small: 21,
          staff_unknown: 1,
          no_office: 10,
        },
      },
    })
    const { user } = renderWithProviders(<AdminHubSpotTab />)
    await user.click(
      await screen.findByRole('button', { name: 'More: the watchlist and the export backup' }),
    )
    expect(await screen.findByText('Synechron Australia')).toBeInTheDocument()
    expect(screen.getByText(/47 to watch \(11 likely/)).toBeInTheDocument()
    // The export upload is the backup now, folded away until opened.
    expect(screen.queryByRole('button', { name: 'Upload' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Backup: upload an export' }))
    expect(await screen.findByText('100 companies, 185 offices, 12 deals.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Upload' })).toBeDisabled()
  })

  it('shows the connection, each permission and project, and starts a sync', async () => {
    const calls = mockApi({
      '/api/v1/hubspot/status': HUBSPOT_STATUS,
      '/api/v1/hubspot/writes': [],
      '/api/v1/hubspot/sync': (call: Call) =>
        call.method === 'POST'
          ? Response.json(
              {
                id: 1,
                mode: 'full',
                trigger: 'website',
                status: 'running',
                changed_since: null,
                companies_read: 0,
                deals_read: 0,
                owners_read: 0,
                companies_saved: 0,
                offices_saved: 0,
                deals_saved: 0,
                deals_skipped: 0,
                companies_removed: 0,
                deals_removed: 0,
                profiles_rebuilt: 0,
                error: null,
                warnings: [],
                started_at: '2026-11-04T01:00:00Z',
                finished_at: null,
              },
              { status: 202 },
            )
          : undefined,
    })
    const { user } = renderWithProviders(<AdminHubSpotTab />)
    expect(await screen.findByText('Yes, account 1234567')).toBeInTheDocument()
    expect(screen.getByText(/Off \(a server setting\)/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /of \d+ permissions/ }))
    const permissions = await screen.findByRole('list', { name: 'Permissions' })
    expect(permissions).toHaveTextContent('Yes: Read companies')
    expect(permissions).toHaveTextContent('No: Add and update companies')
    expect(
      screen.getByText(
        'Lead Finder: reading ready. Sending waits for crm.objects.companies.write.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText(/No sync yet/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Sync now' }))
    await waitFor(() => {
      expect(
        calls.some((call) => call.method === 'POST' && call.path === '/api/v1/hubspot/sync'),
      ).toBe(true)
    })
    expect(calls.find((call) => call.path === '/api/v1/hubspot/sync')?.search).toBe('?mode=auto')
    expect(JSON.stringify(calls)).not.toContain('pat-') // no key ever travels to the page
  })
})

/** A sync as `/hubspot/status` lists it (PLAN-V15 T2-6 adds the phase and the counters). */
function adminSync(changes: Partial<HubSpotSync> = {}): HubSpotSync {
  return {
    id: 7,
    mode: 'full',
    trigger: 'website',
    status: 'running',
    changed_since: null,
    companies_read: 13900,
    deals_read: 8900,
    owners_read: 13,
    companies_saved: 13900,
    offices_saved: 22000,
    deals_saved: 8000,
    deals_skipped: 900,
    companies_removed: 0,
    deals_removed: 0,
    profiles_rebuilt: 0,
    people_saved: 1200,
    profiles_done: 3400,
    profiles_total: 13900,
    profiles_skipped: false,
    phase: 'profiles',
    heartbeat_at: '2026-11-12T01:00:00Z',
    cancel_requested_at: null,
    error: null,
    warnings: [],
    started_at: '2026-11-12T00:50:00Z',
    finished_at: null,
    ...changes,
  }
}

describe('Admin, HubSpot: stopping a sync, and a full copy (PLAN-V15 T2-6)', () => {
  it('keeps "Full copy" beside "Sync now", and it asks for everything', async () => {
    const calls = mockApi({
      '/api/v1/hubspot/status': HUBSPOT_STATUS,
      '/api/v1/hubspot/writes': [],
      '/api/v1/hubspot/sync': (call: Call) =>
        call.method === 'POST' ? Response.json(adminSync(), { status: 202 }) : undefined,
    })
    const { user } = renderWithProviders(<AdminHubSpotTab />)

    await user.click(await screen.findByRole('button', { name: 'Full copy' }))

    await waitFor(() => {
      expect(calls.find((call) => call.path === '/api/v1/hubspot/sync')?.search).toBe('?mode=full')
    })
  })

  it('shows the running phase and Stop, which stops it and says "Stopping…" until it has', async () => {
    const asked = adminSync({ cancel_requested_at: '2026-11-12T01:00:05Z' })
    let status = { ...HUBSPOT_STATUS, running_sync: adminSync(), recent_syncs: [adminSync()] }
    const calls = mockApi({
      '/api/v1/hubspot/status': () => Response.json(status),
      '/api/v1/hubspot/writes': [],
      '/api/v1/hubspot/syncs/7/cancel': (call: Call) => {
        if (call.method !== 'POST') return undefined
        status = { ...status, running_sync: asked, recent_syncs: [asked] }
        return Response.json(asked, { status: 202 })
      },
    })
    const { user } = renderWithProviders(<AdminHubSpotTab />)

    expect(await screen.findByText(/Updating profiles \(3,400 of 13,900\)\./)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sync now' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Stop' }))

    expect(await screen.findByRole('button', { name: 'Stopping…' })).toBeDisabled()
    expect(
      calls.filter((call) => call.method === 'POST' && call.path.endsWith('/cancel')),
    ).toHaveLength(1)
  })

  it('lists a stopped sync with what it kept', async () => {
    const stopped = adminSync({
      status: 'cancelled',
      phase: null,
      finished_at: '2026-11-12T01:00:06Z',
      warnings: ['Stopped after saving companies. People and profiles update with the next sync.'],
    })
    mockApi({
      '/api/v1/hubspot/status': { ...HUBSPOT_STATUS, recent_syncs: [stopped] },
      '/api/v1/hubspot/writes': [],
    })
    renderWithProviders(<AdminHubSpotTab />)

    const list = await screen.findByRole('list', { name: 'Recent syncs' })
    expect(list).toHaveTextContent('Stopped')
    expect(list).toHaveTextContent(
      'Stopped after saving companies. People and profiles update with the next sync.',
    )
  })
})
