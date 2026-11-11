/**
 * Admin, Schedules (PLAN-V13 T1-7): the city schedules as one control, the last round and "Run a
 * city now", and the other jobs in compact rows. The clock is Monday 16 Nov 2026, 10:00 am in
 * Melbourne.
 */
import { screen, waitFor, within } from '@testing-library/react'
import { Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LeadFinderRound, RoundCity, Schedule } from '@/api/types'
import { renderWithProviders } from '@/test/render'
import SchedulesTab from './schedules'

const NOW = new Date('2026-11-15T23:00:00Z') // Mon 16 Nov, 10:00 am in Melbourne
const CITIES = ['Melbourne', 'Adelaide', 'Perth', 'Sydney'] as const
const RUN_ID = '0f3c9a2e-1111-2222-3333-444444444444'
const SYNC_ID = '5d1b7c44-0000-4000-8000-000000000002'
const cityId = (index: number) => `5d1b7c44-0000-4000-8000-00000000001${String(index)}`

function citySchedule(index: number, changes: Partial<Schedule> = {}): Schedule {
  const city = CITIES[index] ?? 'Melbourne'
  return {
    id: cityId(index),
    project: 'lead_finder',
    job: `lead_finder.discovery.${city.toLowerCase()}`,
    name: `Find new leads: ${city}`,
    enabled: false,
    every: 2,
    unit: 'weeks',
    weekday: index,
    at: '07:00',
    timezone: 'Australia/Melbourne',
    when: 'Every 2 weeks on Monday at 7:00 am',
    settings: {},
    summary: '',
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
      typical_usd: '28.40',
      worst_usd: '150.00',
      per_month_usd: '61.75',
      cap_usd: '150.00',
      daily_left_usd: '150.00',
      basis: 'US$0.30 a company',
    },
    ...changes,
  }
}

function hubspot(changes: Partial<Schedule> = {}): Schedule {
  return {
    ...citySchedule(0),
    id: SYNC_ID,
    project: 'core',
    job: 'core.hubspot_sync',
    name: 'Copy HubSpot',
    enabled: true,
    every: 1,
    unit: 'days',
    weekday: null,
    at: '06:00',
    when: 'Every day at 6:00 am',
    last_run_at: '2026-11-15T19:00:00Z',
    last_status: 'started',
    last_kind: 'sync',
    last_id: '7',
    estimate: {
      valid: true,
      problem: null,
      typical_usd: '0.00',
      worst_usd: '0.00',
      per_month_usd: '0.00',
      cap_usd: '0.00',
      daily_left_usd: '0.00',
      basis: 'Copying HubSpot is free.',
    },
    ...changes,
  }
}

function cityPlan(changes: Partial<RoundCity>[] = []): RoundCity[] {
  return CITIES.map((city, index) => ({
    city,
    picked: true,
    schedule_id: cityId(index),
    enabled: false,
    day: ['Monday', 'Tuesday', 'Wednesday', 'Thursday'][index] ?? null,
    next_run_at: null,
    last_run_at: null,
    last_status: null,
    last_error: null,
    last_run: null,
    ...changes[index],
  }))
}

function round(changes: Partial<LeadFinderRound> = {}): LeadFinderRound {
  return {
    enabled: false,
    cities: [...CITIES],
    every: 2,
    unit: 'weeks',
    weekday: 0,
    at: '07:00',
    timezone: 'Australia/Melbourne',
    when: 'Every 2 weeks from Monday at 7:00 am',
    summary:
      'When it is on, the next round would be: Mon 23 Nov, 7:00 am. Melbourne Mon, Adelaide Tue, Perth Wed, Sydney Thu. Up to US$150.',
    budget_usd: '150.00',
    budget_max_usd: '200.00',
    run_cap_usd: '150.00',
    note: null,
    round: {
      started_at: null,
      next_round_at: null,
      runs: 0,
      good_leads: 0,
      goal: 100,
      spent_usd: '0.00',
      left_usd: '150.00',
    },
    city_plan: cityPlan(),
    ...changes,
  }
}

interface Call {
  method: string
  path: string
  body: unknown
}

