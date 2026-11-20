/**
 * "Needs a company" in Call logs (PLAN-V24 T3-3, choice 20): the calls saved before their company
 * was found sit at the top with their count; each shows the name as heard. Against a fake server
 * that keeps its calls between requests and answers as T3-1's contract says. At a laptop's width
 * (1440px) and a phone's (390px). Made-up names only: Sample Logistics Pty Ltd, Jo Sample, and
 * "North Wind" as heard.
 */
import { screen, waitFor, within } from '@testing-library/react'
import { toast } from 'sonner'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { queryKeys } from '@/api/query'
import type { CallNoteOptions, CallNoteOut, CallNoteSummary } from '@/api/types'
import { routes } from '@/router'
import { prefetchPage } from '@/shell/prefetch'
import { createTestQueryClient, renderWithProviders } from '@/test/render'
import { asLaptop, asPhone } from '@/test/screen'
import CallLogsPage from './index'

const NOTES = '/api/v1/companies/call-notes'

function options(changes: Partial<CallNoteOptions> = {}): CallNoteOptions {
  return {
    enabled: true,
    ai_enabled: true,
    sending_ready: true,
    waiting_for: null,
    outcomes: ['Busy', 'Connected', 'Left live message', 'Left voicemail', 'No answer'],
    fields: [{ id: 'lease_end', label: 'Lease end', kind: 'date' }],
    soft_seconds: 180,
    max_chars: 6000,
    voice_tool: 'browser_service',
    ...changes,
  }
}

/** A call with its company, waiting to be confirmed. */
function call(id: string, changes: Partial<CallNoteOut> = {}): CallNoteOut {
  return {
    id,
    company_key: '101',
    company_name: 'Sample Logistics Pty Ltd',
    company_heard: null,
    person: { id: '201', name: 'Jo Sample', title: 'Office Manager' },
    text: 'Spoke to Jo. The Perth lease ends in June 2028.',
    source: 'mic',
    called_at: '2026-11-10T01:00:00Z',
    status: 'to_confirm',
    sorted_by: 'ai',
    unsure: null,
    call: {
      summary: 'Jo says the Perth lease now ends in June 2028.',
      outcome: 'Connected',
      in_hubspot: false,
    },
    changes: [],
    tasks: [],
    left_out: false,
    steps: [],
    hubspot_url: null,
    made_by: 'Mia',
    created_at: '2026-11-10T01:00:00Z',
    confirmed_at: null,
    ...changes,
  }
}

/** A call saved before its company was found: no company, the name as heard, not sorted. */
function heard(id: string, words: string, changes: Partial<CallNoteOut> = {}): CallNoteOut {
  return call(id, {
    company_key: null,
    company_name: null,
    company_heard: words,
    person: null,
    status: 'needs_company',
    sorted_by: 'person',
    text: 'Spoke to Jo about the Perth lease. She wants a floor plan by Friday.',
    call: { summary: '', outcome: 'Connected', in_hubspot: false },
    ...changes,
  })
}

/** Two calls that need a company, the newer first, and one to confirm. */
function threeCalls(): CallNoteOut[] {
  return [
    heard('h1', 'North Wind', { called_at: '2026-11-10T03:00:00Z' }),
    heard('h2', 'Sample Mines', {
      called_at: '2026-11-10T02:00:00Z',
      text: 'Left a message with reception.',
      call: { summary: '', outcome: 'Left voicemail', in_hubspot: false },
    }),
    call('n1'),
  ]
}

const IN_STATE: Record<string, readonly CallNoteOut['status'][]> = {
  needs_company: ['needs_company'],
  to_confirm: ['sorting', 'to_confirm', 'sending'],
  needs_look: ['partial', 'failed', 'uncertain'],
  history: [
    'needs_company',
    'sorting',
    'to_confirm',
    'sending',
    'logged',
    'partial',
    'failed',
    'uncertain',
  ],
}

interface Sent {
  method: string
  path: string
  search: URLSearchParams
  body: unknown
}

