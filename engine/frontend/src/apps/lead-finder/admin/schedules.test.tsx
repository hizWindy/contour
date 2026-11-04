import { screen, waitFor, within } from '@testing-library/react'
import { Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import type { Schedule } from '@/api/types'
import { renderWithProviders } from '@/test/render'
import SchedulesTab from './schedules'

const FINDER_ID = '5d1b7c44-0000-4000-8000-000000000001'
const SYNC_ID = '5d1b7c44-0000-4000-8000-000000000002'
const RUN_ID = '0f3c9a2e-1111-2222-3333-444444444444'

function finder(changes: Partial<Schedule> = {}): Schedule {
  return {
    id: FINDER_ID,
    project: 'lead_finder',
    job: 'lead_finder.discovery',
    name: 'Find new leads',
    enabled: false,
    every: 2,
    unit: 'weeks',
    weekday: 0,
    at: '07:00',
    timezone: 'Australia/Melbourne',
    when: 'Every 2 weeks on Monday at 7:00 am',
    settings: {},
    summary: 'Searches Melbourne, Adelaide and Perth for the 4 main signs, looking back 14 days.',
    next_run_at: null,
    last_run_at: null,
    last_status: null,
    last_kind: null,
    last_id: null,
    last_error: null,
    running: false,
    installed: true,
    estimate: {
      valid: true,
      problem: null,
      typical_usd: '7.80',
      worst_usd: '20.00',
      per_month_usd: '16.96',
      cap_usd: '20.00',
      daily_left_usd: '50.00',
      basis: 'US$0.30 a company, the average of 6 past companies',
    },
    ...changes,
  }
}

function hubspot(changes: Partial<Schedule> = {}): Schedule {
  return {
    id: SYNC_ID,
    project: 'core',
    job: 'core.hubspot_sync',
    name: 'Copy HubSpot',
    enabled: true,
    every: 1,
    unit: 'days',
    weekday: null,
    at: '06:00',
    timezone: 'Australia/Melbourne',
    when: 'Every day at 6:00 am',
    settings: { mode: 'auto' },
    summary: 'Copies everything when the last full copy is old, and only what changed otherwise.',
    next_run_at: '2026-11-04T19:00:00Z',
    last_run_at: '2026-11-03T19:00:00Z',
    last_status: 'started',
    last_kind: 'sync',
    last_id: '7',
    last_error: null,
    running: false,
    installed: true,
    estimate: {
      valid: true,
      problem: null,
      typical_usd: '0.00',
      worst_usd: '0.00',
      per_month_usd: '0.00',
      cap_usd: '0.00',
      daily_left_usd: '0.00',
      basis: 'Copying HubSpot is free: it reads HubSpot and asks Claude nothing.',
    },
    ...changes,
  }
}

/** A new database has no past prices, so a run looks like US$24.80, above the US$20 limit. */
function overTheLimit(): Schedule {
  const base = finder()
  const basis = 'US$1.00 a company, a default'
  return finder({
    estimate: {
      ...base.estimate!,
      typical_usd: '24.80',
      per_month_usd: '53.92',
      basis,
      problem: `A typical run costs about US$24.80, which is more than the run limit of US$20.00. Prices used: ${basis}. Pick fewer cities or signs, or raise the run limit in Settings.`,
    },
  })
}

interface Call {
  method: string
  path: string
  body: unknown
}

/** Answers the three routes the tab uses, and records every call. */
function mockApi(
  items: Schedule[],
  answers: { patch?: (call: Call) => Response; run?: (call: Call) => Response } = {},
): Call[] {
  const calls: Call[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const url = new URL(request.url)
      const text = request.method === 'GET' ? '' : await request.text()
      const call: Call = {
        method: request.method,
        path: url.pathname,
        body: text ? (JSON.parse(text) as unknown) : null,
      }
      calls.push(call)
      if (call.method === 'GET' && call.path === '/api/v1/schedules') {
        return Response.json({ items })
      }
      if (call.method === 'PATCH' && answers.patch) return answers.patch(call)
      if (call.method === 'POST' && call.path.endsWith('/run') && answers.run) {
        return answers.run(call)
      }
      return Response.json({ title: 'Not found', status: 404 }, { status: 404 })
    }),
  )
  return calls
}