function mockApi(
  start: LeadFinderRound,
  answers: {
    put?: (body: Record<string, unknown>) => Response
    run?: (call: Call) => Response
    patch?: (call: Call) => Response
  } = {},
): Call[] {
  const calls: Call[] = []
  let current = start // what the backend holds: a save changes it
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const url = new URL(request.url)
      const text = request.method === 'GET' ? '' : await request.text()
      const body = text ? (JSON.parse(text) as Record<string, unknown>) : null
      const call: Call = { method: request.method, path: url.pathname, body }
      calls.push(call)
      if (call.method === 'GET' && call.path === '/api/v1/schedules') {
        return Response.json({ items: [...CITIES.map((_, i) => citySchedule(i)), hubspot()] })
      }
      if (call.path === '/api/v1/schedules/lead-finder') {
        if (call.method === 'GET') return Response.json(current)
        if (call.method === 'PUT' && body) {
          if (answers.put) return answers.put(body)
          current = round({
            ...(body as Partial<LeadFinderRound>),
            budget_usd: String(body.budget_usd),
          })
          return Response.json(current)
        }
      }
      if (call.method === 'POST' && call.path.endsWith('/run') && answers.run) {
        return answers.run(call)
      }
      if (call.method === 'PATCH' && answers.patch) return answers.patch(call)
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

const sent = (calls: Call[], method: string) => calls.filter((call) => call.method === method)
const preview = () => document.querySelector('[data-slot=round-preview]')?.textContent ?? ''

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => {
  vi.useRealTimers()
})