interface Server {
  notes: CallNoteOut[]
  options: CallNoteOptions
  user?: { role: 'platform_admin' | 'admin' | 'staff' | 'viewer'; features: string[] }
  /** The list of calls that need a company fails. */
  listFails: boolean
  sent: Sent[]
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status })
}

/** The counts, from the calls, as `note_store.summary` makes them. */
function countsOf(notes: readonly CallNoteOut[]): CallNoteSummary {
  const count = (statuses: readonly string[]): number =>
    notes.filter((item) => statuses.includes(item.status)).length
  return {
    to_confirm: count(['sorting', 'to_confirm']),
    needs_look: count(['partial', 'failed', 'uncertain']),
    logged_today: 0,
    needs_company: count(['needs_company']),
  }
}

function mockServer(changes: Partial<Omit<Server, 'sent'>> = {}): Server {
  const server: Server = {
    notes: threeCalls(),
    options: options(),
    listFails: false,
    sent: [],
    ...changes,
  }
  const respond = async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    const path = url.pathname
    const method = request.method
    const text = method === 'GET' ? '' : await request.clone().text()
    const body: unknown = text ? JSON.parse(text) : null
    server.sent.push({ method, path, search: url.searchParams, body })
    if (path === '/api/v1/auth/me') {
      if (!server.user) return json({ auth_required: false, user: null, session: null })
      return json({
        auth_required: true,
        user: {
          id: '11111111-2222-3333-4444-555555555555',
          email: 'jo@example.test',
          username: 'jo',
          name: 'Jo Sample',
          position: null,
          apps: ['companies'],
          ...server.user,
        },
        session: null,
      })
    }
    if (path === `${NOTES}/options`) return json(server.options)
    if (path === `${NOTES}/summary`) return json(countsOf(server.notes))
    if (path === NOTES && method === 'GET') {
      const state = url.searchParams.get('state') ?? 'to_confirm'
      if (state === 'needs_company' && server.listFails) {
        return json({ title: 'Something went wrong', status: 500, detail: 'It broke.' }, 500)
      }
      const at = (item: CallNoteOut): number => Date.parse(item.called_at)
      const matching = server.notes
        .filter((item) => (IN_STATE[state] ?? []).includes(item.status))
        // To confirm: the oldest call first. The others: the newest first.
        .sort((a, b) => (state === 'to_confirm' ? at(a) - at(b) : at(b) - at(a)))
      const limit = Number(url.searchParams.get('limit') ?? '50')
      const offset = Number(url.searchParams.get('offset') ?? '0')
      return json({ total: matching.length, items: matching.slice(offset, offset + limit) })
    }
    const one = /^\/api\/v1\/companies\/call-notes\/([^/]+)$/.exec(path)
    if (one) {
      const id = one[1] ?? ''
      const item = server.notes.find((note) => note.id === id)
      if (!item) return json({ title: 'Not found', status: 404, detail: 'Gone.' }, 404)
      if (method === 'DELETE') {
        server.notes = server.notes.filter((note) => note.id !== id)
        return new Response(null, { status: 204 })
      }
      return json(item)
    }
    return json({ title: 'Not found', status: 404, detail: 'Not here.' }, 404)
  }
  vi.stubGlobal(
    'fetch',
    vi.fn((request: Request) => respond(request)),
  )
  return server
}

function sent(server: Server, method: string, path: string): Sent[] {
  return server.sent.filter((item) => item.method === method && item.path === path)
}

function renderCallLogs(route = '/assistant/call-logs') {
  return renderWithProviders(<CallLogsPage />, { route })
}

async function group(): Promise<HTMLElement> {
  return screen.findByRole('region', { name: /^Needs a company/ })
}

function rowNames(within_: HTMLElement): string[] {
  return within(within(within_).getByRole('list', { name: 'Calls that need a company' }))
    .getAllByRole('article')
    .map((row) => row.getAttribute('aria-labelledby') ?? '')
    .map((id) => document.getElementById(id)?.textContent ?? '')
}

afterEach(() => {
  // Sonner keeps toasts in one store for the whole file.
  toast.dismiss()
})

