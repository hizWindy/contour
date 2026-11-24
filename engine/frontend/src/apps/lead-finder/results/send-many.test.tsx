/**
 * PLAN-V27 T3-2: tick leads on Results, see one preview for the batch, and send it after a 5
 * second hold with Undo. Made-up names only (Northwind, Jo Sample, Sample Logistics).
 */
import { act, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  HubSpotBatchPreview,
  HubSpotBatchPreviewItem,
  HubSpotBatchSent,
  HubSpotWrite,
  LeadFacets,
  LeadRow,
} from '@/api/types'
import { makeWrite } from '@/components/hubspot/test-write'
import { renderWithProviders } from '@/test/render'
import { asLaptop, asPhone } from '@/test/screen'
import ResultsPage from './index'

const NORTHWIND = '10000000-0000-4000-8000-000000000001'
const LOGISTICS = '10000000-0000-4000-8000-000000000002'
const FOODS = '10000000-0000-4000-8000-000000000003'
const FREIGHT = '10000000-0000-4000-8000-000000000004'

function makeRow(changes: Partial<LeadRow>): LeadRow {
  return {
    id: NORTHWIND,
    company: 'Northwind',
    result: 'pass',
    stage: 'Active prospect',
    score: 51,
    score_checked: 77,
    band: 'investigate',
    city: 'Perth',
    suburb: null,
    contact_role: null,
    cost_usd: '0.400000',
    created_at: '2026-11-20T04:00:00Z',
    form_failed: false,
    updated_at: '2026-11-20T04:00:00Z',
    hubspot_status: 'new',
    industry: 'Logistics',
    industry_group: 'Transport',
    is_test: false,
    note: null,
    office_m2: 1000,
    office_m2_estimated: true,
    origin: 'web',
    reason: 'City: Perth.',
    run_id: null,
    staff_in_city: 100,
    status: 'new',
    trigger_date: null,
    trigger_id: null,
    trigger_ids: [],
    trigger_label: null,
    useful: null,
    web_searches: 4,
    tier: 'B',
    confidence: 'medium',
    excluded: null,
    has_property: false,
    ...changes,
  }
}

const ROWS: LeadRow[] = [
  makeRow({ id: NORTHWIND, company: 'Northwind' }),
  makeRow({ id: LOGISTICS, company: 'Sample Logistics' }),
  makeRow({ id: FOODS, company: 'Sample Foods' }),
  makeRow({ id: FREIGHT, company: 'Sample Freight', status: 'sent', hubspot_status: 'in_hubspot' }),
]

const FACETS: LeadFacets = {
  result: [{ value: 'pass', count: 4 }],
  city: [{ value: 'Perth', count: 4 }],
  trigger: [],
  industry: [],
  industry_group: [],
  hubspot_status: [{ value: 'new', count: 3 }],
  status: [{ value: 'new', count: 3 }],
  origin: [{ value: 'web', count: 4 }],
  runs: [],
  score: { min: 51, max: 51 },
  office_m2: { min: 1000, max: 1000 },
  created: { min: '2026-11-20', max: '2026-11-20' },
  tier: [{ value: 'B', count: 4 }],
}

const WRITE_IDS: Record<string, string> = {
  [NORTHWIND]: '20000000-0000-4000-8000-000000000001',
  [LOGISTICS]: '20000000-0000-4000-8000-000000000002',
  [FOODS]: '20000000-0000-4000-8000-000000000003',
}

const COMPANY: Record<string, string> = {
  [NORTHWIND]: 'Northwind',
  [LOGISTICS]: 'Sample Logistics',
  [FOODS]: 'Sample Foods',
}

/** Northwind is in HubSpot with 2 empty fields to fill; the others are new companies. */
function writeFor(leadId: string): HubSpotWrite {
  const base = makeWrite({ can_write: true, waiting_for: null })
  const update = leadId === NORTHWIND
  return {
    ...base,
    id: WRITE_IDS[leadId] ?? base.id,
    subject: `lead:${leadId}`,
    plan: {
      ...base.plan,
      action: update ? 'update' : 'create',
      company_name: COMPANY[leadId] ?? 'Sample',
      company_id: update ? '501' : null,
      warnings: [],
      fields: update
        ? [
            { ...base.plan.fields[0], write: true },
            {
              property: 'hubspot_owner_id',
              label: 'Owner',
              value: '77',
              current: null,
              write: true,
              changed_since: false,
              reason: null,
            },
            base.plan.fields[1],
          ]
        : base.plan.fields,
    },
  }
}

