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
import { needsCompanySendWords } from './words'

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

interface Company {
  key: string
  name: string
  city: string | null
  industry: string | null
}

/** The companies the rep may see: the search and the list find them. */
const COMPANIES: readonly Company[] = [
  { key: '107', name: 'Northwind Sample Pty Ltd', city: 'Perth', industry: 'Logistics' },
  { key: '101', name: 'Sample Logistics Pty Ltd', city: 'Perth', industry: 'Logistics' },
  { key: '103', name: 'Sample Mining Pty Ltd', city: 'Perth', industry: 'Mining' },
]

interface Server {
  notes: CallNoteOut[]
  options: CallNoteOptions
  user?: { role: 'platform_admin' | 'admin' | 'staff' | 'viewer'; features: string[] }
  /** The list of calls that need a company fails. */
  listFails: boolean
  /** Companies a pick may name but the rep can't see: 422 `company_not_found`. */
  hidden: readonly string[]
  /** Calls picked in another tab just before this pick, by id, with the company's key. */
  pickedElsewhere: Record<string, string>
  sent: Sent[]
}

/** The send's why for a call that needs a company (`note_batch.py`). */
const NEEDS_A_COMPANY_FIRST = 'Needs a company first.'

/** The words the server's 422 `company_not_found` has for a pick (`note_company.py`). */
const NOT_OPEN =
  "It may have been removed, or it isn't open to your account. Pick another company, or search for it again."

/** What a pick does on the server: the company set, and the call sent to be sorted. */
function picked(item: CallNoteOut, company: Company, ai: boolean): CallNoteOut {
  return {
    ...item,
    company_key: company.key,
    company_name: company.name,
    status: ai ? 'sorting' : 'to_confirm',
  }
}

