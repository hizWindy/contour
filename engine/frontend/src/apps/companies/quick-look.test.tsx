import { act, fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CompanyDetail, CompanyPerson, CompanyRow, PrepFacts } from '@/api/types'
import { renderWithProviders } from '@/test/render'
import { calleeFrom, defaultCallee } from './callee'
import { CompanyCell, PREP_REST_MS } from './company-cell'
import { CallingRow, QuickLook } from './quick-look'

/*
  Call prep's quick look (PLAN-V18 T3-7): who it calls first in each case, the facts at once, a
  change of person, the facts fetched while the pointer rests on Prep, and a failed facts read.
  Made-up names only: Sample Logistics Pty Ltd, Jo Sample.
*/

const JO: CompanyPerson = {
  id: '201',
  name: 'Jo Sample',
  title: 'Office Manager',
  phone: null,
  last_activity: '2026-09-01T00:00:00Z',
}
const SAM: CompanyPerson = {
  id: '202',
  name: 'Sam Sample',
  title: null,
  phone: null,
  last_activity: '2026-10-20T00:00:00Z',
}
const ALEX: CompanyPerson = {
  id: '203',
  name: 'Alex Sample',
  title: null,
  phone: null,
  last_activity: null,
}

function facts(changes: Partial<PrepFacts> = {}): PrepFacts {
  return {
    company_key: '101',
    company_name: 'Sample Logistics Pty Ltd',
    city: 'Perth',
    industry: 'Logistics',
    staff: 300,
    owner: 'Mia',
    deal: 'open',
    next_lease_end: '2027-06-30',
    last_talk: '2026-10-01',
    hubspot_url: null,
    person: null,
    phone: '(08) 9000 0000',
    last_call: null,
    facts: [],
    people: [JO, SAM],
    people_status: 'ready',
    prep_enabled: true,
    names_ok: true,
    prep_cap_usd: '0.25',
    ...changes,
  }
}

describe('who call prep calls first', () => {
  it('calls the last person we talked to: the last call’s person', () => {
    expect(defaultCallee([JO, SAM], 'Jo Sample')).toBe(JO)
  })

  it('else the person with the newest HubSpot activity', () => {
    expect(defaultCallee([JO, SAM], null)).toBe(SAM)
    // A last call with someone no longer on record falls back the same way.
    expect(defaultCallee([JO, SAM], 'Someone Gone')).toBe(SAM)
  })

  it('else the first person on record, else the switchboard', () => {
    expect(defaultCallee([ALEX, { ...ALEX, id: '204', name: 'Bo Sample' }], null)).toBe(ALEX)
    expect(defaultCallee([], null)).toBeNull()
  })

  it('waits for the facts or the record, and calls the switchboard when neither can be read', () => {
    expect(calleeFrom(undefined, undefined, false)).toBeUndefined()
    expect(calleeFrom(undefined, undefined, true)).toBeNull()
    expect(
      calleeFrom(
        facts({
          last_call: {
            id: '1',
            called_at: '2026-10-01T01:00:00Z',
            person: 'Jo Sample',
            owner: 'Mia',
            minutes: 5,
            outcome: 'Connected',
            note: null,
            hubspot_url: null,
          },
        }),
        undefined,
        false,
      ),
    ).toBe(JO)
    // The record alone does too, from its newest call.
    const record = {
      people: [JO, SAM],
      calls: [{ person: 'Jo Sample' }],
    } as unknown as CompanyDetail
    expect(calleeFrom(undefined, record, false)).toBe(JO)
  })
})

