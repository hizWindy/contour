import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { toast } from 'sonner'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { queryKeys } from '@/api/query'
import type {
  CompanyDetail,
  CallNoteChange,
  CallNoteOptions,
  CallNoteOut,
  CallNotePatch,
  CallNoteState,
  CallNoteStatus,
  CallNoteSummary,
  CallNoteTask,
} from '@/api/types'
import { readDueDate } from '@/lib/due-date'
import { formatDate, melbourneDate } from '@/lib/format'
import { routes } from '@/router'
import { prefetchPage } from '@/shell/prefetch'
import { fakeIdle } from '@/test/fake-idle'
import { createTestQueryClient, renderWithProviders } from '@/test/render'
import { asPhone } from '@/test/screen'
import { dueWords } from '../call-notes/words'
import CallLogsPage from './index'
import { ToConfirm } from './to-confirm'
import { landingOf, useBatch } from './use-batch'
import { batchSentence } from './words'

/*
  Call logs (PLAN-V17 T3-6; called Activity until PLAN-V18 T3-2), against the generated contract
  and a fake server that keeps its notes between requests. Made-up names only: Sample Logistics
  Pty Ltd, Jo Sample.
*/

const API = '/api/v1/companies'
const NOTES = `${API}/call-notes`
const HUBSPOT_URL = 'https://app.hubspot.com/contacts/1/record/0-48/9'

function options(changes: Partial<CallNoteOptions> = {}): CallNoteOptions {
  return {
    enabled: true,
    ai_enabled: true,
    sending_ready: true,
    waiting_for: null,
    outcomes: ['Busy', 'Connected', 'Left live message', 'Left voicemail', 'No answer'],
    fields: [
      { id: 'lease_end', label: 'Lease end', kind: 'date' },
      { id: 'staff', label: 'Staff', kind: 'number' },
    ],
    soft_seconds: 180,
    max_chars: 6000,
    voice_tool: 'browser_model',
    ...changes,
  }
}

const LEASE: CallNoteChange = {
  id: 'c1',
  field: 'lease_end',
  label: 'Lease end',
  office: 'Perth',
  current: '2026-06-30',
  value: '2028-06-30',
  current_changed: false,
  in_hubspot: false,
}

const TASK: CallNoteTask = {
  id: 't1',
  subject: 'Call Jo back about the lease',
  due: '2026-11-24',
  due_words: 'next Tuesday',
  kind: 'call',
  owner: null,
  in_hubspot: false,
}

function note(id: string, changes: Partial<CallNoteOut> = {}): CallNoteOut {
  return {
    id,
    company_key: '101',
    company_name: 'Sample Logistics Pty Ltd',
    person: { id: '201', name: 'Jo Sample', title: 'Office Manager' },
    text: 'Spoke to Jo. The Perth lease ends in June 2028.',
    source: 'typed',
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

/** Three calls: one with a change and a follow-up, two plain ones. */
function threeNotes(): CallNoteOut[] {
  return [
    note('n1', { changes: [LEASE], tasks: [TASK] }),
    note('n2', {
      company_key: '103',
      company_name: 'Sample Mining Pty Ltd',
      person: null,
      called_at: '2026-11-10T02:00:00Z',
      call: {
        summary: 'Left a message with reception.',
        outcome: 'Left voicemail',
        in_hubspot: false,
      },
    }),
    note('n3', {
      company_key: '105',
      company_name: 'Sample Freight Pty Ltd',
      person: { id: '301', name: 'Sam Sample', title: null },
      called_at: '2026-11-10T03:00:00Z',
      call: {
        summary: 'Sam wants a floor plan by Friday.',
        outcome: 'Connected',
        in_hubspot: false,
      },
    }),
  ]
}

function detail(): CompanyDetail {
  return {
    key: '101',
    source: 'hubspot',
    name: 'Sample Logistics Pty Ltd',
    domain: 'samplelogistics.com.au',
    website: null,
    city: 'Perth',
    state: 'WA',
    industry: 'Logistics and Supply Chain',
    staff: 300,
    linkedin_staff: null,
    description: null,
    owner: 'Levi',
    lifecycle_stage: null,
    last_talk: '2026-10-01',
    last_talk_note: null,
    next_lease_end: '2027-06-30',
    deal: 'open',
    hubspot_url: null,
    offices: [],
    deals: [],
    notes: [],
    people: [
      { id: '201', name: 'Jo Sample', title: 'Office Manager', phone: null, last_activity: null },
    ],
    calls: [],
    people_status: 'ready',
    lead: null,
  }
}

interface Sent {
  method: string
  path: string
  search: URLSearchParams
  body: unknown
}

interface Server {
  options: CallNoteOptions | null
  summary: CallNoteSummary
  notes: CallNoteOut[]
  user?: { role: 'platform_admin' | 'admin' | 'staff' | 'viewer'; features: string[] }
  /** Companies returned by GET /companies. Defaults to two rows in newest-activity order. */
  companies?: Array<{
    key: string
    name: string
    city: string | null
    industry: string | null
    staff: number | null
  }>
  /** How a sent note lands, by id. Not named: logged. */
  lands: Record<string, Partial<CallNoteOut>>
  /** What PATCH does: answer, refuse, or wait until `release()`. */
  patch: 'ok' | 'fail' | 'wait'
  release: () => void
  alreadySending: boolean
  /** HubSpot's value now, by change id, for the preview. */
  hubspotNow: Record<string, Pick<CallNoteChange, 'current' | 'current_changed'>>
  /** The lists answer 409 `call_notes_off`. */
  listsOff: boolean
  /** Notes the preview and the confirm won't send, by id, with why (T3-11). */
  skip: Record<string, string>
  /** Try again answers 422 `change_off_the_list` (T3-11). */
  retryRefused: boolean
  /** The preview's totals as before Track 2's `37ba1e5`: no `meeting_notes`, each counted a call. */
  oldTotals: boolean
  sent: Sent[]
}

/** Track 2's words for a note naming a field off the list (T3-11). */
const OFF_THE_LIST =
  "A change on this note isn't one a call may change. Remove it, then send the note again."

const IN_STATE: Record<CallNoteState | 'history', readonly CallNoteStatus[]> = {
  to_confirm: ['sorting', 'to_confirm', 'sending'],
  logged: ['logged'],
  needs_look: ['partial', 'failed', 'uncertain'],
  // PLAN-V24: the calls saved before their company was found.
  needs_company: ['needs_company'],
  // History (PLAN-V18 T3-6): every note, in any status.
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

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status })
}

function problem(status: number, title: string, detail: string, code = 'test_problem'): Response {
  return json({ title, detail, status, code }, status)
}

function applyPatch(before: CallNoteOut, patch: CallNotePatch): CallNoteOut {
  const next: CallNoteOut = { ...before, call: { ...before.call } }
  if (patch.summary != null) next.call.summary = patch.summary
  if (patch.outcome !== undefined) next.call.outcome = patch.outcome
  if (patch.left_out != null) next.left_out = patch.left_out
  if (patch.changes) {
    next.changes = patch.changes.map((change, index) => {
      const was = before.changes.find((item) => item.id === change.id)
      return {
        id: change.id ?? `c-new-${String(index)}`,
        field: change.field,
        label: was?.label ?? 'Lease end',
        office: change.office ?? '',
        current: was?.current ?? null,
        value: change.value,
        current_changed: false,
        in_hubspot: false,
      }
    })
  }
  if (patch.tasks) {
    next.tasks = patch.tasks.map((task, index) => ({
      id: task.id ?? `t-new-${String(index)}`,
      subject: task.subject,
      due: task.due,
      due_words: task.due_words ?? '',
      kind: task.kind,
      owner: null,
      in_hubspot: false,
    }))
  }
  return next
}