/** The sorter's work on a picked call: a summary, and the person the call was with. */
function sorted(item: CallNoteOut): CallNoteOut {
  return {
    ...item,
    status: 'to_confirm',
    sorted_by: 'ai',
    person: { id: '201', name: 'Jo Sample', title: 'Office Manager' },
    call: { ...item.call, summary: 'Jo says the Perth lease now ends in June 2028.' },
  }
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
    hidden: [],
    pickedElsewhere: {},
    sent: [],
    ...changes,
  }
  // A call being sorted is sorted by the time it has been read once (the page asks again).
  const read = new Set<string>()
  const put = (next: CallNoteOut): CallNoteOut => {
    server.notes = server.notes.map((item) => (item.id === next.id ? next : item))
    return next
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
      if (state === 'to_confirm') {
        for (const item of server.notes) {
          if (item.status === 'sorting' && read.has(item.id)) put(sorted(item))
          else if (item.status === 'sorting') read.add(item.id)
        }
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
    if (path === `${NOTES}/preview` || path === `${NOTES}/confirm`) {
      const asked = (body as { ids: string[] }).ids
      const found = asked
        .map((id) => server.notes.find((note) => note.id === id))
        .filter((item): item is CallNoteOut => item !== undefined)
      const skipped = found
        .filter((item) => item.status === 'needs_company')
        .map((item) => ({ id: item.id, why: NEEDS_A_COMPANY_FIRST }))
      const going = found.filter((item) => item.status !== 'needs_company')
      if (path.endsWith('/confirm')) {
        for (const item of going) put({ ...item, status: 'sending' })
        return json({ sending: going.length, already_sending: false, skipped }, 202)
      }
      return json({
        items: going,
        sending_ready: true,
        waiting_for: null,
        totals: {
          calls: going.length,
          meeting_notes: 0,
          tasks: going.reduce((sum, item) => sum + item.tasks.length, 0),
          changes: going.reduce((sum, item) => sum + item.changes.length, 0),
        },
        skipped,
      })
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
      if (method === 'PATCH') {
        const key = (body as { company_key?: string }).company_key
        const elsewhere = COMPANIES.find((one) => one.key === server.pickedElsewhere[id])
        if (elsewhere && item.status === 'needs_company') {
          put(picked(item, elsewhere, server.options.ai_enabled))
        }
        const now = server.notes.find((note) => note.id === id) ?? item
        if (now.status !== 'needs_company') {
          return json(
            {
              title: 'The company is set already',
              status: 409,
              code: 'company_set',
              detail:
                "This call has its company already, so it can't be picked again. Reload Call logs to see it.",
            },
            409,
          )
        }
        const company = COMPANIES.find((one) => one.key === key)
        if (!company || server.hidden.includes(company.key)) {
          return json(
            {
              title: "We can't find that company",
              status: 422,
              code: 'company_not_found',
              detail: NOT_OPEN,
            },
            422,
          )
        }
        return json(put(picked(now, company, server.options.ai_enabled)))
      }
      if (item.status === 'sending') {
        return json(put({ ...item, status: 'logged', confirmed_at: '2026-11-15T04:00:00Z' }))
      }
      return json(item)
    }
    if (path === '/api/v1/companies/search') {
      // Each word as typed, spaces aside: "North Wind" finds Northwind Sample Pty Ltd.
      const q = (url.searchParams.get('q') ?? '').toLowerCase().replace(/\s+/g, '')
      return json({
        people: [],
        companies: COMPANIES.filter((one) => one.name.toLowerCase().replace(/\s+/g, '').includes(q))
          .slice(0, 4)
          .map((one) => ({ ...one, source: 'hubspot' })),
      })
    }
    if (path === '/api/v1/companies') {
      return json({
        items: COMPANIES.map((one) => ({
          ...one,
          staff: null,
          source: 'hubspot',
          domain: null,
          website: null,
          state: null,
          owner: null,
          last_talk: null,
          deal: null,
          lead: null,
        })),
        total: COMPANIES.length,
        leads_shown: false,
      })
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
    expect(within(north).getByRole('button', { name: 'Pick company' })).toBeInTheDocument()
    expect(within(north).getByRole('button', { name: 'Remove' })).toBeInTheDocument()
    const mines = within(needs).getByRole('article', { name: '"Sample Mines" as heard' })
    expect(within(mines).getByText('10 Nov 2026, 1:00 pm · Left voicemail')).toBeInTheDocument()
  })

  it('a pick searches for the name as heard, and the call moves to To confirm once it is sorted', async () => {
    size()
    const server = mockServer()
    const { user } = renderCallLogs()
    const needs = await group()
    const north = await within(needs).findByRole('article', { name: '"North Wind" as heard' })
    // By keyboard, as the rest of Call logs works.
    within(north).getByRole('button', { name: 'Pick company' }).focus()
    await user.keyboard('{Enter}')

    // Log call's search, titled for the pick, already holding the name as heard.
    const panel = await screen.findByRole('dialog', { name: 'Pick company' })
    expect(panel).toHaveAccessibleDescription(
      'Heard as "North Wind". Which company was the call with?',
    )
    const search = within(panel).getByRole('combobox', {
      name: 'Which company was the call with?',
    })
    expect(search).toHaveValue('North Wind')
    expect(search).toHaveFocus()
    expect(
      await within(panel).findByRole('option', { name: /Northwind Sample Pty Ltd/ }),
    ).toBeInTheDocument()
    await user.keyboard('{Enter}')

    // Sent once, with the company alone.
    await waitFor(() => {
      expect(sent(server, 'PATCH', `${NOTES}/h1`)).toHaveLength(1)
    })
    expect(sent(server, 'PATCH', `${NOTES}/h1`)[0]?.body).toEqual({ company_key: '107' })
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Pick company' })).toBeNull()
    })
    // It left the group at once, the count moved, and the next call has the focus.
    await waitFor(() => {
      expect(rowNames(needs)).toEqual(['"Sample Mines" as heard'])
    })
    expect(within(needs).getByRole('heading', { level: 2 })).toHaveTextContent('Needs a company 1')
    await waitFor(() => {
      expect(
        within(needs)
          .getByRole('article', { name: '"Sample Mines" as heard' })
          .querySelector('[data-row-action]'),
      ).toHaveFocus()
    })
    expect(
      await screen.findByText('The call with Northwind Sample Pty Ltd is in To confirm.'),
    ).toBeInTheDocument()

    // In To confirm: sorted first, as a new call is, then there to check and send.
    const list = await screen.findByRole('list', { name: 'Calls to confirm' })
    const card = await within(list).findByRole('article', { name: 'Northwind Sample Pty Ltd' })
    expect(within(card).getByText('Sorting the note.')).toBeInTheDocument()
    expect(
      await within(card).findByText(
        'Jo says the Perth lease now ends in June 2028.',
        {},
        { timeout: 5000 },
      ),
    ).toBeInTheDocument()
    expect(within(card).queryByText('Sorting the note.')).toBeNull()
    expect(screen.getByRole('tab', { name: /^To confirm/ })).toHaveTextContent('To confirm 2')
  }, 15_000)

  it('Esc closes the search, sends nothing, and puts the focus back on the call', async () => {
    size()
    const server = mockServer()
    const { user } = renderCallLogs()
    const needs = await group()
    const north = await within(needs).findByRole('article', { name: '"North Wind" as heard' })
    const pick = within(north).getByRole('button', { name: 'Pick company' })
    await user.click(pick)
    const panel = await screen.findByRole('dialog', { name: 'Pick company' })
    // The name heard is chosen, so typing replaces it, and the search follows.
    await user.keyboard('sample min')
    expect(
      within(panel).getByRole('combobox', { name: 'Which company was the call with?' }),
    ).toHaveValue('sample min')
    expect(
      await within(panel).findByRole('option', { name: /Sample Mining Pty Ltd/ }),
    ).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Pick company' })).toBeNull()
    })
    await waitFor(() => {
      expect(pick).toHaveFocus()
    })
    expect(sent(server, 'PATCH', `${NOTES}/h1`)).toEqual([])
    expect(rowNames(needs)).toHaveLength(2)
  })

  it('the last call picked takes the group away, and the focus goes to the tabs', async () => {
    size()
    mockServer({ notes: [heard('h1', 'North Wind'), call('n1')] })
    const { user } = renderCallLogs()
    const needs = await group()
    const north = await within(needs).findByRole('article', { name: '"North Wind" as heard' })
    await user.click(within(north).getByRole('button', { name: 'Pick company' }))
    const panel = await screen.findByRole('dialog', { name: 'Pick company' })
    await user.click(await within(panel).findByRole('option', { name: /Northwind Sample/ }))
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: /^Needs a company/ })).toBeNull()
    })
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /^To confirm/ })).toHaveFocus()
    })
  })

  it("brings the call back when the server refuses the company, and says why in the server's words", async () => {
    size()
    const server = mockServer({ hidden: ['107'] })
    const { user } = renderCallLogs()
    const needs = await group()
    const north = await within(needs).findByRole('article', { name: '"North Wind" as heard' })
    await user.click(within(north).getByRole('button', { name: 'Pick company' }))
    const panel = await screen.findByRole('dialog', { name: 'Pick company' })
    await user.click(await within(panel).findByRole('option', { name: /Northwind Sample/ }))
    const shown = (await screen.findByText("The company wasn't picked")).closest(
      '[data-sonner-toast]',
    )
    if (!(shown instanceof HTMLElement)) throw new Error('No toast')
    expect(within(shown).getByText(NOT_OPEN)).toBeInTheDocument()
    await waitFor(() => {
      expect(rowNames(needs)).toEqual(['"North Wind" as heard', '"Sample Mines" as heard'])
    })
    expect(within(needs).getByRole('heading', { level: 2 })).toHaveTextContent('Needs a company 2')
    expect(sent(server, 'PATCH', `${NOTES}/h1`)).toHaveLength(1)
  })

  it('reads the call again when the server has its company already, with no error', async () => {
    size()
    // Picked in another tab a moment before: the server answers 409 `company_set`.
    const server = mockServer({ pickedElsewhere: { h1: '107' } })
    const { user } = renderCallLogs()
    const needs = await group()
    const north = await within(needs).findByRole('article', { name: '"North Wind" as heard' })
    await user.click(within(north).getByRole('button', { name: 'Pick company' }))
    const panel = await screen.findByRole('dialog', { name: 'Pick company' })
    await user.click(await within(panel).findByRole('option', { name: /Northwind Sample/ }))
    expect(
      await screen.findByText('The call with Northwind Sample Pty Ltd is in To confirm.'),
    ).toBeInTheDocument()
    expect(screen.queryByText("The company wasn't picked")).toBeNull()
    expect(sent(server, 'GET', `${NOTES}/h1`)).toHaveLength(1)
    await waitFor(() => {
      expect(rowNames(needs)).toEqual(['"Sample Mines" as heard'])
    })
  })

  it('a send leaves the calls that need a company out, and says why', async () => {
    size()
    const server = mockServer()
    const { user } = renderCallLogs()
    await group()
    await screen.findByRole('list', { name: 'Calls to confirm' })
    await user.click(screen.getByRole('button', { name: 'Send 1 to HubSpot' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Send 1 call to HubSpot?' })
    expect(
      within(dialog).getByText('2 calls need a company first. They stay in Call logs.'),
    ).toBeInTheDocument()
    expect(await within(dialog).findByText('1 call, 0 tasks, 0 field changes')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Send to HubSpot' }))

    // Only the call with its company went; the two that need one stay at the top.
    await waitFor(() => {
      expect(sent(server, 'POST', `${NOTES}/confirm`)).toHaveLength(1)
    })
    expect(sent(server, 'POST', `${NOTES}/confirm`)[0]?.body).toEqual({ ids: ['n1'] })
    expect(
      await screen.findByText('1 logged in HubSpot.', {}, { timeout: 5000 }),
    ).toBeInTheDocument()
    expect(rowNames(await group())).toEqual(['"North Wind" as heard', '"Sample Mines" as heard'])
  }, 15_000)

  it('says nothing of them in a send when none needs a company', async () => {
    size()
    mockServer({ notes: [call('n1')] })
    const { user } = renderCallLogs()
    await screen.findByRole('list', { name: 'Calls to confirm' })
    await user.click(screen.getByRole('button', { name: 'Send 1 to HubSpot' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Send 1 call to HubSpot?' })
    expect(await within(dialog).findByText('1 call, 0 tasks, 0 field changes')).toBeInTheDocument()
    expect(dialog.querySelector('[data-slot=send-needs-company]')).toBeNull()
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

describe('the words of a send that leaves calls out (PLAN-V24)', () => {
  it('says one call, or many, the way the other words do', () => {
    expect(needsCompanySendWords(1)).toBe('1 call needs a company first. It stays in Call logs.')
    expect(needsCompanySendWords(3)).toBe('3 calls need a company first. They stay in Call logs.')
  })
})
