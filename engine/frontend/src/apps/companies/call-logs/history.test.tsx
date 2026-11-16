import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CallNoteOptions, CallNoteOut } from '@/api/types'
import { formatDate, melbourneDate } from '@/lib/format'
import { routes } from '@/router'
import { prefetchPage } from '@/shell/prefetch'
import { createTestQueryClient, renderWithProviders } from '@/test/render'
import CallLogsPage from './index'

/*
  History (PLAN-V18 T3-6), against a fake server that filters as the contract says (part 3): the
  day groups, a row opened in place, each filter, the search, "Show older", the empty and error
  states, and the keys. The clock is Monday 16 Nov 2026, 1:00 pm in Melbourne. Made-up names
  only: Sample Logistics Pty Ltd, Jo Sample.
*/

const NOTES = '/api/v1/companies/call-notes'
const NOW = new Date('2026-11-16T02:00:00Z')
const HUBSPOT_URL = 'https://app.hubspot.com/contacts/1/record/0-48/9'

function options(): CallNoteOptions {
  return {
    enabled: true,
    ai_enabled: true,
    sending_ready: true,
    waiting_for: null,
    outcomes: ['Connected', 'No answer', 'Left voicemail', 'Busy'],
    fields: [{ id: 'lease_end', label: 'Lease end', kind: 'date' }],
    soft_seconds: 180,
    max_chars: 6000,
  }
}

function note(id: string, changes: Partial<CallNoteOut> = {}): CallNoteOut {
  return {
    id,
    company_key: '101',
    company_name: 'Sample Logistics Pty Ltd',
    person: { id: '201', name: 'Jo Sample', title: 'Office Manager' },
    text: 'Spoke to Jo. The Perth lease ends in June 2028.\nShe wants a floor plan.',
    source: 'typed',
    called_at: '2026-11-16T01:30:00Z',
    status: 'logged',
    sorted_by: 'ai',
    unsure: null,
    call: {
      summary: 'Jo says the Perth lease now ends in June 2028.',
      outcome: 'Connected',
      in_hubspot: true,
    },
    changes: [],
    tasks: [],
    left_out: false,
    steps: [],
    hubspot_url: HUBSPOT_URL,
    made_by: 'Mia',
    created_at: '2026-11-16T01:30:00Z',
    confirmed_at: '2026-11-16T01:40:00Z',
    ...changes,
  }
}

/** Three days of calls: today, yesterday and last Monday. */
function threeDays(): CallNoteOut[] {
  return [
    note('n1', {
      changes: [
        {
          id: 'c1',
          field: 'lease_end',
          label: 'Lease end',
          office: 'Perth',
          current: '2026-06-30',
          value: '2028-06-30',
          current_changed: false,
          in_hubspot: true,
        },
      ],
      tasks: [
        {
          id: 't1',
          subject: 'Send Jo a floor plan',
          due: '2026-11-20',
          due_words: 'Friday',
          kind: 'email',
          owner: null,
          in_hubspot: true,
        },
      ],
      steps: [{ step: 'call', status: 'done', words: 'Logged the call.' }],
    }),
    note('n2', {
      company_key: '103',
      company_name: 'Sample Mining Pty Ltd',
      person: null,
      called_at: '2026-11-15T05:00:00Z',
      status: 'to_confirm',
      source: 'mic',
      call: {
        summary: 'Left a message with reception.',
        outcome: 'Left voicemail',
        in_hubspot: false,
      },
      hubspot_url: null,
    }),
    note('n3', {
      company_key: '105',
      company_name: 'Sample Freight Pty Ltd',
      person: { id: '301', name: 'Sam Sample', title: null },
      called_at: '2026-11-09T00:00:00Z',
      status: 'failed',
      call: { summary: 'Sam wants to move in March.', outcome: null, in_hubspot: false },
    }),
  ]
}

const STATES: Record<string, readonly CallNoteOut['status'][]> = {
  history: ['sorting', 'to_confirm', 'sending', 'logged', 'partial', 'failed', 'uncertain'],
  to_confirm: ['sorting', 'to_confirm', 'sending'],
  logged: ['logged'],
  needs_look: ['partial', 'failed', 'uncertain'],
}

/** Each word must start a word of the company, the person, the note or the summary. */
function matches(item: CallNoteOut, q: string): boolean {
  const words = [item.company_name, item.person?.name ?? '', item.text, item.call.summary]
    .join(' ')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((part) => words.some((word) => word.startsWith(part)))
}