function renderTab() {
  return renderWithProviders(
    <Routes>
      <Route path="/admin/schedules" element={<SchedulesTab />} />
      <Route path="/runs/:runId" element={<p>Opened the run</p>} />
      <Route path="/admin/hubspot" element={<p>Opened the syncs</p>} />
    </Routes>,
    { route: '/admin/schedules' },
  )
}

async function card(name: string) {
  const heading = await screen.findByText(name)
  const found = heading.closest('[data-schedule]')
  if (!(found instanceof HTMLElement)) throw new Error(`no card for ${name}`)
  return within(found)
}

function sent(calls: Call[], method: string): Call[] {
  return calls.filter((call) => call.method === method)
}

describe('the schedules tab', () => {
  it('shows each schedule in words, with its next and last run and what a run costs', async () => {
    mockApi([finder(), hubspot()])
    renderTab()

    const lead = await card('Find new leads')
    expect(lead.getByText('Every 2 weeks on Monday at 7:00 am, Melbourne time.')).toBeVisible()
    expect(
      lead.getByText(/Searches Melbourne, Adelaide and Perth for the 4 main signs/),
    ).toBeVisible()
    expect(lead.getByText(/None\. It is off/)).toBeVisible()
    expect(lead.getByText('Never.')).toBeVisible()
    expect(lead.getByText(/US\$7\.80/)).toBeVisible()
    expect(lead.getByText(/never more than/)).toHaveTextContent('US$20.00')
    expect(lead.getByText(/a month at this schedule/)).toHaveTextContent('US$16.96')
    expect(lead.getByText(/Prices used: US\$0\.30 a company/)).toBeVisible()
    expect(lead.getByRole('switch', { name: 'Find new leads on or off' })).not.toBeChecked()

    const sync = await card('Copy HubSpot')
    expect(sync.getByText('Every day at 6:00 am, Melbourne time.')).toBeVisible()
    expect(sync.getByText(/5 Nov 2026, 6:00 am/)).toBeVisible()
    expect(sync.getByText('Free.')).toBeVisible()
    expect(sync.getByText(/Started 4 Nov 2026, 6:00 am\./)).toBeVisible()
    expect(sync.getByRole('link', { name: 'See the syncs' })).toHaveAttribute(
      'href',
      '/admin/hubspot',
    )
    expect(sync.getByRole('switch', { name: 'Copy HubSpot on or off' })).toBeChecked()
  })

  it('links the last run to the run', async () => {
    mockApi([
      finder({
        enabled: true,
        next_run_at: '2026-11-08T20:00:00Z',
        last_run_at: '2026-10-26T20:00:00Z',
        last_status: 'started',
        last_kind: 'run',
        last_id: RUN_ID,
      }),
    ])
    const { user } = renderTab()

    const lead = await card('Find new leads')
    await user.click(lead.getByRole('link', { name: 'Open the run' }))
    expect(await screen.findByText('Opened the run')).toBeInTheDocument()
  })

  it('says why the last start did not happen', async () => {
    mockApi([
      finder({
        last_run_at: '2026-10-26T20:00:00Z',
        last_status: 'skipped',
        last_error: 'A typical run costs about US$24.80, which is more than the run limit.',
      }),
    ])
    renderTab()

    const lead = await card('Find new leads')
    expect(
      lead.getByText(/Skipped 27 Oct 2026, 7:00 am\. A typical run costs about US\$24\.80/),
    ).toBeVisible()
  })

  it('says when a run would not start now', async () => {
    const base = finder()
    mockApi([
      finder({
        estimate: {
          ...base.estimate!,
          problem:
            'A typical run costs about US$24.80, which is more than the run limit of US$20.00.',
        },
      }),
    ])
    renderTab()

    const lead = await card('Find new leads')
    expect(lead.getByText('It would not start now.')).toBeVisible()
    expect(lead.getByText(/more than the run limit of US\$20\.00/)).toBeVisible()
  })

  it('says so when the saved choices cannot be used', async () => {
    const base = finder()
    mockApi([
      finder({
        estimate: {
          ...base.estimate!,
          valid: false,
          problem: "The saved choices can't be used. cities, triggers: 16 searches is too many.",
        },
      }),
    ])
    renderTab()

    const lead = await card('Find new leads')
    expect(lead.getByText(/Not known: the saved choices can't be used\./)).toBeVisible()
    expect(lead.getByText(/16 searches is too many/)).toBeVisible()
  })

  it('shows a job the engine no longer has, and lets nobody change it', async () => {
    mockApi([finder({ installed: false, estimate: null, summary: '' })])
    renderTab()

    const lead = await card('Find new leads')
    expect(lead.getByText(/no longer has this job/)).toBeVisible()
    expect(lead.getByRole('switch')).toBeDisabled()
    expect(lead.getByRole('button', { name: 'Run now' })).toBeDisabled()
    expect(lead.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(lead.getByText('Not estimated.')).toBeVisible()
  })

  it('shows the error when the schedules cannot be loaded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(Response.json({ title: 'Database is down', status: 503 }, { status: 503 })),
      ),
    )
    renderTab()

    expect(await screen.findByText('Database is down')).toBeInTheDocument()
    expect(screen.getByText("The schedules couldn't be loaded.")).toBeInTheDocument()
  })
})

