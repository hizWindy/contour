/**
 * "Sync with HubSpot" on the Companies page (PLAN-V15 T2-6): it asks for an "auto" sync, shows the
 * running sync's phase, and Stop ends it in the backend's words. Moved here from
 * companies.test.tsx (with its own copy of the helpers), so this track's file holds its tests.
 */
import { screen, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { queryKeys } from '@/api/query'
import type { HubSpotSync } from '@/api/types'
import { renderWithProviders } from '@/test/render'
import { HubSpotSync as HubSpotSyncButton } from './hubspot-sync'

const KEPT_NOTHING = "Stopped. Our copy didn't change."
const KEPT_COMPANIES =
  'Stopped after saving companies. People and profiles update with the next sync.'

function sync(changes: Partial<HubSpotSync> = {}): HubSpotSync {
  return {
    id: 2,
    mode: 'full',
    trigger: 'command',
    status: 'done',
    changed_since: null,
    companies_read: 13913,
    deals_read: 8943,
    owners_read: 13,
    companies_saved: 13913,
    offices_saved: 22770,
    deals_saved: 8041,
    deals_skipped: 902,
    companies_removed: 0,
    deals_removed: 0,
    profiles_rebuilt: 13913,
    people_saved: 0,
    profiles_done: 0,
    profiles_total: 0,
    profiles_skipped: false,
    phase: null,
    heartbeat_at: null,
    cancel_requested_at: null,
    error: null,
    warnings: [],
    started_at: new Date(Date.now() - 5 * 3_600_000 - 546_000).toISOString(),
    finished_at: new Date(Date.now() - 5 * 3_600_000).toISOString(),
    ...changes,
  }
}

/** A sync that is running now, in a phase. */
function running(changes: Partial<HubSpotSync> = {}): HubSpotSync {
  return sync({
    id: 5,
    status: 'running',
    trigger: 'website',
    companies_read: 0,
    deals_read: 0,
    companies_saved: 0,
    deals_saved: 0,
    profiles_rebuilt: 0,
    phase: 'reading',
    heartbeat_at: new Date().toISOString(),
    started_at: new Date().toISOString(),
    finished_at: null,
    ...changes,
  })
}

interface Backend {
  syncs: HubSpotSync[]
  /** What GET /hubspot/syncs answers once a sync is started. */
  afterStart: HubSpotSync[]
  /** The answer to Stop; it may also change what the list says next. */
  onCancel: (id: number) => Response
  calls: { method: string; path: string; search: string }[]
}

function mockSyncApi(changes: Partial<Backend> = {}): Backend {
  const backend: Backend = {
    syncs: [sync()],
    afterStart: [],
    onCancel: () => Response.json({ title: 'Not found', status: 404 }, { status: 404 }),
    calls: [],
    ...changes,
  }
  vi.stubGlobal(
    'fetch',
    vi.fn((request: Request) => {
      const url = new URL(request.url)
      const path = url.pathname
      backend.calls.push({ method: request.method, path, search: url.search })
      if (path === '/api/v1/hubspot/syncs') return Promise.resolve(Response.json(backend.syncs))
      if (path === '/api/v1/hubspot/sync' && request.method === 'POST') {
        backend.syncs = backend.afterStart
        return Promise.resolve(Response.json(backend.afterStart[0] ?? running(), { status: 202 }))
      }
      const stop = /^\/api\/v1\/hubspot\/syncs\/(\d+)\/cancel$/.exec(path)
      if (stop && request.method === 'POST') {
        return Promise.resolve(backend.onCancel(Number(stop[1])))
      }
      return Promise.resolve(Response.json({ title: 'Not found', status: 404 }, { status: 404 }))
    }),
  )
  return backend
}

// Toasts live outside the page, in one store for the whole file: clear them between tests.
afterEach(() => {
  toast.dismiss()
})

const stopsSent = (backend: Backend) =>
  backend.calls.filter((call) => call.method === 'POST' && call.path.endsWith('/cancel'))

describe('the HubSpot sync button', () => {
  it('says when our copy was updated, asks for an "auto" sync, follows it, and refreshes the list after', async () => {
    const backend = mockSyncApi({
      afterStart: [running({ mode: 'full', companies_read: 4200 }), sync()],
    })
    const { user, queryClient } = renderWithProviders(<HubSpotSyncButton />)
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    expect(await screen.findByText(/HubSpot copy updated 5 hours ago/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Sync with HubSpot' }))
    await waitFor(() => {
      const posted = backend.calls.find((call) => call.path === '/api/v1/hubspot/sync')
      expect(posted?.search).toBe('?mode=auto')
    })
    expect(
      await screen.findByText('Reading HubSpot: 4,200 of about 13,913 companies.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'HubSpot sync' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Syncing' })).toBeDisabled()

    // It finishes: the next look says what was copied, and the list is read again.
    backend.syncs = [
      sync({ id: 5, trigger: 'website', companies_saved: 13916, deals_saved: 8050 }),
      sync(),
    ]
    expect(
      await screen.findByText('HubSpot copy updated', {}, { timeout: 5000 }),
    ).toBeInTheDocument()
    expect(screen.getByText('13,916 companies and 8,050 deals copied.')).toBeInTheDocument()
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.companies.all })
  })

  it.each([
    [running({ mode: 'changes' }), 'Reading HubSpot.'],
    [running({ deals_read: 3000 }), 'Reading HubSpot: 3,000 of about 8,943 deals.'],
    [running({ phase: 'saving' }), 'Saving to our copy.'],
    [running({ phase: 'people', people_saved: 1200 }), 'Saving people (1,200).'],
    [
      running({ phase: 'profiles', profiles_done: 3400, profiles_total: 13900 }),
      'Updating profiles (3,400 of 13,900).',
    ],
  ])('says the phase: %#', async (now, words) => {
    mockSyncApi({ syncs: [now, sync()] })
    renderWithProviders(<HubSpotSyncButton />)

    expect(await screen.findByText(words)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled()
  })

  it('fills the bar through the profiles, instead of sitting at 95%', async () => {
    mockSyncApi({
      syncs: [running({ phase: 'profiles', profiles_done: 6950, profiles_total: 13900 }), sync()],
    })
    renderWithProviders(<HubSpotSyncButton />)

    const bar = await screen.findByRole('progressbar', { name: 'HubSpot sync' })
    expect(bar).toHaveAttribute('aria-valuenow', '90')
  })

  it.each([
    ['reading', KEPT_NOTHING],
    ['saving', KEPT_NOTHING],
    ['people', KEPT_COMPANIES],
    ['profiles', KEPT_COMPANIES],
  ] as const)("Stop while %s: says what was kept, in the backend's words", async (phase, kept) => {
    const now = running({ phase })
    const stopped = { ...now, status: 'cancelled' as const, phase: null, warnings: [kept] }
    const backend = mockSyncApi({
      syncs: [now, sync()],
      onCancel: () => {
        backend.syncs = [stopped, sync()]
        return Response.json(stopped, { status: 202 })
      },
    })
    const { user } = renderWithProviders(<HubSpotSyncButton />)
    await user.click(await screen.findByRole('button', { name: 'Stop' }))

    const title = await screen.findByText('HubSpot sync stopped')
    expect(title.closest('[data-sonner-toast]')).toHaveTextContent(kept)
    expect(stopsSent(backend).map((call) => call.path)).toEqual(['/api/v1/hubspot/syncs/5/cancel'])
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull()
  })

  it('says "Stopping…" with the button off while another backend stops it', async () => {
    const now = running({ phase: 'profiles', profiles_done: 100, profiles_total: 13900 })
    const asked = { ...now, cancel_requested_at: new Date().toISOString() }
    const backend = mockSyncApi({
      syncs: [now, sync()],
      onCancel: () => {
        backend.syncs = [asked, sync()]
        return Response.json(asked, { status: 202 })
      },
    })
    const { user } = renderWithProviders(<HubSpotSyncButton />)

    await user.click(await screen.findByRole('button', { name: 'Stop' }))

    const button = await screen.findByRole('button', { name: 'Stopping…' })
    expect(button).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('Stopping…')
  })

  it('a sync that had already finished (409 not_running) says so and shows its result', async () => {
    const backend = mockSyncApi({
      syncs: [running(), sync()],
      onCancel: () => {
        backend.syncs = [sync({ id: 5 }), sync()]
        return Response.json(
          {
            title: "That sync isn't running",
            detail: 'It has already finished.',
            status: 409,
            code: 'not_running',
          },
          { status: 409 },
        )
      },
    })
    const { user } = renderWithProviders(<HubSpotSyncButton />)

    await user.click(await screen.findByRole('button', { name: 'Stop' }))

    expect(await screen.findByText('That sync had already finished')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull()
    })
  })
})