describe('the quick look', () => {
  it('shows the facts at once, each with its label above it', () => {
    renderWithProviders(
      <QuickLook facts={facts()} company={undefined} failed={false} today="2026-11-16" />,
    )
    const look = screen.getByRole('region', { name: 'Quick look' })
    expect(
      within(look)
        .getAllByRole('term')
        .map((term) => term.textContent),
    ).toEqual(['Owner', 'Deal', 'Staff', 'Next lease end', 'Next meeting'])
    expect(look).toHaveTextContent('Mia')
    expect(look).toHaveTextContent('300 staff')
    expect(look).toHaveTextContent('None booked')
  })

  it('says the facts couldn’t be read, in plain words, when every read failed', () => {
    renderWithProviders(
      <QuickLook facts={undefined} company={undefined} failed today="2026-11-16" />,
    )
    expect(
      screen.getByText("The facts couldn't be read from our HubSpot copy. Try again in a moment."),
    ).toBeInTheDocument()
  })
})

describe('Calling', () => {
  it('names the person, and a short list changes it: the people, then the cold call', async () => {
    const onPick = vi.fn()
    const { user } = renderWithProviders(
      <CallingRow people={[JO, SAM]} waiting={false} person={JO} onPick={onPick} />,
    )
    const row = screen.getByRole('button', { name: /^Calling/ })
    expect(row).toHaveTextContent('Jo Sample, Office Manager')
    await user.click(row)
    expect(screen.getAllByRole('menuitemradio').map((item) => item.textContent)).toEqual([
      'Jo SampleOffice Manager',
      'Sam Sample',
      'Cold call (switchboard)',
    ])
    await user.click(screen.getByRole('menuitemradio', { name: 'Sam Sample' }))
    expect(onPick).toHaveBeenCalledWith(SAM)
  })

  it('says why there is no one to pick', () => {
    const { rerender } = renderWithProviders(
      <CallingRow people={[]} waiting={false} person={null} onPick={vi.fn()} />,
    )
    expect(screen.getByRole('button', { name: /^Calling/ })).toHaveTextContent(
      'Cold call (switchboard)',
    )
    expect(
      screen.getByText(
        'No people on record in HubSpot for this company. The script asks the switchboard for whoever looks after the office.',
      ),
    ).toBeInTheDocument()
    rerender(<CallingRow people={[]} waiting person={null} onPick={vi.fn()} />)
    expect(
      screen.getByText('Waiting for HubSpot access to contacts and calls.'),
    ).toBeInTheDocument()
  })
})

describe('the facts, fetched ahead on Prep', () => {
  const ROW = {
    key: '101',
    name: 'Sample Logistics Pty Ltd',
    source: 'hubspot',
    city: 'Perth',
    domain: 'samplelogistics.com.au',
  } as unknown as CompanyRow

  function factsRequests(fetchSpy: ReturnType<typeof vi.fn>): string[] {
    return fetchSpy.mock.calls
      .map(([request]) => new URL((request as Request).url).pathname)
      .filter((path) => path.endsWith('/facts'))
  }

  it('asks once the pointer has rested on Prep for 150ms, and not for a pointer passing by', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const fetchSpy = vi.fn(() => Promise.resolve(Response.json(facts())))
    vi.stubGlobal('fetch', fetchSpy)
    renderWithProviders(<CompanyCell row={ROW} onPrep={vi.fn()} />)
    const prep = screen.getByRole('button', { name: 'Prep a call to Sample Logistics Pty Ltd' })
    fireEvent.pointerEnter(prep)
    fireEvent.pointerLeave(prep)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PREP_REST_MS + 50)
    })
    expect(factsRequests(fetchSpy)).toEqual([])
    fireEvent.pointerEnter(prep)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PREP_REST_MS + 10)
    })
    expect(factsRequests(fetchSpy)).toEqual(['/api/v1/companies/101/facts'])
  })

  it('asks as soon as Prep gets the keyboard’s focus', () => {
    const fetchSpy = vi.fn(() => Promise.resolve(Response.json(facts())))
    vi.stubGlobal('fetch', fetchSpy)
    renderWithProviders(<CompanyCell row={ROW} onPrep={vi.fn()} />)
    act(() => {
      screen.getByRole('button', { name: 'Prep a call to Sample Logistics Pty Ltd' }).focus()
    })
    expect(factsRequests(fetchSpy)).toEqual(['/api/v1/companies/101/facts'])
  })
})