describe('switching a schedule on and off', () => {
  it('asks first when it costs money, saying what a month comes to', async () => {
    const calls = mockApi([finder()], {
      patch: () => Response.json(finder({ enabled: true, next_run_at: '2026-11-08T20:00:00Z' })),
    })
    const { user } = renderTab()
    const lead = await card('Find new leads')

    await user.click(lead.getByRole('switch', { name: 'Find new leads on or off' }))

    const dialog = await screen.findByRole('alertdialog', { name: 'Switch on Find new leads?' })
    expect(within(dialog).getByText(/Each run costs money/)).toHaveTextContent('US$7.80')
    expect(within(dialog).getByText(/never more than/)).toHaveTextContent('US$20.00')
    expect(
      within(dialog).getByText(/Every 2 weeks on Monday at 7:00 am, that is about/),
    ).toHaveTextContent('US$16.96 a month')
    expect(sent(calls, 'PATCH')).toHaveLength(0)

    await user.click(within(dialog).getByRole('button', { name: 'Switch on' }))
    await waitFor(() => {
      expect(sent(calls, 'PATCH')).toHaveLength(1)
    })
    expect(sent(calls, 'PATCH')[0]).toMatchObject({
      path: `/api/v1/schedules/${FINDER_ID}`,
      body: { enabled: true },
    })
  })

  it('changes nothing when the person cancels', async () => {
    const calls = mockApi([finder()])
    const { user } = renderTab()
    const lead = await card('Find new leads')

    await user.click(lead.getByRole('switch', { name: 'Find new leads on or off' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
    expect(sent(calls, 'PATCH')).toHaveLength(0)
  })

  it('switches a free job off at once, and a costly one off without asking', async () => {
    const calls = mockApi(
      [hubspot(), finder({ enabled: true, next_run_at: '2026-11-08T20:00:00Z' })],
      {
        patch: () => Response.json(hubspot({ enabled: false, next_run_at: null })),
      },
    )
    const { user } = renderTab()

    const sync = await card('Copy HubSpot')
    await user.click(sync.getByRole('switch', { name: 'Copy HubSpot on or off' }))
    await waitFor(() => {
      expect(sent(calls, 'PATCH')).toHaveLength(1)
    })
    expect(sent(calls, 'PATCH')[0]?.body).toEqual({ enabled: false })
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()

    const lead = await card('Find new leads')
    await user.click(lead.getByRole('switch', { name: 'Find new leads on or off' }))
    await waitFor(() => {
      expect(sent(calls, 'PATCH')).toHaveLength(2)
    })
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('shows the Admin only answer when the person may not change it', async () => {
    mockApi([hubspot()], {
      patch: () =>
        Response.json(
          { title: 'Admins only', detail: 'Only an Admin can do this.', status: 403 },
          { status: 403 },
        ),
    })
    const { user } = renderTab()

    const sync = await card('Copy HubSpot')
    await user.click(sync.getByRole('switch', { name: 'Copy HubSpot on or off' }))

    expect(await screen.findByText('Admins only')).toBeInTheDocument()
    expect(screen.getByText('Only an Admin can do this.')).toBeInTheDocument()
  })
})

describe('Run now', () => {
  it('asks first when it costs money, then opens the run it started', async () => {
    const calls = mockApi([finder()], {
      run: () => Response.json({ status: 'started', ref: RUN_ID, reason: null }),
    })
    const { user } = renderTab()
    const lead = await card('Find new leads')

    await user.click(lead.getByRole('button', { name: 'Run now' }))

    const dialog = await screen.findByRole('alertdialog', { name: 'Run Find new leads now?' })
    expect(within(dialog).getByText(/does not change when the schedule runs next/)).toBeVisible()
    expect(sent(calls, 'POST')).toHaveLength(0)
    await user.click(within(dialog).getByRole('button', { name: 'Run it' }))

    expect(await screen.findByText('Opened the run')).toBeInTheDocument()
    expect(sent(calls, 'POST')[0]?.path).toBe(`/api/v1/schedules/${FINDER_ID}/run`)
  })

  it('starts a free job at once and says it runs in the background', async () => {
    const calls = mockApi([hubspot()], {
      run: () => Response.json({ status: 'started', ref: 'sync:8', reason: null }),
    })
    const { user } = renderTab()
    const sync = await card('Copy HubSpot')

    await user.click(sync.getByRole('button', { name: 'Run now' }))

    expect(await screen.findByText('Started. It runs in the background.')).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(sent(calls, 'POST')).toHaveLength(1)
  })

  it('says why when the job did not start', async () => {
    mockApi([hubspot()], {
      run: () =>
        Response.json({
          status: 'skipped',
          ref: null,
          reason: 'A HubSpot sync is already running.',
        }),
    })
    const { user } = renderTab()
    const sync = await card('Copy HubSpot')

    await user.click(sync.getByRole('button', { name: 'Run now' }))

    expect(await screen.findByText('It did not start')).toBeInTheDocument()
    expect(screen.getByText('A HubSpot sync is already running.')).toBeInTheDocument()
  })

  it('says so when the job could not start', async () => {
    mockApi([hubspot()], {
      run: () =>
        Response.json({
          status: 'failed',
          ref: null,
          reason: 'It could not start. The details are in the backend log.',
        }),
    })
    const { user } = renderTab()
    const sync = await card('Copy HubSpot')

    await user.click(sync.getByRole('button', { name: 'Run now' }))

    expect(await screen.findByText('It could not start')).toBeInTheDocument()
  })

  it('cannot be pressed while the job is still going', async () => {
    mockApi([finder({ running: true })])
    renderTab()

    const lead = await card('Find new leads')
    expect(lead.getByText('Running now')).toBeVisible()
    expect(lead.getByRole('button', { name: 'Running.' })).toBeDisabled()
  })
})

describe('changing when it runs', () => {
  it('sends only what changed', async () => {
    const calls = mockApi([finder()], {
      patch: () => Response.json(finder({ every: 3, when: 'Every 3 weeks on Monday at 7:00 am' })),
    })
    const { user } = renderTab()
    const lead = await card('Find new leads')
    const save = lead.getByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()

    const every = lead.getByRole('textbox', { name: 'How many' })
    await user.clear(every)
    await user.type(every, '3')
    expect(save).toBeEnabled()
    await user.click(save)

    await waitFor(() => {
      expect(sent(calls, 'PATCH')).toHaveLength(1)
    })
    expect(sent(calls, 'PATCH')[0]?.body).toEqual({ every: 3 })
  })

  it('sends the day with weeks, and no day with days', async () => {
    const calls = mockApi([finder()], { patch: () => Response.json(finder()) })
    const { user } = renderTab()
    const lead = await card('Find new leads')

    await user.click(lead.getByRole('combobox', { name: 'Day of the week' }))
    await user.click(await screen.findByRole('option', { name: 'Friday' }))
    await user.click(lead.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(sent(calls, 'PATCH')).toHaveLength(1)
    })
    expect(sent(calls, 'PATCH')[0]?.body).toEqual({ weekday: 4 })

    await user.click(lead.getByRole('combobox', { name: 'Days or weeks' }))
    await user.click(await screen.findByRole('option', { name: 'days' }))
    expect(lead.queryByRole('combobox', { name: 'Day of the week' })).not.toBeInTheDocument()
    await user.click(lead.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(sent(calls, 'PATCH')).toHaveLength(2)
    })
    expect(sent(calls, 'PATCH')[1]?.body).toEqual({ unit: 'days' })
  })

  it('sends a new time as 24-hour text', async () => {
    const calls = mockApi([finder()], { patch: () => Response.json(finder({ at: '09:30' })) })
    const { user } = renderTab()
    const lead = await card('Find new leads')

    const time = lead.getByLabelText('Time of day')
    await user.clear(time)
    await user.type(time, '09:30')
    await user.click(lead.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(sent(calls, 'PATCH')).toHaveLength(1)
    })
    expect(sent(calls, 'PATCH')[0]?.body).toEqual({ at: '09:30' })
  })

  it('does not send a number that is not a number', async () => {
    const calls = mockApi([finder()])
    const { user } = renderTab()
    const lead = await card('Find new leads')

    const every = lead.getByRole('textbox', { name: 'How many' })
    await user.clear(every)
    await user.type(every, 'abc')
    await user.click(lead.getByRole('button', { name: 'Save' }))

    expect(await lead.findByText('Use a whole number from 1 to 52.')).toBeVisible()
    expect(sent(calls, 'PATCH')).toHaveLength(0)
  })

  it('shows what the backend says is wrong next to the field', async () => {
    mockApi([finder()], {
      patch: () =>
        Response.json(
          {
            title: "The change isn't valid",
            detail: 'Use 52 weeks or fewer.',
            status: 422,
            errors: [{ field: 'body.every', message: 'Use 52 weeks or fewer.' }],
          },
          { status: 422 },
        ),
    })
    const { user } = renderTab()
    const lead = await card('Find new leads')

    const every = lead.getByRole('textbox', { name: 'How many' })
    await user.clear(every)
    await user.type(every, '52')
    await user.click(lead.getByRole('button', { name: 'Save' }))

    expect(await lead.findByText('Use 52 weeks or fewer.')).toBeVisible()
    expect(every).toHaveAttribute('aria-invalid', 'true')
  })
})

describe('a run that is above the limit', () => {
  it('says a run stops at the limit, with no month of runs that could not happen', async () => {
    mockApi([overTheLimit()])
    renderTab()

    const lead = await card('Find new leads')
    const cost = lead.getByText('One run costs').nextElementSibling
    expect(cost).toHaveTextContent(
      'A typical run costs about US$24.80, but a run stops at US$20.00.',
    )
    expect(cost).not.toHaveTextContent('a month')
    // The prices are in the box about why it would not start, so they are not said twice.
    expect(lead.getAllByText(/US\$1\.00 a company, a default/)).toHaveLength(1)
  })

  it('says so before switching on, and offers to switch on anyway', async () => {
    const calls = mockApi([overTheLimit()], {
      patch: () => Response.json(overTheLimit()),
    })
    const { user } = renderTab()
    const lead = await card('Find new leads')

    await user.click(lead.getByRole('switch', { name: 'Find new leads on or off' }))

    const dialog = await screen.findByRole('alertdialog', { name: 'Switch on Find new leads?' })
    expect(
      within(dialog).getByText(/It would not start right now: A typical run costs/),
    ).toBeVisible()
    await user.click(within(dialog).getByRole('button', { name: 'Switch on anyway' }))
    await waitFor(() => {
      expect(sent(calls, 'PATCH')).toHaveLength(1)
    })
  })

  it('goes straight to the answer on Run now, since nothing would be spent', async () => {
    const calls = mockApi([overTheLimit()], {
      run: () =>
        Response.json({
          status: 'skipped',
          ref: null,
          reason: 'The answer to Run now when it is above the limit.',
        }),
    })
    const { user } = renderTab()
    const lead = await card('Find new leads')

    await user.click(lead.getByRole('button', { name: 'Run now' }))

    expect(
      await screen.findByText('The answer to Run now when it is above the limit.'),
    ).toBeVisible()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(sent(calls, 'POST')).toHaveLength(1)
  })
})