function mockServer(changes: Partial<Omit<Server, 'sent' | 'release'>> = {}): Server {
  const server: Server = {
    options: options(),
    summary: { to_confirm: 3, needs_look: 0, logged_today: 0 },
    notes: [],
    lands: {},
    patch: 'ok',
    release: () => undefined,
    alreadySending: false,
    hubspotNow: {},
    listsOff: false,
    skip: {},
    retryRefused: false,
    oldTotals: false,
    sent: [],
    ...changes,
  }
  const skippedOf = (ids: readonly string[]) =>
    ids.filter((id) => id in server.skip).map((id) => ({ id, why: server.skip[id] ?? '' }))
  const find = (id: string): CallNoteOut | undefined => server.notes.find((item) => item.id === id)
  const put = (next: CallNoteOut): CallNoteOut => {
    server.notes = server.notes.map((item) => (item.id === next.id ? next : item))
    return next
  }
  let made = 0
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
    if (path === `${NOTES}/options`) {
      return server.options ? json(server.options) : problem(404, 'Not found', 'Not here.')
    }
    if (path === `${NOTES}/summary`) return json(server.summary)
    if (path === NOTES && method === 'GET') {
      if (server.listsOff) {
        return problem(409, 'Call notes are off', 'An admin can switch them on.', 'call_notes_off')
      }
      const state = (url.searchParams.get('state') ?? 'to_confirm') as keyof typeof IN_STATE
      const limit = Number(url.searchParams.get('limit') ?? '50')
      const offset = Number(url.searchParams.get('offset') ?? '0')
      const matching = server.notes.filter((item) => IN_STATE[state].includes(item.status))
      return json({ total: matching.length, items: matching.slice(offset, offset + limit) })
    }
    if (path === NOTES && method === 'POST') {
      made += 1
      const saved = note(`n-new-${String(made)}`, {
        ...(body as object),
        company_name: 'Sample Logistics Pty Ltd',
        person: null,
        status: 'to_confirm',
      })
      server.notes.push(saved)
      return json(saved, 201)
    }
    if (path === `${NOTES}/preview`) {
      const asked = (body as { ids: string[] }).ids
      const items = asked
        .filter((id) => !(id in server.skip))
        .map(find)
        .filter((item): item is CallNoteOut => item !== undefined)
        .map((item) => ({
          ...item,
          changes: item.changes.map((change) => ({
            ...change,
            ...(server.hubspotNow[change.id] ?? {}),
          })),
        }))
      // As Track 2 counts: the calls, and a logged meeting's notes on their own. Without the
      // skipped notes, which aren't among the items.
      const meetings = items.filter((item) => item.source === 'transcript').length
      return json({
        items,
        sending_ready: server.options?.sending_ready ?? false,
        waiting_for: server.options?.waiting_for ?? null,
        totals: {
          calls: server.oldTotals ? items.length : items.length - meetings,
          ...(server.oldTotals ? {} : { meeting_notes: meetings }),
          tasks: items.reduce((sum, item) => sum + item.tasks.length, 0),
          changes: items.reduce((sum, item) => sum + item.changes.length, 0),
        },
        skipped: skippedOf(asked),
      })
    }
    if (path === `${NOTES}/confirm`) {
      if (server.alreadySending) return json({ sending: 0, already_sending: true })
      const asked = (body as { ids: string[] }).ids
      const ids = asked.filter((id) => !(id in server.skip))
      for (const id of ids) {
        const item = find(id)
        if (item) put({ ...item, status: 'sending' })
      }
      return json({ sending: ids.length, already_sending: false, skipped: skippedOf(asked) })
    }
    const one = /^\/api\/v1\/companies\/call-notes\/([^/]+?)(?:\/(retry|resolve))?$/.exec(path)
    if (one) {
      const id = one[1] ?? ''
      const action = one[2]
      const item = find(id)
      if (!item) return problem(404, 'Not found', 'That note is gone.')
      if (action === 'retry' && server.retryRefused) {
        return problem(422, "This note can't be sent", OFF_THE_LIST, 'change_off_the_list')
      }
      if (action === 'retry') return json(put({ ...item, status: 'sending' }))
      if (action === 'resolve') {
        const { step, landed } = body as { step: string; landed: boolean }
        return json(
          put({
            ...item,
            status: landed ? 'logged' : 'failed',
            steps: item.steps.map((one) =>
              one.step === step
                ? {
                    ...one,
                    status: landed ? 'done' : 'failed',
                    words: landed ? 'You checked: it is there.' : "You checked: it isn't there.",
                  }
                : one,
            ),
          }),
        )
      }
      if (method === 'GET') {
        // A note on its way lands the first time it is asked for.
        if (item.status !== 'sending') return json(item)
        return json(
          put({
            ...item,
            status: 'logged',
            hubspot_url: HUBSPOT_URL,
            confirmed_at: '2026-11-15T04:00:00Z',
            ...(server.lands[id] ?? {}),
          }),
        )
      }
      if (method === 'PATCH') {
        if (server.patch === 'fail') {
          return problem(422, "That change can't be saved", 'The day has to be a weekday.')
        }
        if (server.patch === 'wait') {
          await new Promise<void>((resolve) => {
            server.release = resolve
          })
        }
        return json(put(applyPatch(item, body as CallNotePatch)))
      }
      if (method === 'DELETE') {
        server.notes = server.notes.filter((other) => other.id !== id)
        return new Response(null, { status: 204 })
      }
    }
    const DEFAULT_COMPANIES = [
      {
        key: '101',
        name: 'Sample Logistics Pty Ltd',
        city: 'Perth',
        industry: 'Logistics and Supply Chain',
        staff: 300,
      },
      {
        key: '102',
        name: 'Sample Freight Co',
        city: 'Melbourne',
        industry: 'Freight',
        staff: 120,
      },
    ]
    if (path === API) {
      const limit = Number(url.searchParams.get('limit') ?? '50')
      const offset = Number(url.searchParams.get('offset') ?? '0')
      const all = server.companies ?? DEFAULT_COMPANIES
      return json({
        items: all.slice(offset, offset + limit).map((item) => ({
          ...item,
          source: 'hubspot',
          domain: null,
          website: null,
          state: null,
          owner: null,
          last_talk: null,
          deal: null,
          lead: null,
        })),
        total: all.length,
        leads_shown: false,
      })
    }
    if (path === `${API}/search`) {
      const q = (url.searchParams.get('q') ?? '').trim().toLowerCase()
      const pool = server.companies ?? DEFAULT_COMPANIES
      return json({
        people: [],
        companies: pool
          .filter((c) => c.name.toLowerCase().includes(q))
          .slice(0, 4)
          .map((c) => ({
            key: c.key,
            name: c.name,
            city: c.city,
            industry: c.industry,
            source: 'hubspot',
          })),
      })
    }
    if (path === `${API}/101` || path === `${API}/102`) {
      const id = path.endsWith('/102') ? '102' : '101'
      return json({
        ...detail(),
        key: id,
        name: id === '102' ? 'Sample Freight Co' : 'Sample Logistics Pty Ltd',
      })
    }
    return problem(404, 'Not found', 'Not here.')
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

async function toConfirmList(): Promise<HTMLElement> {
  return screen.findByRole('list', { name: 'Calls to confirm' })
}

function card(name: string): HTMLElement {
  return screen.getByRole('article', { name })
}

function cardNames(list: HTMLElement): string[] {
  return within(list)
    .getAllByRole('article')
    .map((item) => within(item).getByRole('heading', { level: 2 }).textContent ?? '')
}

afterEach(() => {
  // Sonner keeps toasts in one store for the whole file.
  toast.dismiss()
})

describe('To confirm', () => {
  it('shows each call, unsure first, with its changes, follow-ups and HubSpot value now', async () => {
    const notes = threeNotes()
    notes[2] = { ...notes[2], unsure: 'I could not tell which office she meant.' }
    const server = mockServer({
      notes,
      hubspotNow: { c1: { current: '2027-06-30', current_changed: true } },
    })
    const { user } = renderCallLogs()
    const list = await toConfirmList()
    expect(cardNames(list)).toEqual([
      'Sample Freight Pty Ltd',
      'Sample Logistics Pty Ltd',
      'Sample Mining Pty Ltd',
    ])
    expect(
      within(card('Sample Freight Pty Ltd'))
        .getByText(/I could not tell/)
        .closest('p'),
    ).toHaveTextContent('Check this one. I could not tell which office she meant.')

    const logistics = card('Sample Logistics Pty Ltd')
    expect(
      within(logistics).getByText('Jo Sample, Office Manager · 10 Nov 2026, 12:00 pm · Connected'),
    ).toBeInTheDocument()
    expect(within(logistics).getByRole('heading', { name: 'Changes' })).toBeInTheDocument()
    expect(within(logistics).getByText('Lease end · Perth')).toBeInTheDocument()
    expect(within(logistics).getByText(formatDate('2028-06-30'))).toBeInTheDocument()
    expect(within(logistics).getByText('Call Jo back about the lease')).toBeInTheDocument()
    expect(
      within(logistics).getByText('Call · Due Tue 24 Nov 2026 · from "next Tuesday" · For you'),
    ).toBeInTheDocument()

    // Opening the tab asked HubSpot for the notes with changes, and the moved value is held.
    await waitFor(() => {
      expect(sent(server, 'POST', `${NOTES}/preview`)).toHaveLength(1)
    })
    expect(sent(server, 'POST', `${NOTES}/preview`)[0]?.body).toEqual({ ids: ['n1'] })
    expect(
      await within(logistics).findByText(
        `Changed in HubSpot since: now ${formatDate('2027-06-30')}. Held until you check it.`,
      ),
    ).toBeInTheDocument()
    // It asked for the rep's own notes to confirm.
    const read = sent(server, 'GET', NOTES)[0]
    expect(read?.search.get('state')).toBe('to_confirm')
    expect(read?.search.get('mine')).toBe('true')

    // "Keep mine" is an edit: the change stays, no longer held.
    await user.click(within(logistics).getByRole('button', { name: 'Keep mine' }))
    expect(within(logistics).queryByText(/Held until you check it/)).not.toBeInTheDocument()
    await waitFor(() => {
      expect(sent(server, 'PATCH', `${NOTES}/n1`)).toHaveLength(1)
    })
    expect(sent(server, 'PATCH', `${NOTES}/n1`)[0]?.body).toEqual({
      changes: [{ id: 'c1', field: 'lease_end', office: 'Perth', value: '2028-06-30' }],
    })
  })

  it('an edit answers at once and goes as a PATCH, and the date forgives', async () => {
    const server = mockServer({ notes: threeNotes(), patch: 'wait' })
    const { user } = renderCallLogs()
    await toConfirmList()
    const logistics = card('Sample Logistics Pty Ltd')
    await user.click(within(logistics).getByRole('button', { name: /^Edit/ }))
    const summary = within(logistics).getByRole('textbox', {
      name: 'Summary: Sample Logistics Pty Ltd',
    })
    expect(summary).toHaveFocus()
    await user.clear(summary)
    await user.type(summary, 'Jo will call back in March.')
    await user.click(within(logistics).getByRole('button', { name: 'Done' }))

    // At once, before the server has answered.
    expect(await within(logistics).findByText('Jo will call back in March.')).toBeInTheDocument()
    await waitFor(() => {
      expect(sent(server, 'PATCH', `${NOTES}/n1`)).toHaveLength(1)
    })
    expect(sent(server, 'PATCH', `${NOTES}/n1`)[0]?.body).toEqual({
      summary: 'Jo will call back in March.',
    })
    await act(async () => {
      server.release()
      await Promise.resolve()
    })

    // The follow-up's day takes "next tue", and says which day it read.
    server.patch = 'ok'
    await user.click(within(logistics).getByRole('button', { name: /^Edit/ }))
    const when = within(logistics).getByRole('textbox', { name: 'Follow-up 1: when' })
    await user.clear(when)
    await user.type(when, 'next tue')
    const due = readDueDate('next tue', melbourneDate())
    if (due.kind !== 'date') throw new Error('next tue is a day')
    expect(within(logistics).getByText(dueWords(due.date, due.moved))).toBeInTheDocument()
    await user.keyboard('{Enter}')
    await waitFor(() => {
      expect(sent(server, 'PATCH', `${NOTES}/n1`)).toHaveLength(2)
    })
    expect(sent(server, 'PATCH', `${NOTES}/n1`)[1]?.body).toEqual({
      tasks: [
        {
          id: 't1',
          subject: 'Call Jo back about the lease',
          due: due.date,
          due_words: 'next tue',
          kind: 'call',
        },
      ],
    })
  })

  it('a change opens as the card shows it, and the same day left or typed again saves nothing', async () => {
    const server = mockServer({ notes: threeNotes() })
    const { user } = renderCallLogs()
    await toConfirmList()
    const logistics = card('Sample Logistics Pty Ltd')
    await user.click(within(logistics).getByRole('button', { name: /^Edit/ }))
    const value = within(logistics).getByRole('textbox', { name: 'Lease end · Perth: new value' })
    expect(value).toHaveValue(formatDate('2028-06-30'))

    // In and out again, then the same day typed another way: no change, so nothing is sent.
    await user.click(value)
    await user.tab()
    await user.clear(value)
    await user.type(value, '30/6/2028')
    await user.tab()
    // A new day goes in the one strict form. It is the only edit the server hears of.
    await user.clear(value)
    await user.type(value, '31 Mar 2029')
    await user.keyboard('{Enter}')
    await waitFor(() => {
      expect(sent(server, 'PATCH', `${NOTES}/n1`)).toHaveLength(1)
    })
    expect(sent(server, 'PATCH', `${NOTES}/n1`)[0]?.body).toEqual({
      changes: [{ id: 'c1', field: 'lease_end', office: 'Perth', value: '2029-03-31' }],
    })
  })

  it('a follow-up shows the day stored until the rep types, and says so when that day has gone', async () => {
    // The words were read on the day of the call. Read again today, "tomorrow" is another day.
    const later: CallNoteTask = { ...TASK, due: '2030-01-07', due_words: 'tomorrow' }
    const gone: CallNoteTask = {
      ...TASK,
      id: 't2',
      subject: 'Send the floor plan',
      due: '2020-01-06',
      due_words: 'next Monday',
    }
    mockServer({ notes: [note('n1', { tasks: [later, gone] })] })
    const { user } = renderCallLogs()
    await toConfirmList()
    const logistics = card('Sample Logistics Pty Ltd')
    expect(
      within(logistics).getByText('Call · Due Mon 7 Jan 2030 · from "tomorrow" · For you'),
    ).toBeInTheDocument()
    await user.click(within(logistics).getByRole('button', { name: /^Edit/ }))

    const first = within(logistics).getByRole('textbox', { name: 'Follow-up 1: when' })
    expect(first).toHaveValue('tomorrow')
    expect(first).toHaveAccessibleDescription('Due Mon 7 Jan 2030.')
    const second = within(logistics).getByRole('textbox', { name: 'Follow-up 2: when' })
    expect(second).toHaveAccessibleDescription('That day has gone. Pick today or a later day.')
    expect(
      within(logistics).getByText('That day has gone. Pick today or a later day.'),
    ).toHaveClass('text-destructive-ink')

    // Once the rep types, the line follows the words, read today.
    await user.clear(first)
    await user.type(first, 'next tue')
    const due = readDueDate('next tue', melbourneDate())
    if (due.kind !== 'date') throw new Error('next tue is a day')
    expect(first).toHaveAccessibleDescription(dueWords(due.date, due.moved))
  })

  it('a follow-up removed while editing goes at once, and Undo puts it back as a new one', async () => {
    const server = mockServer({ notes: threeNotes() })
    const { user } = renderCallLogs()
    await toConfirmList()
    const logistics = card('Sample Logistics Pty Ltd')
    await user.click(within(logistics).getByRole('button', { name: /^Edit/ }))
    await user.click(
      within(logistics).getByRole('button', {
        name: 'Remove follow-up 1: Call Jo back about the lease',
      }),
    )
    await waitFor(() => {
      expect(sent(server, 'PATCH', `${NOTES}/n1`)[0]?.body).toEqual({ tasks: [] })
    })
    expect(
      await screen.findByText('Removed the follow-up: Call Jo back about the lease.'),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => {
      expect(sent(server, 'PATCH', `${NOTES}/n1`)).toHaveLength(2)
    })
    expect(sent(server, 'PATCH', `${NOTES}/n1`)[1]?.body).toEqual({
      tasks: [
        {
          id: null,
          subject: 'Call Jo back about the lease',
          due: '2026-11-24',
          due_words: 'next Tuesday',
          kind: 'call',
        },
      ],
    })
    expect(
      await within(card('Sample Logistics Pty Ltd')).findByRole('textbox', {
        name: 'Follow-up 1: what to do',
      }),
    ).toHaveValue('Call Jo back about the lease')
  })

  it('with the AI off, Edit starts the summary empty and keeps the rep’s words read-only', async () => {
    // The AI off: the server sends no summary, and the rep's words are the call's body. Putting
    // them in the summary box would send them twice, or past the summary's 600 be refused.
    const words = 'Spoke to the office manager about the lease. Call back in two weeks.'
    const notes = threeNotes().map((item) =>
      item.id === 'n2'
        ? { ...item, text: words, call: { summary: '', outcome: null, in_hubspot: false } }
        : item,
    )
    const server = mockServer({ notes })
    const { user } = renderCallLogs()
    await toConfirmList()
    const mining = card('Sample Mining Pty Ltd')
    await user.click(within(mining).getByRole('button', { name: /^Edit/ }))
    const summary = within(mining).getByRole('textbox', { name: 'Summary: Sample Mining Pty Ltd' })
    expect(summary).toHaveValue('')
    expect(summary).toHaveAttribute('maxlength', '600')
    expect(within(mining).getByText(words)).toBeInTheDocument()
    await user.type(summary, 'Lease talk; call back in two weeks.')
    await user.click(within(mining).getByRole('button', { name: 'Done' }))
    await waitFor(() => {
      expect(sent(server, 'PATCH', `${NOTES}/n2`)).toHaveLength(1)
    })
    expect(sent(server, 'PATCH', `${NOTES}/n2`)[0]?.body).toEqual({
      summary: 'Lease talk; call back in two weeks.',
    })
  })

  it('with the AI off, leaving the empty summary box sends nothing', async () => {
    const notes = threeNotes().map((item) =>
      item.id === 'n2'
        ? { ...item, text: 'No answer.', call: { summary: '', outcome: null, in_hubspot: false } }
        : item,
    )
    const server = mockServer({ notes })
    const { user } = renderCallLogs()
    await toConfirmList()
    const mining = card('Sample Mining Pty Ltd')
    await user.click(within(mining).getByRole('button', { name: /^Edit/ }))
    await user.click(within(mining).getByRole('button', { name: 'Done' }))
    expect(sent(server, 'PATCH', `${NOTES}/n2`)).toHaveLength(0)
  })

  it('an edit the server refuses goes back, and a toast says why', async () => {
    const server = mockServer({ notes: threeNotes(), patch: 'fail' })
    const { user } = renderCallLogs()
    await toConfirmList()
    const mining = card('Sample Mining Pty Ltd')
    await user.click(within(mining).getByRole('button', { name: /^Edit/ }))
    const summary = within(mining).getByRole('textbox', { name: 'Summary: Sample Mining Pty Ltd' })
    await user.clear(summary)
    await user.type(summary, 'Wrong words.')
    await user.click(within(mining).getByRole('button', { name: 'Done' }))

    expect(await screen.findByText("Your change wasn't saved")).toBeInTheDocument()
    expect(screen.getByText('The day has to be a weekday.')).toBeInTheDocument()
    await waitFor(() => {
      expect(
        within(card('Sample Mining Pty Ltd')).getByText('Left a message with reception.'),
      ).toBeInTheDocument()
    })
    expect(sent(server, 'PATCH', `${NOTES}/n2`)).toHaveLength(1)
  })

  it('Leave out keeps a card here, dimmed, and the count rolls; Put back brings it back', async () => {
    const server = mockServer({ notes: threeNotes() })
    const { user } = renderCallLogs()
    await toConfirmList()
    const send = screen.getByRole('button', { name: 'Send 3 to HubSpot' })
    expect(send).toBeEnabled()
    // The count shows once, on the button: no line beside it says it again.
    expect(screen.queryByText(/calls? to send\./)).toBeNull()
    expect(send).not.toHaveAttribute('aria-describedby')

    await user.click(
      within(card('Sample Mining Pty Ltd')).getByRole('button', { name: /^Leave out/ }),
    )
    expect(
      await within(card('Sample Mining Pty Ltd')).findByText('Left out of this batch.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send 2 to HubSpot' })).toBeInTheDocument()
    // The button says the count, so the line beside it says only the rest.
    expect(screen.getByText('1 left out.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send 2 to HubSpot' })).toHaveAccessibleDescription(
      '1 left out.',
    )
    await waitFor(() => {
      expect(sent(server, 'PATCH', `${NOTES}/n2`)[0]?.body).toEqual({ left_out: true })
    })

    // Dimmed with the quieter text colour, which reads at 4.5:1 or more, not with lower opacity.
    const mining = card('Sample Mining Pty Ltd')
    const title = within(mining).getByRole('heading', { name: 'Sample Mining Pty Ltd' })
    const dimmed = title.closest<HTMLElement>('.text-muted-foreground')
    expect(dimmed).not.toBeNull()
    expect(mining.contains(dimmed)).toBe(true)
    expect(dimmed?.contains(within(mining).getByText('Left a message with reception.'))).toBe(true)
    // No plain opacity class anywhere in it (a button's `disabled:opacity-50` is fine).
    const faded = [mining, ...mining.querySelectorAll('*')].some((node) =>
      [...node.classList].some((name) => name.startsWith('opacity-')),
    )
    expect(faded).toBe(false)
    // The status line and the buttons stay at full strength.
    const putBack = within(mining).getByRole('button', { name: /^Put back/ })
    expect(dimmed?.contains(putBack)).toBe(false)
    expect(dimmed?.contains(within(mining).getByText('Left out of this batch.'))).toBe(false)

    await user.click(putBack)
    expect(screen.getByRole('button', { name: 'Send 3 to HubSpot' })).toBeInTheDocument()
    expect(title.closest('.text-muted-foreground')).toBeNull()
    await waitFor(() => {
      expect(sent(server, 'PATCH', `${NOTES}/n2`)[1]?.body).toEqual({ left_out: false })
    })
  })

  it('J and K move between cards, E edits, X leaves out, and Ctrl+Enter opens the send dialog', async () => {
    const server = mockServer({ notes: threeNotes() })
    const { user } = renderCallLogs()
    const list = await toConfirmList()
    const [first, second] = within(list).getAllByRole('article')

    await user.keyboard('j')
    expect(first).toHaveAttribute('aria-current', 'true')
    expect(first).toHaveFocus()
    // The active card has the Navy edge and the tint of a selected row.
    expect(first).toHaveClass('bg-selected', 'shadow-[inset_3px_0_0_var(--primary)]')
    await user.keyboard('j')
    expect(second).toHaveAttribute('aria-current', 'true')
    expect(first).not.toHaveClass('bg-selected')
    await user.keyboard('k')
    expect(first).toHaveAttribute('aria-current', 'true')

    // E: the active card's first field takes the focus. Letters typed there are only text.
    await user.keyboard('e')
    const summary = within(first).getByRole('textbox', {
      name: 'Summary: Sample Logistics Pty Ltd',
    })
    expect(summary).toHaveFocus()
    // Its fields sit on the card colour, not the tint (a field's border is under 3:1 there). The
    // Navy edge still marks it.
    expect(first).not.toHaveClass('bg-selected')
    expect(first).toHaveClass('bg-card', 'shadow-[inset_3px_0_0_var(--primary)]')
    await user.keyboard('jx')
    expect(summary).toHaveValue('Jo says the Perth lease now ends in June 2028.jx')
    expect(first).toHaveAttribute('aria-current', 'true')
    expect(sent(server, 'PATCH', `${NOTES}/n1`)).toHaveLength(0)

    // Esc puts the field back and ends the editing; the card keeps the focus, and the tint.
    await user.keyboard('{Escape}')
    expect(within(first).queryByRole('textbox')).toBeNull()
    expect(first).toHaveFocus()
    expect(first).toHaveClass('bg-selected')
    expect(sent(server, 'PATCH', `${NOTES}/n1`)).toHaveLength(0)

    // X leaves it out.
    await user.keyboard('x')
    expect(await within(first).findByText('Left out of this batch.')).toBeInTheDocument()
    await waitFor(() => {
      expect(sent(server, 'PATCH', `${NOTES}/n1`)[0]?.body).toEqual({ left_out: true })
    })

    // Ctrl+Enter: the dialog, for the two calls still in.
    await user.keyboard('{Control>}{Enter}{/Control}')
    const dialog = await screen.findByRole('alertdialog', { name: 'Send 2 calls to HubSpot?' })
    expect(await within(dialog).findByText('2 calls, 0 tasks, 0 field changes')).toBeInTheDocument()
    expect(sent(server, 'POST', `${NOTES}/preview`).at(-1)?.body).toEqual({ ids: ['n2', 'n3'] })
  })

  it('a batch with one failure: the bar, a tick for each logged card, and the failed one moves', async () => {
    const server = mockServer({
      notes: threeNotes(),
      lands: {
        n2: {
          status: 'failed',
          hubspot_url: null,
          steps: [{ step: 'call', status: 'failed', words: "HubSpot didn't answer." }],
        },
      },
    })
    const { user } = renderCallLogs()
    const list = await toConfirmList()
    await user.click(screen.getByRole('button', { name: 'Send 3 to HubSpot' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Send 3 calls to HubSpot?' })
    expect(await within(dialog).findByText('3 calls, 1 task, 1 field change')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Send to HubSpot' }))

    await waitFor(() => {
      expect(sent(server, 'POST', `${NOTES}/confirm`)).toHaveLength(1)
    })
    expect(sent(server, 'POST', `${NOTES}/confirm`)[0]?.body).toEqual({ ids: ['n1', 'n2', 'n3'] })
    // Each lands: a tick beside "Logged", or "Needs a look" with what happened.
    expect(await within(list).findAllByText('Logged')).toHaveLength(2)
    expect(
      within(card('Sample Mining Pty Ltd')).getByText(/HubSpot didn't answer\./),
    ).toBeInTheDocument()
    expect(within(card('Sample Mining Pty Ltd')).getByText('Needs a look.')).toBeInTheDocument()
    expect(screen.getByText('Sending 3 of 3.')).toBeInTheDocument()

    // Then they leave, and a toast says what happened.
    expect(
      await screen.findByText('2 logged in HubSpot. 1 needs a look.', {}, { timeout: 5000 }),
    ).toBeInTheDocument()
    expect(await screen.findByText('Nothing to confirm.')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: /^Needs a look/ }))
    const look = await screen.findByRole('article', { name: 'Sample Mining Pty Ltd' })
    expect(within(look).getByText('Not in HubSpot. Nothing landed.')).toBeInTheDocument()
    expect(within(look).getByRole('button', { name: 'Try again' })).toBeEnabled()
  }, 15_000)

  it('Esc on the send dialog puts the focus back on Send, which opened it (the PLAN-V24 browser check)', async () => {
    mockServer({ notes: threeNotes() })
    const { user } = renderCallLogs()
    await toConfirmList()
    const send = screen.getByRole('button', { name: 'Send 3 to HubSpot' })
    await user.click(send)
    const dialog = await screen.findByRole('alertdialog')
    await within(dialog).findByText('3 calls, 1 task, 1 field change')
    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull()
    })
    await waitFor(() => {
      expect(send).toHaveFocus()
    })
  })

  it('Ctrl+Enter on a card, then Esc, puts the focus back on that card', async () => {
    mockServer({ notes: threeNotes() })
    const { user } = renderCallLogs()
    const list = await toConfirmList()
    const [, second] = within(list).getAllByRole('article')
    await user.keyboard('jj')
    expect(second).toHaveFocus()
    await user.keyboard('{Control>}{Enter}{/Control}')
    await screen.findByRole('alertdialog')
    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(second).toHaveFocus()
    })
  })

  it('after Send, while the calls go and Send is greyed, the focus goes to the first card, not the page', async () => {
    mockServer({ notes: threeNotes() })
    const { user } = renderCallLogs()
    const list = await toConfirmList()
    const [first] = within(list).getAllByRole('article')
    await user.click(screen.getByRole('button', { name: 'Send 3 to HubSpot' }))
    const dialog = await screen.findByRole('alertdialog')
    await within(dialog).findByText('3 calls, 1 task, 1 field change')
    await user.click(within(dialog).getByRole('button', { name: 'Send to HubSpot' }))
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull()
    })
    await waitFor(() => {
      expect(first).toHaveFocus()
    })
    expect(document.body).not.toHaveFocus()
  })

  it('a second batch while one is sending says so in words', async () => {
    mockServer({ notes: threeNotes(), alreadySending: true })
    const { user } = renderCallLogs()
    await toConfirmList()
    await user.click(screen.getByRole('button', { name: 'Send 3 to HubSpot' }))
    const dialog = await screen.findByRole('alertdialog')
    await within(dialog).findByText('3 calls, 1 task, 1 field change')
    await user.click(within(dialog).getByRole('button', { name: 'Send to HubSpot' }))
    expect(
      await screen.findByText(
        'A batch is already on its way to HubSpot. Wait for it to finish, then send the rest.',
      ),
    ).toBeInTheDocument()
  })

  it('waiting for write access: one quiet line, the button greyed with the reason, and edits still work', async () => {
    const server = mockServer({
      notes: threeNotes(),
      options: options({ sending_ready: false, waiting_for: 'Waiting for HubSpot write access.' }),
    })
    const { user } = renderCallLogs()
    await toConfirmList()
    expect(
      screen.getByText(
        'Waiting for HubSpot write access. You can still check and change your calls.',
      ),
    ).toBeInTheDocument()
    const button = screen.getByRole('button', { name: 'Send 3 to HubSpot' })
    expect(button).toBeDisabled()
    // The reason stands alone: on a phone the line above has scrolled away by then.
    expect(button).toHaveAccessibleDescription('Sending waits for HubSpot.')

    await user.click(
      within(card('Sample Freight Pty Ltd')).getByRole('button', { name: /^Leave out/ }),
    )
    await waitFor(() => {
      expect(sent(server, 'PATCH', `${NOTES}/n3`)[0]?.body).toEqual({ left_out: true })
    })
    // Ctrl+Enter does nothing while sending waits.
    await user.keyboard('{Control>}{Enter}{/Control}')
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(sent(server, 'POST', `${NOTES}/confirm`)).toHaveLength(0)
  })

  it('Remove takes a card away at once with Undo, and the server hears of it when the toast closes', async () => {
    const server = mockServer({ notes: threeNotes() })
    const { user } = renderCallLogs()
    const list = await toConfirmList()
    await user.click(within(card('Sample Mining Pty Ltd')).getByRole('button', { name: 'Remove' }))
    await waitFor(() => {
      expect(cardNames(list)).not.toContain('Sample Mining Pty Ltd')
    })
    expect(screen.getByRole('button', { name: 'Send 2 to HubSpot' })).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'Undo' }))
    expect(await screen.findByText('Undone. The call is back.')).toBeInTheDocument()
    expect(cardNames(list)).toContain('Sample Mining Pty Ltd')
    expect(sent(server, 'DELETE', `${NOTES}/n2`)).toHaveLength(0)

    await user.click(within(card('Sample Mining Pty Ltd')).getByRole('button', { name: 'Remove' }))
    expect(
      await screen.findByText('Removed the call with Sample Mining Pty Ltd.'),
    ).toBeInTheDocument()
    act(() => {
      toast.dismiss()
    })
    await waitFor(() => {
      expect(sent(server, 'DELETE', `${NOTES}/n2`)).toHaveLength(1)
    })
    await waitFor(() => {
      expect(cardNames(list)).not.toContain('Sample Mining Pty Ltd')
    })
  })

  // Real time, not a fake clock: a fake clock that stops at the end of a test leaves motion's
  // frame loop waiting for a frame that never comes, and every later test's cards stop leaving.
  it('a note still being sorted shows a still line, then its parts when they come', async () => {
    // This test waits longer than the quiet warm-up of the other tabs does (3 seconds without an
    // idle call), and counts the page's own reads, so the browser here is never idle.
    fakeIdle()
    const server = mockServer({
      notes: [
        note('n1', { status: 'sorting', call: { summary: '', outcome: null, in_hubspot: false } }),
      ],
    })
    renderCallLogs()
    const list = await toConfirmList()
    const sorting = card('Sample Logistics Pty Ltd')
    expect(within(sorting).getByText('Sorting the note.')).toBeInTheDocument()
    expect(screen.getByText('1 call still sorting.')).toBeInTheDocument()
    const readsWhileSorting = sent(server, 'GET', NOTES).length

    // The page asks again every 2 seconds while a note sorts.
    server.notes = [note('n1', { changes: [LEASE] })]
    expect(
      await within(list).findByText('Lease end · Perth', {}, { timeout: 4000 }),
    ).toBeInTheDocument()
    expect(within(card('Sample Logistics Pty Ltd')).queryByText('Sorting the note.')).toBeNull()
    expect(sent(server, 'GET', NOTES).length).toBe(readsWhileSorting + 1)

    // Then it stops asking.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2500))
    })
    expect(sent(server, 'GET', NOTES)).toHaveLength(readsWhileSorting + 1)
  }, 15_000)
})