/** The fake server. Returns what each list request asked for. */
function server(notes: CallNoteOut[], { fail = false } = {}): URLSearchParams[] {
  const asked: URLSearchParams[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn((request: Request) => {
      const url = new URL(request.url)
      if (url.pathname === `${NOTES}/options`) return Promise.resolve(Response.json(options()))
      if (url.pathname === `${NOTES}/summary`) {
        return Promise.resolve(Response.json({ to_confirm: 0, needs_look: 0, logged_today: 0 }))
      }
      if (url.pathname === NOTES) {
        const search = url.searchParams
        asked.push(search)
        if (fail) {
          return Promise.resolve(
            Response.json(
              { title: 'Something went wrong', status: 500, detail: 'The server had a problem.' },
              { status: 500 },
            ),
          )
        }
        const state = search.get('state') ?? 'to_confirm'
        const q = search.get('q')
        const outcome = search.get('outcome')
        const since = search.get('since')
        const rows = notes.filter(
          (item) =>
            (STATES[state] ?? []).includes(item.status) &&
            (!q || matches(item, q)) &&
            (!outcome ||
              (outcome === 'none' ? !item.call.outcome : item.call.outcome === outcome)) &&
            (!since || melbourneDate(item.called_at) >= since),
        )
        const limit = Number(search.get('limit') ?? '50')
        const offset = Number(search.get('offset') ?? '0')
        return Promise.resolve(
          Response.json({ total: rows.length, items: rows.slice(offset, offset + limit) }),
        )
      }
      return Promise.resolve(Response.json({ title: 'Not found', status: 404 }, { status: 404 }))
    }),
  )
  return asked
}

function renderHistory(search = '') {
  vi.useFakeTimers({ shouldAdvanceTime: true, now: NOW })
  return renderWithProviders(<CallLogsPage />, {
    route: `/companies/call-logs?tab=history${search}`,
  })
}

async function historyList() {
  return screen.findByRole('group', { name: 'Your calls, newest first' })
}

function rows(list: HTMLElement): HTMLElement[] {
  return within(list)
    .getAllByRole('button', { expanded: false })
    .concat(within(list).queryAllByRole('button', { expanded: true }))
}