function previewOf(
  ids: string[],
  change: (item: HubSpotBatchPreviewItem) => HubSpotBatchPreviewItem = (item) => item,
): HubSpotBatchPreview {
  return {
    items: ids.map((id) =>
      change({
        lead_id: id,
        company: COMPANY[id] ?? null,
        write: writeFor(id),
        already_sent: false,
        problem: null,
      }),
    ),
    owner: { name: 'Jo Sample', hubspot_owner_id: '77' },
    can_write: true,
    waiting_for: null,
  }
}

type Sender = (pairs: { lead_id: string; write_id: string }[]) => Response

interface Backend {
  rows: LeadRow[]
  requests: { path: string; method: string; body: unknown }[]
  me?: unknown
  preview?: (ids: string[]) => HubSpotBatchPreview
  send?: Sender
}

const sentAll: Sender = (pairs) => {
  const out: HubSpotBatchSent = {
    items: pairs.map((pair) => ({
      lead_id: pair.lead_id,
      company: COMPANY[pair.lead_id] ?? null,
      result: 'sent',
      write: { ...writeFor(pair.lead_id), status: 'done' },
      problem: null,
    })),
    sent: pairs.length,
    failed: 0,
    already_sent: 0,
  }
  return Response.json(out)
}

function mockApi(changes: Partial<Backend> = {}): Backend {
  const backend: Backend = { rows: ROWS, requests: [], ...changes }
  const respond = (path: string, body: unknown): Response => {
    switch (path) {
      case '/api/v1/auth/me':
        return backend.me
          ? Response.json(backend.me)
          : Response.json({ title: 'Not found', status: 404 }, { status: 404 })
      case '/api/v1/lead-finder/leads':
        return Response.json({ total: backend.rows.length, items: backend.rows })
      case '/api/v1/lead-finder/leads/facets':
        return Response.json(FACETS)
      case '/api/v1/lead-finder/leads/hubspot/preview-many': {
        const ids = (body as { lead_ids: string[] }).lead_ids
        return Response.json((backend.preview ?? previewOf)(ids))
      }
      case '/api/v1/lead-finder/leads/hubspot/send-many':
        return (backend.send ?? sentAll)((body as { items: [] }).items)
    }
    return Response.json({ title: 'Not found', status: 404 }, { status: 404 })
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const url = new URL(request.url)
      const body: unknown = request.method === 'POST' ? await request.clone().json() : null
      backend.requests.push({ path: url.pathname, method: request.method, body })
      return respond(url.pathname, body)
    }),
  )
  return backend
}

function calls(backend: Backend, path: string) {
  return backend.requests.filter((call) => call.path === `/api/v1/lead-finder/leads${path}`)
}

function signedIn(role: 'viewer' | 'staff', features: string[]) {
  return {
    auth_required: true,
    user: {
      id: 'u-1',
      email: 'jo@example.test',
      username: null,
      name: 'Jo Sample',
      position: null,
      role,
      apps: ['lead_finder'],
      features,
      hubspot_owner: null,
      active: true,
      last_signed_in_at: '2026-11-20T01:00:00Z',
      created_at: '2026-11-01T00:00:00Z',
    },
    session: { id: 'sess-1', current: true },
  }
}

function renderResults() {
  return renderWithProviders(<ResultsPage />, { route: '/results' })
}

async function table() {
  const found = await screen.findByRole('table', { name: 'Leads' })
  await within(found).findByText('Northwind')
  return found
}

function bar() {
  return screen.getByRole('region', { name: 'Selected leads' })
}

async function openPreview(user: ReturnType<typeof renderResults>['user']) {
  await user.click(within(bar()).getByRole('button', { name: 'Add to HubSpot' }))
  const dialog = await screen.findByRole('alertdialog')
  await within(dialog).findByRole('list', { name: 'The leads' })
  return dialog
}

afterEach(() => {
  window.localStorage.clear()
})