describe('Needs a look', () => {
  function uncertain(id: string, company: string): CallNoteOut {
    return note(id, {
      company_name: company,
      status: 'uncertain',
      hubspot_url: HUBSPOT_URL,
      steps: [
        { step: 'call', status: 'done', words: 'Logged the call.' },
        {
          step: 'task:1',
          status: 'uncertain',
          words: "HubSpot didn't answer in time. The follow-up may be there.",
        },
      ],
    })
  }

  it('an uncertain note: "It\'s there" logs it, and "It\'s not there" offers Try again', async () => {
    const server = mockServer({
      notes: [
        uncertain('u1', 'Sample Logistics Pty Ltd'),
        uncertain('u2', 'Sample Mining Pty Ltd'),
      ],
      summary: { to_confirm: 0, needs_look: 2, logged_today: 0 },
    })
    const { user } = renderCallLogs('/assistant/call-logs?tab=needs-look')
    const first = await screen.findByRole('article', { name: 'Sample Logistics Pty Ltd' })
    expect(within(first).getByText('Not sure it reached HubSpot.')).toBeInTheDocument()
    expect(within(first).getByText('Check HubSpot, then tell us:')).toBeInTheDocument()
    expect(within(first).getByText(/The follow-up may be there\./)).toBeInTheDocument()
    expect(within(first).getByRole('link', { name: /^Open in HubSpot/ })).toHaveAttribute(
      'href',
      HUBSPOT_URL,
    )

    await user.click(within(first).getByRole('button', { name: "It's there" }))
    await waitFor(() => {
      expect(sent(server, 'POST', `${NOTES}/u1/resolve`)[0]?.body).toEqual({
        step: 'task:1',
        landed: true,
      })
    })
    expect(await within(first).findByText('Logged')).toBeInTheDocument()
    await waitFor(
      () => {
        expect(screen.queryByRole('article', { name: 'Sample Logistics Pty Ltd' })).toBeNull()
      },
      { timeout: 5000 },
    )

    const second = screen.getByRole('article', { name: 'Sample Mining Pty Ltd' })
    await user.click(within(second).getByRole('button', { name: "It's not there" }))
    await waitFor(() => {
      expect(sent(server, 'POST', `${NOTES}/u2/resolve`)[0]?.body).toEqual({
        step: 'task:1',
        landed: false,
      })
    })
    expect(await within(second).findByRole('button', { name: 'Try again' })).toBeEnabled()
    expect(within(second).getByText("You checked: it isn't there.")).toBeInTheDocument()
  }, 15_000)

  it('Try again sends a failed note again, and it leaves once logged', async () => {
    const server = mockServer({
      notes: [
        note('f1', {
          status: 'failed',
          steps: [{ step: 'call', status: 'failed', words: "HubSpot didn't answer." }],
        }),
      ],
    })
    const { user } = renderCallLogs('/assistant/call-logs?tab=needs-look')
    const failed = await screen.findByRole('article', { name: 'Sample Logistics Pty Ltd' })
    await user.click(within(failed).getByRole('button', { name: 'Try again' }))
    await waitFor(() => {
      expect(sent(server, 'POST', `${NOTES}/f1/retry`)).toHaveLength(1)
    })
    expect(await within(failed).findByText('Logged')).toBeInTheDocument()
    expect(
      await screen.findByText('Nothing needs a look.', {}, { timeout: 5000 }),
    ).toBeInTheDocument()
  }, 15_000)

  it('while HubSpot is not ready, Try again is greyed, with a reason that stands alone', async () => {
    mockServer({
      notes: [
        note('f1', {
          status: 'failed',
          steps: [{ step: 'call', status: 'failed', words: "HubSpot didn't answer." }],
        }),
      ],
      options: options({ sending_ready: false, waiting_for: 'Waiting for HubSpot write access.' }),
    })
    renderCallLogs('/assistant/call-logs?tab=needs-look')
    const failed = await screen.findByRole('article', { name: 'Sample Logistics Pty Ltd' })
    const tryAgain = within(failed).getByRole('button', { name: 'Try again' })
    expect(tryAgain).toBeDisabled()
    expect(tryAgain).toHaveAccessibleDescription('Sending waits for HubSpot.')
  })
})