describe('the round control', () => {
  it('shows the plan, with the preview line and no Save until something changes', async () => {
    mockApi(round())
    renderTab()
    expect(await screen.findByText('Find new leads automatically')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Find new leads automatically' })).not.toBeChecked()
    const cities = screen.getByRole('group', { name: 'Cities' })
    for (const city of CITIES) {
      expect(within(cities).getByRole('button', { name: city })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
    }
    expect(screen.getByRole('radio', { name: 'Every 2 weeks' })).toBeChecked()
    expect(preview()).toBe(round().summary)
    expect(
      screen.getByText(/US\$150 a round, so about US\$37 a city if all 4 run\./),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
  })

  it('updates the preview as you change things, for weeks and for days', async () => {
    mockApi(round())
    const { user } = renderTab()
    await screen.findByText('Find new leads automatically')
    const cities = screen.getByRole('group', { name: 'Cities' })
    await user.click(within(cities).getByRole('button', { name: 'Melbourne' }))
    await user.click(within(cities).getByRole('button', { name: 'Adelaide' }))
    await user.click(screen.getByRole('radio', { name: /^Wed/ }))
    expect(preview()).toBe(
      'When it is on, the next round would be: Wed 18 Nov, 7:00 am. Perth Wed, Sydney Thu. Up to US$150.',
    )
    expect(
      screen.getByText(/US\$150 a round, so about US\$75 a city if all 2 run\./),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'Every 30 days' }))
    await user.click(screen.getByRole('radio', { name: /^Sat/ }))
    expect(preview()).toBe(
      'When it is on, the next round would be: Sat 21 Nov, 7:00 am. Perth Sat, Sydney Sun. Up to US$150.',
    )
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  it('saves the whole plan in one request and reads it back the same', async () => {
    const calls = mockApi(round())
    const { user } = renderTab()
    await screen.findByText('Find new leads automatically')
    await user.click(
      within(screen.getByRole('group', { name: 'Cities' })).getByRole('button', { name: 'Sydney' }),
    )
    await user.click(screen.getByRole('radio', { name: 'Custom' }))
    const every = screen.getByLabelText('Every')
    await user.clear(every)
    await user.type(every, '3')
    const budget = screen.getByLabelText('Round budget (US$)')
    await user.clear(budget)
    await user.type(budget, '120')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(sent(calls, 'PUT')).toHaveLength(1)
    })
    expect(sent(calls, 'PUT')[0]?.body).toEqual({
      enabled: false,
      cities: ['Melbourne', 'Adelaide', 'Perth'],
      every: 3,
      unit: 'weeks',
      weekday: 0,
      at: '07:00',
      budget_usd: '120.00',
    })
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    })
  })

  it('asks first when switching the round on, saying what a month could cost', async () => {
    const calls = mockApi(round())
    const { user } = renderTab()
    await screen.findByText('Find new leads automatically')
    await user.click(screen.getByRole('switch', { name: 'Find new leads automatically' }))
    expect(preview()).toBe(
      'Next round: Mon 23 Nov, 7:00 am. Melbourne Mon, Adelaide Tue, Perth Wed, Sydney Thu. Up to US$150.',
    )
    await user.click(screen.getByRole('button', { name: 'Save' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('Each round may spend up to US$150 between its cities')
    expect(dialog).toHaveTextContent('at most about US$327 a month')
    expect(sent(calls, 'PUT')).toHaveLength(0)
    await user.click(within(dialog).getByRole('button', { name: 'Switch on' }))
    await waitFor(() => {
      expect(sent(calls, 'PUT')[0]?.body).toMatchObject({ enabled: true })
    })
  })

  it('stops a plan that cannot be kept before it is sent', async () => {
    const calls = mockApi(round())
    const { user } = renderTab()
    await screen.findByText('Find new leads automatically')
    await user.click(screen.getByRole('radio', { name: 'Custom' }))
    await user.click(screen.getByRole('radio', { name: 'Days' }))
    const every = screen.getByLabelText('Every')
    await user.clear(every)
    await user.type(every, '3')
    expect(
      screen.getByText(
        '4 cities run on 4 days in a row, so a round can repeat every 4 days at most often.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    const budget = screen.getByLabelText('Round budget (US$)')
    await user.clear(budget)
    await user.type(budget, '500')
    expect(
      screen.getByText('Must be at most US$200. The ceiling on the server is lower.'),
    ).toBeInTheDocument()
    expect(sent(calls, 'PUT')).toHaveLength(0)
  })

  it('shows what the backend refuses next to the field', async () => {
    mockApi(round(), {
      put: () =>
        Response.json(
          {
            title: "The change isn't valid",
            status: 422,
            errors: [{ field: 'body.budget_usd', message: 'Budget refused by the backend.' }],
          },
          { status: 422 },
        ),
    })
    const { user } = renderTab()
    await screen.findByText('Find new leads automatically')
    const budget = screen.getByLabelText('Round budget (US$)')
    await user.clear(budget)
    await user.type(budget, '99')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Budget refused by the backend.')).toBeInTheDocument()
  })

  it('says when the round budget is spent', async () => {
    mockApi(
      round({ enabled: true, note: "This round's budget (US$150) is spent. Next round: 30 Nov." }),
    )
    renderTab()
    expect(
      await screen.findByText("This round's budget (US$150) is spent. Next round: 30 Nov."),
    ).toBeInTheDocument()
  })
})

describe('the last round and Run a city now', () => {
  it('lists each city with its date, good leads and cost', async () => {
    mockApi(
      round({
        round: {
          ...round().round,
          runs: 1,
          good_leads: 18,
          spent_usd: '40.00',
          left_usd: '110.00',
        },
        city_plan: cityPlan([
          {
            last_run: {
              id: RUN_ID,
              created_at: '2026-11-15T20:00:00Z',
              status: 'done',
              good_leads: 18,
              cost_usd: '40.00',
            },
          },
        ]),
      }),
    )
    renderTab()
    const table = await screen.findByRole('table', { name: "Each city's last run" })
    const melbourne = within(table).getByRole('row', { name: /Melbourne/ })
    expect(melbourne).toHaveTextContent('18')
    expect(melbourne).toHaveTextContent('US$40.00')
    expect(screen.getByText(/18 of 100 good leads, 1 city run\./)).toBeInTheDocument()
  })

  it('asks first with the city cost, then opens the run', async () => {
    const calls = mockApi(round(), {
      run: () => Response.json({ status: 'started', ref: RUN_ID, reason: null }),
    })
    const { user } = renderTab()
    await user.click(await screen.findByRole('button', { name: 'Run a city now' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Perth' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('Run Perth now?')
    expect(dialog).toHaveTextContent('about US$28.40')
    expect(sent(calls, 'POST')).toHaveLength(0)
    await user.click(within(dialog).getByRole('button', { name: 'Run it' }))
    expect(await screen.findByText('Opened the run')).toBeInTheDocument()
    expect(sent(calls, 'POST')[0]?.path).toBe(`/api/v1/schedules/${cityId(2)}/run`)
  })
})

describe('the other jobs', () => {
  it('shows the HubSpot copy in one row, switched off at once because it is free', async () => {
    const calls = mockApi(round(), {
      patch: () => Response.json(hubspot({ enabled: false })),
    })
    const { user } = renderTab()
    const jobs = await screen.findByRole('list', { name: 'Other jobs' })
    const row = within(jobs).getByText('Copy HubSpot').closest('li')
    if (!(row instanceof HTMLElement)) throw new Error('no row')
    expect(within(row).getByText('Free')).toBeInTheDocument()
    expect(row).toHaveTextContent('Every day at 6:00 am, Melbourne time.')
    await user.click(within(row).getByRole('switch', { name: 'Copy HubSpot' }))
    await waitFor(() => {
      expect(sent(calls, 'PATCH')[0]?.body).toEqual({ enabled: false })
    })
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('changes the time with a Save that shows only after a change', async () => {
    const calls = mockApi(round(), { patch: () => Response.json(hubspot({ at: '05:30' })) })
    const { user } = renderTab()
    const jobs = await screen.findByRole('list', { name: 'Other jobs' })
    expect(within(jobs).queryByRole('button', { name: 'Save' })).toBeNull()
    const time = within(jobs).getByLabelText('Time')
    await user.clear(time)
    await user.type(time, '05:30')
    await user.click(within(jobs).getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(sent(calls, 'PATCH')[0]?.body).toEqual({ at: '05:30' })
    })
  })

  it('does not list the city schedules again', async () => {
    mockApi(round())
    renderTab()
    const jobs = await screen.findByRole('list', { name: 'Other jobs' })
    expect(within(jobs).queryByText(/Find new leads:/)).toBeNull()
  })
})