describe.each([
  ['1440', asLaptop],
  ['390', asPhone],
])('Results adds ticked leads to HubSpot at %s px (PLAN-V27 T3-2)', (_width, screenSize) => {
  it('ticking a lead shows the bar with the count and "Add to HubSpot"', async () => {
    screenSize()
    mockApi()
    const { user } = renderResults()
    const leads = await table()
    expect(screen.queryByRole('button', { name: 'Add to HubSpot' })).toBeNull()

    await user.click(within(leads).getByRole('checkbox', { name: 'Select Northwind' }))
    expect(within(bar()).getByText('1 selected')).toBeInTheDocument()
    expect(within(bar()).getByRole('button', { name: 'Add to HubSpot' })).toBeEnabled()

    await user.click(within(bar()).getByRole('button', { name: 'Clear selection' }))
    expect(screen.queryByRole('button', { name: 'Add to HubSpot' })).toBeNull()
    expect(within(leads).getByRole('checkbox', { name: 'Select Northwind' })).not.toBeChecked()
  })

  it('"Select all on this page" ticks every lead but the one already sent, which says why', async () => {
    screenSize()
    mockApi()
    const { user } = renderResults()
    const leads = await table()
    const sent = within(leads).getByRole('checkbox', {
      name: 'Sample Freight was sent to HubSpot already',
    })
    expect(sent).toBeDisabled()

    await user.click(within(leads).getByRole('checkbox', { name: 'Select all on this page' }))
    expect(within(bar()).getByText('3 selected')).toBeInTheDocument()
    expect(sent).not.toBeChecked()
    await user.click(within(leads).getByRole('checkbox', { name: 'Select all on this page' }))
    expect(screen.queryByText('3 selected')).toBeNull()
  })

  it('the preview lists each lead with what it does, the owner and the list', async () => {
    screenSize()
    const backend = mockApi()
    const { user } = renderResults()
    const leads = await table()
    await user.click(within(leads).getByRole('checkbox', { name: 'Select Northwind' }))
    await user.click(within(leads).getByRole('checkbox', { name: 'Select Sample Logistics' }))

    const dialog = await openPreview(user)
    expect(calls(backend, '/hubspot/preview-many')[0]?.body).toEqual({
      lead_ids: [NORTHWIND, LOGISTICS],
    })
    expect(within(dialog).getByText('Add 2 leads to HubSpot?')).toBeInTheDocument()
    const rows = within(within(dialog).getByRole('list', { name: 'The leads' })).getAllByRole(
      'listitem',
    )
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByText('Northwind')).toBeInTheDocument()
    expect(within(rows[0]).getByText('Fills 2 empty fields in Northwind')).toBeInTheDocument()
    expect(within(rows[1]).getByText('New company')).toBeInTheDocument()
    expect(within(dialog).getByText('Jo Sample')).toBeInTheDocument()
    expect(within(dialog).getByText('AI suggested')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Add 2 to HubSpot' })).toBeEnabled()
    expect(calls(backend, '/hubspot/send-many')).toHaveLength(0)
  })

  it('Send waits 5 seconds with Undo, and Undo sends nothing', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    screenSize()
    const backend = mockApi()
    const { user } = renderResults()
    const leads = await table()
    await user.click(within(leads).getByRole('checkbox', { name: 'Select Northwind' }))
    const dialog = await openPreview(user)

    await user.click(within(dialog).getByRole('button', { name: 'Add 1 to HubSpot' }))
    expect(within(dialog).getByText('Sending in 5 s.', { selector: '[aria-hidden]' })).toBeVisible()
    const undo = within(dialog).getByRole('button', { name: 'Undo' })
    expect(undo).toHaveFocus()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(calls(backend, '/hubspot/send-many')).toHaveLength(0)

    await user.click(undo)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000)
    })
    expect(calls(backend, '/hubspot/send-many')).toHaveLength(0)
    // Back on the preview, ready to send again.
    expect(within(dialog).getByRole('button', { name: 'Add 1 to HubSpot' })).toHaveFocus()

    await user.click(within(dialog).getByRole('button', { name: 'Add 1 to HubSpot' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    await waitFor(() => {
      expect(calls(backend, '/hubspot/send-many')).toHaveLength(1)
    })
    expect(calls(backend, '/hubspot/send-many')[0]?.body).toEqual({
      items: [{ lead_id: NORTHWIND, write_id: WRITE_IDS[NORTHWIND] }],
    })
  })

  it('each row shows its result, the batch is said once, and the leads are read again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    screenSize()
    const backend = mockApi({
      send: (pairs) =>
        Response.json({
          items: pairs.map((pair) =>
            pair.lead_id === FOODS
              ? {
                  lead_id: pair.lead_id,
                  company: 'Sample Foods',
                  result: 'failed',
                  write: null,
                  problem: 'HubSpot refused the website.',
                }
              : {
                  lead_id: pair.lead_id,
                  company: COMPANY[pair.lead_id],
                  result: 'sent',
                  write: { ...writeFor(pair.lead_id), status: 'done' },
                  problem: null,
                },
          ),
          sent: 2,
          failed: 1,
          already_sent: 0,
        } satisfies HubSpotBatchSent),
    })
    const { user } = renderResults()
    const leads = await table()
    await user.click(within(leads).getByRole('checkbox', { name: 'Select all on this page' }))
    const dialog = await openPreview(user)
    const reads = calls(backend, '').filter((call) => call.method === 'GET').length

    await user.click(within(dialog).getByRole('button', { name: 'Add 3 to HubSpot' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    const summary = '2 added. 1 failed: HubSpot refused the website.'
    await within(dialog).findByText(summary)
    // One live region says it, once; no toast repeats it.
    expect(screen.getAllByText(summary)).toHaveLength(1)
    expect(screen.getByText(summary)).toHaveAttribute('role', 'status')
    const rows = within(within(dialog).getByRole('list', { name: 'The leads' })).getAllByRole(
      'listitem',
    )
    expect(within(rows[0]).getByText('Added.')).toBeInTheDocument()
    expect(within(rows[1]).getByText('Added.')).toBeInTheDocument()
    expect(within(rows[2]).getByText('Failed: HubSpot refused the website.')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Close' })).toHaveFocus()
    await waitFor(() => {
      expect(calls(backend, '').filter((call) => call.method === 'GET').length).toBeGreaterThan(
        reads,
      )
    })

    // Closing unticks the leads that went; the one that failed stays ticked to try again.
    await user.click(within(dialog).getByRole('button', { name: 'Close' }))
    await waitFor(() => {
      expect(within(bar()).getByText('1 selected')).toBeInTheDocument()
    })
    expect(within(leads).getByRole('checkbox', { name: 'Select Sample Foods' })).toBeChecked()
  })

  it('a refused batch (writing switched off) says so in plain words, and nothing was sent', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    screenSize()
    mockApi({
      send: () =>
        Response.json(
          {
            type: 'about:blank',
            title: 'Waiting for write access',
            status: 409,
            detail:
              'Writing to HubSpot is switched off. An admin needs to give the key write access and switch writing on.',
            code: 'hubspot_write_off',
            request_id: 'req-1',
          },
          { status: 409, headers: { 'content-type': 'application/problem+json' } },
        ),
    })
    const { user } = renderResults()
    const leads = await table()
    await user.click(within(leads).getByRole('checkbox', { name: 'Select Northwind' }))
    const dialog = await openPreview(user)
    await user.click(within(dialog).getByRole('button', { name: 'Add 1 to HubSpot' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(await within(dialog).findByText('Waiting for write access')).toBeInTheDocument()
    expect(within(dialog).getByText(/Writing to HubSpot is switched off/)).toBeInTheDocument()
    expect(within(dialog).getByText('Nothing was sent.')).toBeInTheDocument()
    expect(within(dialog).queryByText('Added.')).toBeNull()
  })
})

describe('the bulk add to HubSpot, more cases (PLAN-V27 T3-2)', () => {
  it('marks a lead sent before and one with a problem, and leaves both out of the send', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    asLaptop()
    const backend = mockApi({
      preview: (ids) =>
        previewOf(ids, (item) =>
          item.lead_id === LOGISTICS
            ? { ...item, already_sent: true, write: { ...item.write!, status: 'done' } }
            : item.lead_id === FOODS
              ? { ...item, write: null, problem: "HubSpot didn't answer. Try again in a minute." }
              : item,
        ),
    })
    const { user } = renderResults()
    const leads = await table()
    await user.click(within(leads).getByRole('checkbox', { name: 'Select all on this page' }))
    const dialog = await openPreview(user)
    const rows = within(within(dialog).getByRole('list', { name: 'The leads' })).getAllByRole(
      'listitem',
    )
    expect(within(rows[1]).getByText('Already in HubSpot. Left out.')).toBeInTheDocument()
    expect(
      within(rows[2]).getByText("Left out: HubSpot didn't answer. Try again in a minute."),
    ).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Add 1 to HubSpot' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    await within(dialog).findByText('1 added.')
    expect(calls(backend, '/hubspot/send-many')[0]?.body).toEqual({
      items: [{ lead_id: NORTHWIND, write_id: WRITE_IDS[NORTHWIND] }],
    })
  })

  it('says "No owner" when the sender has no HubSpot user', async () => {
    asLaptop()
    mockApi({
      preview: (ids) => ({
        ...previewOf(ids),
        owner: { name: 'Jo Sample', hubspot_owner_id: null },
      }),
    })
    const { user } = renderResults()
    const leads = await table()
    await user.click(within(leads).getByRole('checkbox', { name: 'Select Northwind' }))
    const dialog = await openPreview(user)
    expect(within(dialog).getByText('No owner')).toBeInTheDocument()
    expect(within(dialog).queryByText('Jo Sample')).toBeNull()
  })

  it('beyond 25 the button is off, and the bar says so plainly', async () => {
    asLaptop()
    const many = Array.from({ length: 26 }, (_, index) =>
      makeRow({
        id: `30000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        company: index === 0 ? 'Northwind' : `Sample ${String(index)}`,
      }),
    )
    mockApi({ rows: many })
    const { user } = renderResults()
    const leads = await table()
    await user.click(within(leads).getByRole('checkbox', { name: 'Select all on this page' }))
    expect(within(bar()).getByText('26 selected')).toBeInTheDocument()
    expect(within(bar()).getByRole('button', { name: 'Add to HubSpot' })).toBeDisabled()
    expect(
      within(bar()).getByText('You can add at most 25 at a time. Untick 1 to go on.'),
    ).toBeInTheDocument()
  })

  it.each([
    ['a Viewer', signedIn('viewer', ['lead_finder.results', 'lead_finder.send_to_hubspot'])],
    ['someone without the send tick', signedIn('staff', ['lead_finder.results'])],
  ])('%s sees no tick boxes and no bar', async (_who, me) => {
    asLaptop()
    mockApi({ me })
    renderResults()
    const leads = await table()
    expect(within(leads).queryByRole('checkbox')).toBeNull()
    expect(screen.queryByRole('region', { name: 'Selected leads' })).toBeNull()
  })

  it('a Staff member with the send tick gets the boxes', async () => {
    asLaptop()
    mockApi({ me: signedIn('staff', ['lead_finder.results', 'lead_finder.send_to_hubspot']) })
    renderResults()
    const leads = await table()
    expect(within(leads).getByRole('checkbox', { name: 'Select Northwind' })).toBeInTheDocument()
  })

  it('works with the keyboard alone: Tab, Space, the dialog keeps the focus, Esc undoes then closes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    asLaptop()
    const backend = mockApi()
    const { user } = renderResults()
    const leads = await table()
    const box = within(leads).getByRole('checkbox', { name: 'Select Northwind' })

    // Tab from the search box reaches the row's box.
    act(() => {
      screen.getByRole('textbox', { name: 'Search company names' }).focus()
    })
    for (let step = 0; step < 40 && document.activeElement !== box; step += 1) {
      await user.tab()
    }
    expect(box).toHaveFocus()
    await user.keyboard(' ')
    expect(box).toBeChecked()

    // Back up to the bar's button, and open the preview with Enter.
    const add = within(bar()).getByRole('button', { name: 'Add to HubSpot' })
    for (let step = 0; step < 40 && document.activeElement !== add; step += 1) {
      await user.tab({ shift: true })
    }
    expect(add).toHaveFocus()
    await user.keyboard('{Enter}')
    const dialog = await screen.findByRole('alertdialog')
    await within(dialog).findByRole('list', { name: 'The leads' })

    // The focus stays in the dialog.
    for (let step = 0; step < 6; step += 1) {
      await user.tab()
      expect(dialog.contains(document.activeElement)).toBe(true)
    }
    const send = within(dialog).getByRole('button', { name: 'Add 1 to HubSpot' })
    for (let step = 0; step < 6 && document.activeElement !== send; step += 1) {
      await user.tab()
    }
    expect(send).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(within(dialog).getByRole('button', { name: 'Undo' })).toHaveFocus()

    // Esc in the hold is Undo: nothing goes, and the dialog stays.
    await user.keyboard('{Escape}')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000)
    })
    expect(calls(backend, '/hubspot/send-many')).toHaveLength(0)
    expect(within(dialog).getByRole('button', { name: 'Add 1 to HubSpot' })).toHaveFocus()

    // A second Esc closes the dialog, and the lead stays ticked.
    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull()
    })
    expect(box).toBeChecked()
    expect(calls(backend, '/hubspot/send-many')).toHaveLength(0)
  })
})