describe('every state', () => {
  it.each([
    ['', 'Nothing to confirm.', 'Log a call and it waits here.'],
    [
      '?tab=history',
      'No calls logged yet.',
      'Press Log call after your next call, and it shows here.',
    ],
    [
      '?tab=needs-look',
      'Nothing needs a look.',
      "A call HubSpot didn't take shows here, with what to do.",
    ],
  ])('an empty tab speaks in the serif voice (%s)', async (search, title, description) => {
    mockServer()
    renderCallLogs(`/assistant/call-logs${search}`)
    const heading = await screen.findByRole('heading', { name: title })
    expect(heading).toHaveClass('font-serif')
    expect(screen.getByText(description)).toBeInTheDocument()
  })

  it('says call notes are off in plain words, with no Log call', async () => {
    mockServer({ options: options({ enabled: false }) })
    renderCallLogs()
    expect(await screen.findByText('Call notes are switched off.')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Ask an admin to switch them on. Until then, log your calls in HubSpot as before.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('tab')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Log call' })).toBeNull()
  })

  it('says so when the server switched call notes off meanwhile (409)', async () => {
    mockServer({ listsOff: true })
    renderCallLogs()
    expect(await screen.findByText('Call notes are switched off.')).toBeInTheDocument()
  })

  it('shows the error box when the switches cannot be read', async () => {
    mockServer({ options: null })
    renderCallLogs()
    expect(await screen.findByText("Your calls couldn't be loaded.")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('has its title, and the counts on the tabs', async () => {
    mockServer({ notes: threeNotes(), summary: { to_confirm: 3, needs_look: 1, logged_today: 2 } })
    renderCallLogs()
    expect(screen.getByRole('heading', { level: 1, name: 'Call logs' })).toBeInTheDocument()
    expect(await screen.findByRole('tab', { name: 'To confirm 3' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByRole('tab', { name: 'Needs a look 1' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'History' })).toBeInTheDocument()
  })
})

describe('Log call', () => {
  it('opens a panel straight on the company list, filters from 2 letters, supports arrow keys + Back keeping search, and saves a note', async () => {
    const server = mockServer({ options: options({ ai_enabled: true }) })
    const { user } = renderCallLogs()
    await screen.findByText('Nothing to confirm.')
    await user.click(screen.getByRole('button', { name: 'Log call' }))

    const panel = await screen.findByRole('dialog', { name: 'Log call' })
    const box = await within(panel).findByRole('combobox', {
      name: 'Which company was the call with?',
    })
    await waitFor(() => {
      expect(box).toHaveFocus()
    })
    // Lists newest companies right away with fewer than 2 letters.
    expect(
      await within(panel).findByRole('option', { name: /Sample Logistics Pty Ltd/ }),
    ).toBeInTheDocument()
    expect(within(panel).getByRole('option', { name: /Sample Freight Co/ })).toBeInTheDocument()

    // 2+ letters filter via /companies/search.
    await user.type(box, 'fre')
    await waitFor(() => {
      expect(within(panel).queryByRole('option', { name: /Sample Logistics Pty Ltd/ })).toBeNull()
    })
    const freightOption = await within(panel).findByRole('option', { name: /Sample Freight Co/ })
    expect(freightOption).toHaveAttribute('aria-selected', 'true')

    // Arrow key + Enter picks the company and pushes NoteView.
    await user.keyboard('{ArrowDown}{Enter}')

    const backButton = await within(panel).findByRole('button', { name: 'Back to companies' })
    const text = await within(panel).findByRole('textbox', { name: 'Call note' })
    await waitFor(() => {
      expect(text).toHaveFocus()
    })

    // Back returns to the company list, keeping the typed search and refocusing it.
    await user.click(backButton)
    const boxAgain = await within(panel).findByRole('combobox', {
      name: 'Which company was the call with?',
    })
    expect(boxAgain).toHaveValue('fre')
    await waitFor(() => {
      expect(boxAgain).toHaveFocus()
    })

    // Pick again via click and save.
    await user.click(await within(panel).findByRole('option', { name: /Sample Freight Co/ }))
    const noteAgain = await within(panel).findByRole('textbox', { name: 'Call note' })
    await user.type(noteAgain, 'Booked a visit for next week.')
    await user.click(within(panel).getByRole('button', { name: 'Save and next' }))
    await waitFor(() => {
      expect(sent(server, 'POST', NOTES)).toHaveLength(1)
    })
    expect(sent(server, 'POST', NOTES)[0]?.body).toMatchObject({
      company_key: '102',
      contact_id: null,
      prep_id: null,
      text: 'Booked a visit for next week.',
    })
    const list = await toConfirmList()
    expect(await within(list).findByText('Sample Logistics Pty Ltd')).toBeInTheDocument()
  })

  it('pages through 50 companies at a time, closes on Esc, and hides Log call for a Viewer', async () => {
    const many = Array.from({ length: 55 }, (_, i) => ({
      key: String(200 + i),
      name: `Company ${String(i + 1).padStart(2, '0')} Pty Ltd`,
      city: 'Perth',
      industry: 'Logistics',
      staff: 50,
    }))
    mockServer({ options: options({ ai_enabled: true }), companies: many })
    const { user } = renderCallLogs()
    await screen.findByText('Nothing to confirm.')
    await user.click(screen.getByRole('button', { name: 'Log call' }))
    const panel = await screen.findByRole('dialog', { name: 'Log call' })
    expect(
      await within(panel).findByRole('option', { name: /Company 01 Pty Ltd/ }),
    ).toBeInTheDocument()
    expect(within(panel).queryByRole('option', { name: /Company 55 Pty Ltd/ })).toBeNull()
    await user.click(within(panel).getByRole('button', { name: 'Show more' }))
    expect(
      await within(panel).findByRole('option', { name: /Company 55 Pty Ltd/ }),
    ).toBeInTheDocument()

    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Log call' })).toBeNull()
    })
  })

  it('hides Log call and ignores ?log=1 for a Viewer', async () => {
    mockServer({
      options: options({ ai_enabled: true }),
      user: { role: 'viewer', features: ['companies.call_logs'] },
    })
    renderCallLogs('/assistant/call-logs?log=1')
    await screen.findByText('Nothing to confirm.')
    expect(screen.queryByRole('button', { name: 'Log call' })).toBeNull()
    expect(screen.queryByRole('dialog', { name: 'Log call' })).toBeNull()
  })
})

describe('on a phone', () => {
  it('puts the Navy button at the bottom, full width, above the safe area', async () => {
    asPhone()
    mockServer({ notes: threeNotes() })
    renderCallLogs()
    await toConfirmList()
    const button = screen.getByRole('button', { name: 'Send 3 to HubSpot' })
    expect(button).toHaveClass('w-full')
    const bar = button.closest('[data-slot=send-bar]')
    expect(bar).toHaveClass('fixed', 'bottom-0', 'pb-[max(0.75rem,env(safe-area-inset-bottom))]')
    // Nothing to say beside the button: no empty line above it.
    expect(bar?.children).toHaveLength(1)
    // A card the keyboard lands on scrolls above the bar (WCAG 2.4.11).
    expect(document.documentElement.style.scrollPaddingBottom).toBe('7rem')
  })

  it('but on a laptop the bar sits at the top, so the page keeps no room at the bottom', async () => {
    mockServer({ notes: threeNotes() })
    renderCallLogs()
    await toConfirmList()
    expect(screen.getByRole('button', { name: 'Send 3 to HubSpot' })).toBeInTheDocument()
    expect(document.documentElement.style.scrollPaddingBottom).toBe('')
  })
})

describe('the batch while it lands', () => {
  it('keeps one object until something in it changes, so "To confirm" draws only for a change', async () => {
    mockServer({ notes: [note('n1', { status: 'sending' })] })
    const client = createTestQueryClient()
    function Wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={client}>{children}</QueryClientProvider>
    }
    const { result, rerender } = renderHook(() => useBatch(), { wrapper: Wrapper })

    // The page draws again (its counts moved): the same batch, so the list (a memo) skips it.
    const idle = result.current
    rerender()
    expect(result.current).toBe(idle)
    expect(ToConfirm).toHaveProperty('$$typeof', Symbol.for('react.memo'))

    act(() => {
      result.current.start(['n1'])
    })
    expect(result.current).not.toBe(idle)
    await waitFor(() => {
      expect(result.current.landing('n1')).toBe('logged')
    })
    const landed = result.current
    expect(landed.done).toBe(1)
    rerender()
    expect(result.current).toBe(landed)

    // The card leaves after its hold: that is a change, so a new batch.
    await waitFor(
      () => {
        expect(result.current.gone.has('n1')).toBe(true)
      },
      { timeout: 3000 },
    )
    expect(result.current).not.toBe(landed)
  })
})

describe('a call that needs its company, in a batch (PLAN-V24)', () => {
  it('counts as come back: the server never sends it', () => {
    expect(
      landingOf(
        note('x1', {
          company_key: null,
          company_name: null,
          company_heard: 'North Wind',
          status: 'needs_company',
        }),
      ),
    ).toBe('back')
  })
})

describe('the line beside Send', () => {
  it('says only what the button does not: the count is on the button', () => {
    expect(batchSentence(7, 0, 0)).toBe('')
    expect(batchSentence(7, 1, 0)).toBe('1 left out.')
    expect(batchSentence(7, 0, 2)).toBe('2 still sorting.')
    expect(batchSentence(7, 1, 2)).toBe('2 still sorting. 1 left out.')
    // None to send: the button has no count, so the line says what is waiting.
    expect(batchSentence(0, 1, 1)).toBe('1 call still sorting. 1 left out.')
  })
})

describe('what Call logs asks for first (PLAN-V7 C1)', () => {
  it('starts the switches, the counts and To confirm while its code downloads, and uses them', async () => {
    // The switches answer at once, and the counts once the page is up (the page shows its tabs
    // only once it knows call notes are on, and whether calls need a company, PLAN-V24); the rest
    // stays on its way, so a second request for any of it would show.
    const calls = new Map<string, number>()
    let answerCounts: () => void = () => undefined
    const counts = new Promise<void>((resolve) => {
      answerCounts = resolve
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        const url = new URL(request.url)
        const key = `${url.pathname}${url.search}`
        calls.set(key, (calls.get(key) ?? 0) + 1)
        if (url.pathname === `${NOTES}/options`) return json(options())
        if (url.pathname === `${NOTES}/summary`) {
          await counts
          return json({ to_confirm: 0, needs_look: 0, logged_today: 0, needs_company: 0 })
        }
        return new Promise<Response>(() => undefined)
      }),
    )
    const client = createTestQueryClient()
    client.setQueryData(queryKeys.auth.me(), { state: 'off' })
    prefetchPage(routes, { pathname: '/assistant/call-logs', search: '' }, client)
    // The prefetch loads its own small file first.
    await waitFor(() => {
      expect(calls.size).toBe(3)
    })
    expect([...calls.keys()].sort()).toEqual([
      `${NOTES}/options`,
      `${NOTES}/summary`,
      `${NOTES}?state=to_confirm&mine=true&limit=100&offset=0`,
    ])
    renderWithProviders(<CallLogsPage />, { route: '/assistant/call-logs', queryClient: client })
    answerCounts()
    expect(await screen.findByRole('tab', { name: 'To confirm' })).toBeInTheDocument()
    await waitFor(() => {
      expect(
        client
          .getQueryCache()
          .find({
            queryKey: queryKeys.companies.callNoteList({
              state: 'to_confirm',
              mine: true,
              limit: 100,
              offset: 0,
            }),
          })
          ?.getObserversCount(),
      ).toBeGreaterThan(0)
    })
    // Each was asked for once: the page joined what was started for it...
    for (const [key, count] of calls) expect(count, key).toBe(1)
    // ...and uses all of it.
    for (const query of client.getQueryCache().getAll()) {
      expect(query.getObserversCount(), JSON.stringify(query.queryKey)).toBeGreaterThan(0)
    }
  })
})

describe('warming the other tabs (Improvements 1, #10)', () => {
  /** The states of the lists asked for, in order. */
  const asked = (server: Server): string[] =>
    sent(server, 'GET', NOTES).map((item) => item.search.get('state') ?? '')

  /** A cache that keeps an answer fresh for 15 seconds, as the app's does. */
  function appCache(): QueryClient {
    return new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: 15_000 } },
    })
  }

  /** The page is up, its own tab is in, and the browser has an idle moment. */
  async function afterIdle(browser: ReturnType<typeof fakeIdle>): Promise<void> {
    await toConfirmList()
    await waitFor(() => {
      expect(browser.waiting()).toBeGreaterThan(0)
    })
    browser.idle()
  }

  it('asks for the other two tabs only once this one is in and the browser is idle', async () => {
    const browser = fakeIdle()
    const server = mockServer({ notes: threeNotes() })
    renderCallLogs()
    await toConfirmList()
    // While the browser is busy, only the tab on screen is asked for.
    expect(asked(server)).toEqual(['to_confirm'])

    await afterIdle(browser)
    await waitFor(() => {
      expect([...asked(server)].sort()).toEqual(['history', 'needs_look', 'to_confirm'])
    })
  })

  it('opens a warmed tab at once, with no grey blocks, and asks the server nothing more', async () => {
    const browser = fakeIdle()
    const server = mockServer({ notes: threeNotes() })
    const queryClient = appCache()
    const { user } = renderWithProviders(<CallLogsPage />, {
      route: '/assistant/call-logs',
      queryClient,
    })
    await afterIdle(browser)
    await waitFor(() => {
      expect(asked(server)).toHaveLength(3)
      expect(queryClient.isFetching()).toBe(0)
    })

    await user.click(screen.getByRole('tab', { name: /^History/ }))
    // The rows are there as the click ends: they were in the cache already.
    expect(screen.getAllByText('Sample Logistics Pty Ltd').length).toBeGreaterThan(0)
    expect(document.querySelector('[data-slot=pending]')).toBeNull()
    await user.click(screen.getByRole('tab', { name: /^Needs a look/ }))
    await user.click(screen.getByRole('tab', { name: /^To confirm/ }))
    expect(asked(server)).toHaveLength(3)
  })

  it("asks for History as the address has it when it is the tab on screen, once, and for the others' first lists", async () => {
    const browser = fakeIdle()
    const server = mockServer({ notes: threeNotes() })
    renderCallLogs('/assistant/call-logs?tab=history&q=sample')
    await screen.findByRole('tab', { name: /^History/ })
    await waitFor(() => {
      expect(browser.waiting()).toBeGreaterThan(0)
    })
    browser.idle()
    await waitFor(() => {
      expect([...asked(server)].sort()).toEqual(['history', 'needs_look', 'to_confirm'])
    })
    const history = sent(server, 'GET', NOTES).filter(
      (item) => item.search.get('state') === 'history',
    )
    expect(history).toHaveLength(1)
    expect(history[0]?.search.get('q')).toBe('sample')
  })

  it('asks for nothing while call notes are off', async () => {
    const browser = fakeIdle()
    const server = mockServer({ options: options({ enabled: false }) })
    renderCallLogs()
    await screen.findByText(/off/i)
    expect(browser.waiting()).toBe(0)
    expect(asked(server)).toEqual([])
  })

  it('is stopped by leaving the page', async () => {
    const browser = fakeIdle()
    const server = mockServer({ notes: threeNotes() })
    const { unmount } = renderCallLogs()
    await toConfirmList()
    await waitFor(() => {
      expect(browser.waiting()).toBeGreaterThan(0)
    })
    unmount()
    browser.idle()
    expect(asked(server)).toEqual(['to_confirm'])
  })
})