describe.each([
  ['a laptop (1440px)', asLaptop],
  ['a phone (390px)', asPhone],
])('Needs a company in Call logs, on %s', (_width, size) => {
  it('sits at the top, above the tabs, with its count and a plain sentence', async () => {
    size()
    const server = mockServer()
    renderCallLogs()
    const needs = await group()
    const heading = within(needs).getByRole('heading', { level: 2 })
    expect(heading).toHaveTextContent('Needs a company 2')
    expect(
      within(needs).getByText(
        "We couldn't find the company for these calls, so they can't go to HubSpot yet. Pick each one, and its call moves to To confirm.",
      ),
    ).toBeInTheDocument()
    // At the top: before the tabs, which still work under it.
    const tabs = screen.getByRole('tablist', { name: 'Your calls by where they stand' })
    expect(needs.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(await screen.findByRole('list', { name: 'Calls to confirm' })).toBeInTheDocument()
    // It asked for the rep's own calls that need a company.
    const read = sent(server, 'GET', NOTES).find(
      (item) => item.search.get('state') === 'needs_company',
    )
    expect(read?.search.get('mine')).toBe('true')
  })

  it('shows each call by the name as heard, when it was, how it went, and its words', async () => {
    size()
    mockServer()
    renderCallLogs()
    const needs = await group()
    expect(await waitFor(() => rowNames(needs))).toEqual([
      '"North Wind" as heard',
      '"Sample Mines" as heard',
    ])
    const north = within(needs).getByRole('article', { name: '"North Wind" as heard' })
    // No one yet: the company isn't known, so there is no "No one in particular".
    expect(within(north).getByText('10 Nov 2026, 2:00 pm · Connected')).toBeInTheDocument()
    expect(
      within(north).getByText(
        'Spoke to Jo about the Perth lease. She wants a floor plan by Friday.',
      ),
    ).toBeInTheDocument()
    expect(within(north).getByRole('button', { name: 'Remove' })).toBeInTheDocument()
    const mines = within(needs).getByRole('article', { name: '"Sample Mines" as heard' })
    expect(within(mines).getByText('10 Nov 2026, 1:00 pm · Left voicemail')).toBeInTheDocument()
  })

  it('is not there when no call needs a company', async () => {
    size()
    const server = mockServer({ notes: [call('n1')] })
    renderCallLogs()
    expect(await screen.findByRole('list', { name: 'Calls to confirm' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /^Needs a company/ })).toBeNull()
    // With none, it asks for none.
    expect(
      sent(server, 'GET', NOTES).filter((item) => item.search.get('state') === 'needs_company'),
    ).toEqual([])
  })

  it('removes a call at once, with Undo, and the server hears of it when the toast closes', async () => {
    size()
    const server = mockServer()
    const { user } = renderCallLogs()
    const needs = await group()
    const north = await within(needs).findByRole('article', { name: '"North Wind" as heard' })
    await user.click(within(north).getByRole('button', { name: 'Remove' }))

    // Gone at once, the count rolls down, and the next call takes the focus.
    await waitFor(() => {
      expect(rowNames(needs)).toEqual(['"Sample Mines" as heard'])
    })
    expect(within(needs).getByRole('heading', { level: 2 })).toHaveTextContent('Needs a company 1')
    expect(
      within(needs)
        .getByRole('article', { name: '"Sample Mines" as heard' })
        .querySelector('button[data-row-action]'),
    ).toHaveFocus()
    expect(await screen.findByText('Removed the call with "North Wind".')).toBeInTheDocument()
    expect(sent(server, 'DELETE', `${NOTES}/h1`)).toEqual([])

    toast.dismiss()
    await waitFor(() => {
      expect(sent(server, 'DELETE', `${NOTES}/h1`)).toHaveLength(1)
    })
  })

  it('folds a pile of calls to the newest three, with Show all', async () => {
    size()
    const pile = Array.from({ length: 5 }, (_, index) =>
      heard(`p${String(index)}`, `Sample Name ${String(index + 1)}`, {
        called_at: new Date(Date.UTC(2026, 10, 10, 5 - index)).toISOString(),
      }),
    )
    mockServer({ notes: pile })
    const { user } = renderCallLogs()
    const needs = await group()
    await waitFor(() => {
      expect(rowNames(needs)).toHaveLength(3)
    })
    expect(rowNames(needs)[0]).toBe('"Sample Name 1" as heard')
    const showAll = within(needs).getByRole('button', { name: 'Show all 5 calls' })
    expect(showAll).toHaveAttribute('aria-expanded', 'false')
    await user.click(showAll)
    expect(rowNames(needs)).toHaveLength(5)
    expect(within(needs).getByRole('button', { name: 'Show fewer' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })

  it('says so when its calls cannot be read, with Try again, and the tabs still work', async () => {
    size()
    mockServer({ listFails: true })
    renderCallLogs()
    const needs = await group()
    expect(
      await within(needs).findByText("The calls that need a company couldn't be loaded."),
    ).toBeInTheDocument()
    expect(within(needs).getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(await screen.findByRole('list', { name: 'Calls to confirm' })).toBeInTheDocument()
  })

  it('shows the calls with no buttons to a Viewer', async () => {
    size()
    mockServer({ user: { role: 'viewer', features: ['companies.call_logs'] } })
    renderCallLogs()
    const needs = await group()
    const north = await within(needs).findByRole('article', { name: '"North Wind" as heard' })
    expect(within(north).queryByRole('button')).toBeNull()
  })
})

describe('Needs a company while the page loads', () => {
  it('keeps the tabs back until the counts are in, so the group never pushes them down', async () => {
    const asked: string[] = []
    let answer: (value: Response) => void = () => undefined
    vi.stubGlobal(
      'fetch',
      vi.fn((request: Request) => {
        const url = new URL(request.url)
        asked.push(url.pathname)
        if (url.pathname === `${NOTES}/options`) return Promise.resolve(json(options()))
        if (url.pathname === `${NOTES}/summary`) {
          return new Promise<Response>((resolve) => {
            answer = resolve
          })
        }
        if (url.pathname === NOTES) return Promise.resolve(json({ total: 0, items: [] }))
        return Promise.resolve(json({ title: 'Not found', status: 404 }, 404))
      }),
    )
    renderCallLogs()
    // The switches are in, and the counts are still on their way: the still shape, no tabs yet.
    await waitFor(() => {
      expect(asked).toContain(`${NOTES}/options`)
      expect(asked).toContain(`${NOTES}/summary`)
    })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(document.querySelector('[data-slot=pending]')).not.toBeNull()

    answer(json(countsOf([heard('h1', 'North Wind')])))
    const needs = await group()
    const tabs = await screen.findByRole('tablist')
    expect(needs.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('asks for the calls while the code downloads when the counts in the cache say there are some', async () => {
    // The calls that need a company wait, so the page can be seen joining that request.
    const lists: string[] = []
    let release: () => void = () => undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        const url = new URL(request.url)
        if (url.pathname === `${NOTES}/options`) return json(options())
        if (url.pathname === `${NOTES}/summary`) return json(countsOf(threeCalls()))
        if (url.pathname === NOTES) {
          const state = url.searchParams.get('state') ?? ''
          lists.push(state)
          if (state === 'needs_company') {
            await held
            return json({ total: 2, items: threeCalls().slice(0, 2) })
          }
          return json({ total: 1, items: [call('n1')] })
        }
        return json({ title: 'Not found', status: 404 }, 404)
      }),
    )
    const client = createTestQueryClient()
    client.setQueryData(queryKeys.auth.me(), { state: 'off' })
    client.setQueryData(queryKeys.companies.callNoteSummary(), countsOf(threeCalls()))
    prefetchPage(routes, { pathname: '/assistant/call-logs', search: '' }, client)
    await waitFor(() => {
      expect([...lists].sort()).toEqual(['needs_company', 'to_confirm'])
    })
    renderWithProviders(<CallLogsPage />, { route: '/assistant/call-logs', queryClient: client })
    const needs = await group()
    release()
    await waitFor(() => {
      expect(rowNames(needs)).toHaveLength(2)
    })
    // The page joined that request: the calls were asked for once.
    expect(lists.filter((state) => state === 'needs_company')).toHaveLength(1)
  })
})