describe('History', () => {
  it('groups the calls by day, newest first, each day under a heading that stays in view', async () => {
    server(threeDays())
    renderHistory()
    const list = await historyList()
    const headings = within(list).getAllByRole('heading', { level: 3 })
    expect(headings.map((heading) => heading.textContent)).toEqual([
      'Today',
      'Yesterday',
      'Mon 9 Nov',
    ])
    expect(headings[0]).toHaveClass('sticky')

    const first = within(list).getByRole('button', { name: /Sample Logistics Pty Ltd/ })
    expect(first).toHaveTextContent('12:30 pm')
    expect(first).toHaveTextContent('Jo Sample, Office Manager')
    expect(first).toHaveTextContent('Jo says the Perth lease now ends in June 2028.')
    // How it went and where it stands: a mark and a word each, never colour alone.
    expect(first).toHaveTextContent('Connected')
    expect(first).toHaveTextContent('In HubSpot')
    expect(first).toHaveTextContent('1 follow-up, 1 field change, Typed')

    const second = within(list).getByRole('button', { name: /Sample Mining Pty Ltd/ })
    expect(second).toHaveTextContent('Left voicemail')
    expect(second).toHaveTextContent('To confirm')
    expect(second).toHaveTextContent('Logged by speaking')
    const third = within(list).getByRole('button', { name: /Sample Freight Pty Ltd/ })
    expect(third).toHaveTextContent('No outcome')
    expect(third).toHaveTextContent('Needs a look')
  })

  it('opens a call in place, one at a time, with all of it and what to do next', async () => {
    server(threeDays())
    const { user } = renderHistory()
    const list = await historyList()
    const first = within(list).getByRole('button', { name: /Sample Logistics Pty Ltd/ })
    await user.click(first)
    expect(first).toHaveAttribute('aria-expanded', 'true')
    const opened = document.getElementById(first.getAttribute('aria-controls') ?? '') as HTMLElement
    expect(within(opened).getByText(/She wants a floor plan\./)).toBeInTheDocument()
    expect(opened).toHaveTextContent(
      `Lease end · Perth: ${formatDate('2026-06-30')} to ${formatDate('2028-06-30')}`,
    )
    expect(opened).toHaveTextContent('Send Jo a floor plan')
    expect(opened).toHaveTextContent('The call: Logged the call.')
    expect(within(opened).getByRole('link', { name: /^Open in HubSpot/ })).toHaveAttribute(
      'href',
      HUBSPOT_URL,
    )

    // One at a time.
    const second = within(list).getByRole('button', { name: /Sample Mining Pty Ltd/ })
    await user.click(second)
    expect(second).toHaveAttribute('aria-expanded', 'true')
    expect(first).toHaveAttribute('aria-expanded', 'false')

    // Log another call with the company: Log call opens for it.
    await user.click(
      within(list).getByRole('button', { name: 'Log another call with Sample Mining Pty Ltd' }),
    )
    expect(await screen.findByRole('dialog', { name: 'Log call' })).toHaveTextContent(
      'Sample Mining Pty Ltd',
    )
  })

  it('filters by how it went, when, and where it stands, and keeps them in the address', async () => {
    const asked = server(threeDays())
    const { user } = renderHistory()
    await historyList()
    expect(asked.at(-1)?.get('state')).toBe('history')
    expect(asked.at(-1)?.get('limit')).toBe('50')

    await user.click(screen.getByRole('button', { name: 'Connected' }))
    await waitFor(() => {
      expect(asked.at(-1)?.get('outcome')).toBe('Connected')
    })
    await user.click(screen.getByRole('radio', { name: 'This week' }))
    await waitFor(() => {
      expect(asked.at(-1)?.get('since')).toBe('2026-11-16')
    })
    await user.click(screen.getByRole('combobox', { name: 'Where it stands' }))
    await user.click(await screen.findByRole('option', { name: 'Needs a look' }))
    await waitFor(() => {
      expect(asked.at(-1)?.get('state')).toBe('needs_look')
    })
    expect(asked.at(-1)?.get('outcome')).toBe('Connected')
    expect(asked.at(-1)?.get('mine')).toBe('true')
  })

  it('searches the company, the person and the note 250ms after the last key', async () => {
    const asked = server(threeDays())
    const { user } = renderHistory()
    await historyList()
    await user.type(screen.getByRole('searchbox', { name: 'Search your calls' }), 'march')
    await waitFor(() => {
      expect(asked.at(-1)?.get('q')).toBe('march')
    })
    // Not a request for each key.
    expect(asked.filter((search) => search.has('q')).map((search) => search.get('q'))).toEqual([
      'march',
    ])
    const list = await historyList()
    await waitFor(() => {
      expect(within(list).getAllByRole('button', { name: /Sample/ })).toHaveLength(1)
    })
    expect(within(list).getByRole('button', { name: /Sample Freight Pty Ltd/ })).toBeInTheDocument()
  })

  it('brings 50 more with Show older', async () => {
    const many = Array.from({ length: 60 }, (_, index) =>
      note(`m${String(index)}`, {
        called_at: new Date(NOW.getTime() - (index + 1) * 3_600_000).toISOString(),
      }),
    )
    const asked = server(many)
    const { user } = renderHistory()
    const list = await historyList()
    expect(rows(list)).toHaveLength(50)
    await user.click(screen.getByRole('button', { name: 'Show older' }))
    await waitFor(() => {
      expect(rows(list)).toHaveLength(60)
    })
    expect(asked.at(-1)?.get('offset')).toBe('50')
    expect(screen.queryByRole('button', { name: 'Show older' })).toBeNull()
  })

  it('says so in the serif voice when there is nothing, and offers to clear the filters', async () => {
    const asked = server([])
    const { user } = renderHistory()
    const empty = await screen.findByRole('heading', { name: 'No calls logged yet.' })
    expect(empty).toHaveClass('font-serif')
    expect(
      screen.getByText('Press Log call after your next call, and it shows here.'),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Busy' }))
    expect(
      await screen.findByRole('heading', { name: 'No call matches that.' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Clear the filters to see all your calls.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear the filters' }))
    expect(await screen.findByRole('heading', { name: 'No calls logged yet.' })).toBeInTheDocument()
    expect(asked.at(-1)?.has('outcome')).toBe(false)
  })

  it('says the history could not be loaded, with Try again', async () => {
    server(threeDays(), { fail: true })
    renderHistory()
    expect(
      await screen.findByText(
        "Your call history couldn't be loaded. Check your connection, then try again.",
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('moves with J and K, opens with Enter, and goes to the search with /', async () => {
    server(threeDays())
    const { user } = renderHistory()
    const list = await historyList()
    const [first, second] = [
      within(list).getByRole('button', { name: /Sample Logistics Pty Ltd/ }),
      within(list).getByRole('button', { name: /Sample Mining Pty Ltd/ }),
    ]
    first?.focus()
    await user.keyboard('j')
    expect(second).toHaveFocus()
    await user.keyboard('k')
    expect(first).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(first).toHaveAttribute('aria-expanded', 'true')
    await user.keyboard('/')
    expect(screen.getByRole('searchbox', { name: 'Search your calls' })).toHaveFocus()
  })

  it('is asked for while the code downloads, and the page joins that request', async () => {
    // The options answer; the list stays on its way, so a second request for it would show.
    const asked: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn((request: Request) => {
        const url = new URL(request.url)
        if (url.pathname === `${NOTES}/options`) return Promise.resolve(Response.json(options()))
        if (url.pathname === NOTES) asked.push(url.search)
        return new Promise<Response>(() => undefined)
      }),
    )
    vi.useFakeTimers({ shouldAdvanceTime: true, now: NOW })
    const client = createTestQueryClient()
    prefetchPage(routes, { pathname: '/companies/call-logs', search: '?tab=history' }, client)
    await waitFor(() => {
      expect(asked).toEqual(['?state=history&mine=true&limit=50&offset=0'])
    })
    renderWithProviders(<CallLogsPage />, {
      route: '/companies/call-logs?tab=history',
      queryClient: client,
    })
    expect(await screen.findByRole('searchbox', { name: 'Search your calls' })).toBeInTheDocument()
    expect(asked).toHaveLength(1)
  })
})