describe("a logged meeting's notes (T3-11)", () => {
  /** A past meeting's transcript, logged with "Log meeting": it goes to HubSpot as a note. */
  function meetingNotes(id: string, changes: Partial<CallNoteOut> = {}): CallNoteOut {
    return note(id, {
      person: null,
      source: 'transcript',
      text: 'Jo Sample: Thanks for coming in.\nSam Sample: Our Perth lease ends in June.',
      called_at: '2026-11-12T23:00:00Z',
      call: {
        summary: 'They walked us through the Perth office.',
        outcome: null,
        in_hubspot: false,
      },
      ...changes,
    })
  }

  it('reads as meeting notes, with no call outcome to show or to pick', async () => {
    mockServer({ notes: [meetingNotes('m1')] })
    const { user } = renderCallLogs()
    await toConfirmList()
    const card = screen.getByRole('article', { name: 'Sample Logistics Pty Ltd' })
    expect(within(card).getByText('Meeting notes · 13 Nov 2026, 10:00 am')).toBeInTheDocument()
    expect(within(card).queryByText(/No outcome/)).toBeNull()
    // A short summary has nothing more to show.
    expect(within(card).queryByRole('button', { name: 'Show all' })).toBeNull()
    await user.click(within(card).getByRole('button', { name: /^Edit/ }))
    expect(within(card).queryByRole('heading', { name: 'Outcome' })).toBeNull()
    expect(within(card).queryByRole('checkbox', { name: 'Connected' })).toBeNull()
  })

  it('a meeting has no call type; a call’s changes in Edit, and goes as a PATCH (PLAN-V25 T3-1)', async () => {
    mockServer({ notes: [meetingNotes('m1')] })
    const first = renderCallLogs()
    await toConfirmList()
    const meeting = screen.getByRole('article', { name: 'Sample Logistics Pty Ltd' })
    await first.user.click(within(meeting).getByRole('button', { name: /^Edit/ }))
    expect(within(meeting).queryByRole('radiogroup', { name: 'Call type' })).toBeNull()
    first.unmount()

    const server = mockServer({ notes: threeNotes() })
    const { user } = renderCallLogs()
    await toConfirmList()
    const logistics = card('Sample Logistics Pty Ltd')
    await user.click(within(logistics).getByRole('button', { name: /^Edit/ }))
    const types = within(logistics).getByRole('radiogroup', { name: 'Call type' })
    // Left out by the server: Prospecting Call, the default.
    expect(within(types).getByRole('radio', { name: 'Prospecting' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await user.click(within(types).getByRole('radio', { name: 'Agent or networking' }))
    await waitFor(() => {
      expect(sent(server, 'PATCH', `${NOTES}/n1`)).toHaveLength(1)
    })
    expect(sent(server, 'PATCH', `${NOTES}/n1`)[0]?.body).toEqual({
      call_type: 'Agent/Networking Phone Call',
    })
  })

  it('folds a long transcript on its card, with Show all and Show less, and leaves the note as it is', async () => {
    // The AI is off: no summary, so the card's text is the whole transcript.
    const words = Array.from(
      { length: 60 },
      (_, index) => `Jo Sample: Line ${String(index + 1)} of what was said.`,
    ).join('\n')
    const server = mockServer({
      notes: [
        meetingNotes('m1', {
          text: words,
          sorted_by: 'person',
          call: { summary: '', outcome: null, in_hubspot: false },
        }),
      ],
    })
    const { user } = renderCallLogs()
    await toConfirmList()
    const card = screen.getByRole('article', { name: 'Sample Logistics Pty Ltd' })
    const showAll = within(card).getByRole('button', { name: 'Show all' })
    expect(showAll).toHaveAttribute('aria-expanded', 'false')
    // Folded to two lines, the card holds only the start of it.
    const text = document.getElementById(showAll.getAttribute('aria-controls') ?? '')
    expect(text).toHaveClass('line-clamp-2')
    expect(text?.textContent).toMatch(/^Jo Sample: Line 1 of what was said\./)
    expect(text?.textContent?.length).toBeLessThanOrEqual(401)

    await user.click(showAll)
    const showLess = within(card).getByRole('button', { name: 'Show less' })
    expect(showLess).toHaveAttribute('aria-expanded', 'true')
    expect(text?.textContent).toBe(words)
    expect(text).not.toHaveClass('line-clamp-2')

    await user.click(showLess)
    expect(within(card).getByRole('button', { name: 'Show all' })).toBeInTheDocument()
    expect(text).toHaveClass('line-clamp-2')
    // Only the card changed: the note wasn't touched.
    expect(server.sent.filter((one) => one.method === 'PATCH')).toEqual([])
  })

  it('names the meeting notes in History and in Needs a look', async () => {
    mockServer({
      notes: [
        meetingNotes('m1', {
          status: 'logged',
          hubspot_url: HUBSPOT_URL,
          confirmed_at: '2026-11-15T04:00:00Z',
        }),
        meetingNotes('m2', {
          company_name: 'Sample Mining Pty Ltd',
          status: 'failed',
          steps: [{ step: 'note', status: 'failed', words: "HubSpot didn't answer." }],
        }),
      ],
    })
    const { user } = renderCallLogs('/assistant/call-logs?tab=history')
    const list = await screen.findByRole('group', { name: 'Your calls, newest first' })
    const row = within(list).getByRole('button', { name: /Sample Logistics Pty Ltd/ })
    // Meeting notes say so where a call says how it went.
    expect(row).toHaveTextContent('Meeting notes')
    await user.click(row)
    expect(within(list).getByRole('link', { name: /^Open in HubSpot/ })).toHaveAccessibleName(
      'Open in HubSpot: the meeting notes for Sample Logistics Pty Ltd (opens in a new tab)',
    )

    await user.click(screen.getByRole('tab', { name: /^Needs a look/ }))
    const look = await screen.findByRole('article', { name: 'Sample Mining Pty Ltd' })
    expect(
      within(within(look).getByRole('list', { name: 'What happened' })).getByText(
        'The meeting notes:',
      ),
    ).toBeInTheDocument()
  })

  it.each([
    ['totals with meeting notes apart', false],
    ['an older server, whose totals count them as calls', true],
  ])(
    'the send names the meeting notes apart, and counts only what will go (%s)',
    async (_name, oldTotals) => {
      mockServer({
        notes: [...threeNotes(), meetingNotes('m1', { called_at: '2026-11-10T04:00:00Z' })],
        skip: { n2: OFF_THE_LIST },
        oldTotals,
      })
      const { user } = renderCallLogs()
      await toConfirmList()
      await user.click(screen.getByRole('button', { name: 'Send 4 to HubSpot' }))
      // The cards say 3 calls and 1 meeting note; the server leaves one call out.
      const dialog = await screen.findByRole('alertdialog', {
        name: 'Send 2 calls and 1 meeting note to HubSpot?',
      })
      expect(
        await within(dialog).findByText('2 calls, 1 meeting note, 1 task, 1 field change'),
      ).toBeInTheDocument()
      expect(within(dialog).getByText("1 call won't be sent:")).toBeInTheDocument()
    },
  )
})

describe('a call the server leaves out of a send (T3-11)', () => {
  it('names it with why before the send, and after it the card stays with why', async () => {
    const server = mockServer({ notes: threeNotes(), skip: { n2: OFF_THE_LIST } })
    const { user } = renderCallLogs()
    const list = await toConfirmList()
    await user.click(screen.getByRole('button', { name: 'Send 3 to HubSpot' }))
    // The title counts only what will go, and the totals are the server's, without it.
    const dialog = await screen.findByRole('alertdialog', { name: 'Send 2 calls to HubSpot?' })
    expect(await within(dialog).findByText('2 calls, 1 task, 1 field change')).toBeInTheDocument()
    const skipped = within(dialog)
      .getByText("1 call won't be sent:")
      .closest('[data-slot=send-skipped]')
    if (!(skipped instanceof HTMLElement)) throw new Error('No skipped calls')
    expect(within(skipped).getByRole('listitem')).toHaveTextContent(
      `Sample Mining Pty Ltd: ${OFF_THE_LIST}`,
    )
    await user.click(within(dialog).getByRole('button', { name: 'Send to HubSpot' }))

    // The other two go and leave; the one left out stays, and says why at its top.
    expect(
      await screen.findByText('2 logged in HubSpot.', {}, { timeout: 5000 }),
    ).toBeInTheDocument()
    const mining = within(list).getByRole('article', { name: 'Sample Mining Pty Ltd' })
    expect(mining.querySelector('[data-slot=left-behind]')).toHaveTextContent(
      `Not sent. ${OFF_THE_LIST}`,
    )
    expect(within(mining).queryByText('Sending to HubSpot.')).toBeNull()
    // The landed cards fade out (150ms), then only the one left out is there.
    await waitFor(() => {
      expect(cardNames(list)).toEqual(['Sample Mining Pty Ltd'])
    })
    expect(sent(server, 'POST', `${NOTES}/confirm`)[0]?.body).toEqual({ ids: ['n1', 'n2', 'n3'] })

    // Changed since: the why may no longer hold, so it goes.
    await user.click(within(mining).getByRole('button', { name: /^Edit/ }))
    const summary = within(mining).getByRole('textbox', { name: 'Summary: Sample Mining Pty Ltd' })
    await user.type(summary, ' Asked for the lease.')
    await user.tab()
    await waitFor(() => {
      expect(mining.querySelector('[data-slot=left-behind]')).toBeNull()
    })
  }, 15_000)

  it('with every call left out, Send is greyed with why', async () => {
    mockServer({ notes: [note('n1')], skip: { n1: OFF_THE_LIST } })
    const { user } = renderCallLogs()
    await toConfirmList()
    await user.click(screen.getByRole('button', { name: 'Send 1 to HubSpot' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(await within(dialog).findByText("1 call won't be sent:")).toBeInTheDocument()
    // Nothing will go: the title counts nothing, and there are no totals of nothing.
    expect(dialog).toHaveAccessibleName('Send to HubSpot?')
    expect(dialog.querySelector('[data-slot=send-totals]')).toBeNull()
    const send = within(dialog).getByRole('button', { name: 'Send to HubSpot' })
    expect(send).toBeDisabled()
    expect(send).toHaveAccessibleDescription('None of these can be sent now.')
  })

  it("Try again on such a note says why in the server's own words", async () => {
    mockServer({
      notes: [
        note('f1', {
          status: 'failed',
          steps: [{ step: 'call', status: 'failed', words: OFF_THE_LIST }],
        }),
      ],
      retryRefused: true,
    })
    const { user } = renderCallLogs('/assistant/call-logs?tab=needs-look')
    const card = await screen.findByRole('article', { name: 'Sample Logistics Pty Ltd' })
    await user.click(within(card).getByRole('button', { name: 'Try again' }))
    const shown = (await screen.findByText("That didn't go through")).closest('[data-sonner-toast]')
    if (!(shown instanceof HTMLElement)) throw new Error('No toast')
    // The toast's own line is the server's words, as they came.
    expect(within(shown).getByText(OFF_THE_LIST)).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Try again' })).toBeEnabled()
  })
})
