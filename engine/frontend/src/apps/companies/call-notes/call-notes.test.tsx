import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { toast } from 'sonner'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SignedInUser, SignIn } from '@/api/hooks'
import { queryKeys } from '@/api/query'
import type {
  CompanyDetail,
  CompanyRow,
  PrepFacts,
  PrepOut,
  CallNoteIn,
  CallNoteOptions,
  CallNoteOut,
  CallNoteSummary,
} from '@/api/types'
import { readDueDate } from '@/lib/due-date'
import { melbourneDate } from '@/lib/format'
import { SAMPLE_USER } from '@/test/fake-auth'
import { createTestQueryClient, renderWithProviders, startManualClock } from '@/test/render'
import { asPhone } from '@/test/screen'
import CompaniesPage from '../index'
import { FakeMic } from './mic/fake-mic'
import { NoteTimer } from './note-timer'
import { dueWords } from './words'

/*
  Log call in the call prep panel (PLAN-V17 T3-5), on the Companies page, against the generated
  contract. Made-up names only: Sample Logistics Pty Ltd, Jo Sample.
*/

const API = '/api/v1/companies'
const NOTES = `${API}/call-notes`
const PREP_ID = 'aaaaaaaa-1111-2222-3333-444444444444'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const DRAFTS = 'companies.call-note-drafts'

function row(changes: Partial<CompanyRow> = {}): CompanyRow {
  return {
    key: '101',
    name: 'Sample Logistics Pty Ltd',
    domain: 'samplelogistics.com.au',
    city: 'Perth',
    industry: 'Logistics and Supply Chain',
    staff: 300,
    owner: 'Levi',
    last_talk: '2026-10-01',
    next_lease_end: '2027-06-30',
    deal: 'open',
    source: 'hubspot',
    lead_result: null,
    lead_score: null,
    ...changes,
  }
}

const ROWS = [
  row(),
  row({ key: '103', name: 'Sample Mining Pty Ltd', city: 'Brisbane', deal: 'none' }),
]

const JO = {
  id: '201',
  name: 'Jo Sample',
  title: 'Office Manager',
  phone: null,
  last_activity: null,
}

function detail(changes: Partial<CompanyDetail> = {}): CompanyDetail {
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
    people: [JO],
    calls: [],
    people_status: 'ready',
    lead: null,
    ...changes,
  }
}

function facts(): PrepFacts {
  return {
    company_key: '101',
    company_name: 'Sample Logistics Pty Ltd',
    city: 'Perth',
    industry: 'Logistics and Supply Chain',
    staff: 300,
    owner: 'Levi',
    deal: 'open',
    next_lease_end: '2027-06-30',
    last_talk: '2026-10-01',
    hubspot_url: null,
    person: { id: '201', name: 'Jo Sample', title: 'Office Manager' },
    phone: '+61 8 9000 0000',
    last_call: null,
    facts: [],
    people: [
      { id: '201', name: 'Jo Sample', title: 'Office Manager', phone: null, last_activity: null },
    ],
    people_status: 'ready',
    prep_enabled: true,
    names_ok: true,
    prep_cap_usd: '0.25',
  }
}

function prep(script: Partial<PrepOut['script']> = {}): PrepOut {
  return {
    id: PREP_ID,
    company_key: '101',
    company_name: 'Sample Logistics Pty Ltd',
    person: { id: '201', name: 'Jo Sample', title: 'Office Manager' },
    kind: 'person',
    trigger: 'person',
    status: 'ready',
    stage: 3,
    error: null,
    script: {
      still_there: 'yes',
      still_there_note: null,
      news: [],
      opener: [{ text: 'Hi Jo, we spoke on 1 Oct about Perth.', sources: ['F1'] }],
      why_now: [],
      questions: [],
      if_they_say: [],
      goal: null,
      dropped: 0,
      ...script,
    },
    sources: [{ id: 'F1', kind: 'hubspot', label: 'HubSpot: Perth office', url: null, date: null }],
    web_checked: true,
    reused: false,
    made_by: 'Mia',
    created_at: '2026-11-09T19:30:00Z',
    finished_at: '2026-11-09T19:30:09Z',
  }
}

function options(changes: Partial<CallNoteOptions> = {}): CallNoteOptions {
  return {
    enabled: true,
    ai_enabled: false,
    sending_ready: false,
    waiting_for: 'Waiting for HubSpot write access.',
    outcomes: [
      'Busy',
      'Connected',
      'Left live message',
      'Left voicemail',
      'No answer',
      'Wrong number',
    ],
    fields: [{ id: 'lease_end', label: 'Lease end', kind: 'date' }],
    soft_seconds: 180,
    max_chars: 6000,
    ...changes,
  }
}

function noteOut(body: CallNoteIn, id: string): CallNoteOut {
  return {
    id,
    company_key: body.company_key,
    company_name: 'Sample Logistics Pty Ltd',
    person: body.contact_id ? { id: body.contact_id, name: 'Jo Sample', title: null } : null,
    text: body.text,
    source: body.source,
    called_at: body.called_at,
    status: 'to_confirm',
    sorted_by: 'person',
    unsure: null,
    call: { summary: body.text, outcome: body.outcome ?? null, in_hubspot: false },
    changes: [],
    tasks: [],
    left_out: false,
    steps: [],
    hubspot_url: null,
    made_by: 'Mia',
    created_at: '2026-11-15T01:00:00Z',
    confirmed_at: null,
  }
}

interface Sent {
  method: string
  path: string
  key: string | null
  body: unknown
}

interface Backend {
  /** null: the route isn't there (404), as before Track 2's routes are merged. */
  options: CallNoteOptions | null
  summary: CallNoteSummary | null
  /** The call prep the panel opens. */
  prep: PrepOut
  /** What POST /call-notes does: answer, refuse, or wait until `release()`. */
  save: 'ok' | 'fail' | 'wait'
  release: () => void
  sent: Sent[]
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status })
}

function problem(status: number, title: string, detail: string): Response {
  return json({ title, detail, status, code: 'test_problem' }, status)
}

function mockBackend(changes: Partial<Omit<Backend, 'sent' | 'release'>> = {}): Backend {
  const backend: Backend = {
    options: options(),
    summary: { to_confirm: 6, needs_look: 0, logged_today: 2 },
    prep: prep(),
    save: 'ok',
    release: () => undefined,
    sent: [],
    ...changes,
  }
  let made = 0
  const respond = async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    const path = url.pathname
    const method = request.method
    const text = method === 'GET' ? '' : await request.clone().text()
    const body: unknown = text ? JSON.parse(text) : null
    if (path.startsWith(NOTES)) {
      backend.sent.push({ method, path, key: request.headers.get('idempotency-key'), body })
    }
    if (path === `${NOTES}/options`) {
      return backend.options ? json(backend.options) : problem(404, 'Not found', 'Not here.')
    }
    if (path === `${NOTES}/summary`) {
      return backend.summary ? json(backend.summary) : problem(404, 'Not found', 'Not here.')
    }
    if (path === NOTES && method === 'POST') {
      if (backend.save === 'fail') {
        return problem(500, 'Something went wrong', 'Try again in a minute.')
      }
      if (backend.save === 'wait') {
        await new Promise<void>((resolve) => {
          backend.release = resolve
        })
      }
      made += 1
      return json(noteOut(body as CallNoteIn, `note-${String(made)}`), 201)
    }
    if (path.startsWith(`${NOTES}/note-`) && method === 'DELETE') {
      return new Response(null, { status: 204 })
    }
    if (path.startsWith(`${NOTES}/note-`) && method === 'PATCH') {
      return json(
        noteOut({ ...(body as object), text: '' } as CallNoteIn, path.split('/').at(-1) ?? ''),
      )
    }
    if (path === '/api/v1/hubspot/syncs') return json([])
    if (path === API) return json({ total: ROWS.length, items: ROWS, leads_shown: false })
    if (path === `${API}/facets`) return json({ cities: [], owners: [], leads_shown: false })
    if (path === `${API}/preps/today`) return json([])
    if (path === `${API}/preps` && method === 'POST') return json(backend.prep, 202)
    if (path === `${API}/preps/${PREP_ID}`) return json(backend.prep)
    if (path === `${API}/101/facts`) return json(facts())
    if (path === `${API}/101`) return json(detail())
    if (path === `${API}/103`) {
      return json(detail({ key: '103', name: 'Sample Mining Pty Ltd', people: [] }))
    }
    return problem(404, 'Not found', 'Not here.')
  }
  vi.stubGlobal(
    'fetch',
    vi.fn((request: Request) => respond(request)),
  )
  return backend
}

function posts(backend: Backend): Sent[] {
  return backend.sent.filter((sent) => sent.method === 'POST' && sent.path === NOTES)
}

function renderCompanies() {
  return renderWithProviders(<CompaniesPage />, { route: '/companies' })
}

/** Two reps on one shared browser (made-up people), for the drafts that are each rep's own. */
const MIA: SignedInUser = {
  ...SAMPLE_USER,
  id: 'aaaaaaaa-0000-0000-0000-00000000000a',
  name: 'Mia Sample',
  role: 'staff',
  apps: ['companies'],
}
const SAM: SignedInUser = { ...MIA, id: 'bbbbbbbb-0000-0000-0000-00000000000b', name: 'Sam Sample' }

/** "Who is signed in", as the sign-in guard has it before any page draws. */
function signedInAs(user: SignedInUser): SignIn {
  return { state: 'signed_in', user }
}

/** The Companies page with `user` signed in. */
function renderCompaniesAs(user: SignedInUser) {
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(queryKeys.auth.me(), signedInAs(user))
  return renderWithProviders(<CompaniesPage />, { route: '/companies', queryClient })
}

/** The page is up, and it knows call notes are on (or off). */
async function ready(view: ReturnType<typeof renderCompanies>): Promise<void> {
  await screen.findByRole('button', { name: 'Prep a call to Sample Logistics Pty Ltd' })
  await waitFor(() => {
    expect(view.queryClient.getQueryState(queryKeys.companies.callNoteOptions())?.status).not.toBe(
      'pending',
    )
  })
}

function count(view: ReturnType<typeof renderCompanies>): number | undefined {
  return view.queryClient.getQueryData<CallNoteSummary>(queryKeys.companies.callNoteSummary())
    ?.to_confirm
}

/**
 * The note view in the panel. The script stays in the panel under it (`PushView`, inert), so a
 * test reads the note view, not the whole panel.
 */
function noteViewIn(panel: HTMLElement): HTMLElement {
  const note = panel.querySelector<HTMLElement>('[data-slot=note-view]')
  if (!note) throw new Error('no note view')
  return note
}

/** L on the first row: the panel opens on the note view. */
async function logFirstRow(view: ReturnType<typeof renderCompanies>): Promise<HTMLElement> {
  await ready(view)
  await view.user.keyboard('j')
  fireEvent.keyDown(document.body, { key: 'l' })
  const panel = await screen.findByRole('dialog', { name: 'Log call' })
  await waitFor(() => {
    expect(within(panel).getByRole('textbox', { name: 'Call note' })).toHaveFocus()
  })
  return noteViewIn(panel)
}

/** Prep on the row (it calls Jo Sample), then the panel's own Log call. */
async function logFromScript(view: ReturnType<typeof renderCompanies>): Promise<HTMLElement> {
  await ready(view)
  await view.user.click(
    screen.getByRole('button', { name: 'Prep a call to Sample Logistics Pty Ltd' }),
  )
  // It opens on the quick look, calling Jo Sample, the first person on record (PLAN-V18 T3-7).
  const script = await screen.findByRole('dialog', { name: 'Jo Sample' })
  await view.user.click(await within(script).findByRole('button', { name: 'Log call' }))
  const panel = await screen.findByRole('dialog', { name: 'Log call' })
  await waitFor(() => {
    expect(within(panel).getByRole('textbox', { name: 'Call note' })).toHaveFocus()
  })
  return noteViewIn(panel)
}

function storedDrafts(): Record<string, { key: string; text: string }> {
  return JSON.parse(window.localStorage.getItem(DRAFTS) ?? '{}') as Record<
    string,
    { key: string; text: string }
  >
}

afterEach(() => {
  window.localStorage.clear()
  // Sonner keeps toasts in one store for the whole file, and shows a new page the ones still up.
  toast.dismiss()
})

describe('L and the Log call button', () => {
  it('L on the active row opens the note view, Esc goes back, and L in the panel opens it again', async () => {
    mockBackend()
    const view = renderCompanies()
    const panel = await logFirstRow(view)
    // No one prepped: the company, and "Who was the call with?" with the switchboard picked.
    expect(within(panel).getByText('Sample Logistics Pty Ltd')).toBeInTheDocument()
    const who = await within(panel).findByRole('radiogroup', { name: 'Who was the call with?' })
    expect(within(who).getByRole('radio', { name: 'No one in particular' })).toBeChecked()
    expect(within(who).getByRole('radio', { name: 'Jo Sample' })).not.toBeChecked()
    // Esc goes back to the script; it doesn't close the panel. The script calls Jo Sample, the
    // first person on record (PLAN-V18 T3-7), so the focus lands on Log call.
    await view.user.keyboard('{Escape}')
    const script = await screen.findByRole('dialog', { name: 'Jo Sample' })
    await waitFor(() => {
      expect(within(script).getByRole('button', { name: 'Log call' })).toHaveFocus()
    })
    await view.user.keyboard('l')
    expect(await screen.findByRole('dialog', { name: 'Log call' })).toBeInTheDocument()
  })

  it('"Log call" sits beside "Copy script", and Back puts the focus on it', async () => {
    mockBackend()
    const view = renderCompanies()
    const panel = await logFromScript(view)
    // The person is known from the panel: no question.
    expect(
      within(panel).getByText('Jo Sample, Office Manager · Sample Logistics Pty Ltd'),
    ).toBeInTheDocument()
    expect(within(panel).queryByRole('radiogroup', { name: 'Who was the call with?' })).toBeNull()
    await view.user.click(within(panel).getByRole('button', { name: 'Back to the script' }))
    const script = await screen.findByRole('dialog', { name: 'Jo Sample' })
    const logCall = within(script).getByRole('button', { name: 'Log call' })
    await waitFor(() => {
      expect(logCall).toHaveFocus()
    })
    expect(logCall).toHaveAttribute('aria-keyshortcuts', 'L')
  })

  it('Back finds the script as it was: a question ticked before L is still ticked', async () => {
    mockBackend({
      prep: prep({
        questions: [
          { text: 'When does the Perth lease end?', sources: ['F1'], follow_ups: [] },
          { text: 'Who else decides on the office?', sources: ['F1'], follow_ups: [] },
        ],
      }),
    })
    const view = renderCompanies()
    await ready(view)
    await view.user.click(
      screen.getByRole('button', { name: 'Prep a call to Sample Logistics Pty Ltd' }),
    )
    // It opens on the quick look, calling Jo Sample, the first person on record (PLAN-V18 T3-7).
    const script = await screen.findByRole('dialog', { name: 'Jo Sample' })
    const asked = await within(script).findByRole('checkbox', {
      name: 'Asked: When does the Perth lease end?',
    })
    await view.user.click(asked)
    expect(within(script).getByText('1 of 2 asked.')).toBeInTheDocument()

    // L: the note view comes over the script, which stays where it was, inert.
    await view.user.keyboard('l')
    const panel = await screen.findByRole('dialog', { name: 'Log call' })
    await waitFor(() => {
      expect(within(panel).getByRole('textbox', { name: 'Call note' })).toHaveFocus()
    })
    const scriptView = asked.closest('[data-view=base]')
    expect(scriptView).toHaveAttribute('inert')
    expect(asked).toBeInTheDocument()

    // Back: the same script, with the tick and the count as they were.
    await view.user.click(
      within(noteViewIn(panel)).getByRole('button', { name: 'Back to the script' }),
    )
    const again = await screen.findByRole('dialog', { name: 'Jo Sample' })
    expect(scriptView).not.toHaveAttribute('inert')
    expect(
      within(again).getByRole('checkbox', { name: 'Asked: When does the Perth lease end?' }),
    ).toBe(asked)
    expect(asked).toBeChecked()
    expect(within(again).getByText('1 of 2 asked.')).toBeInTheDocument()
  })

  it('with call notes off there is no Log call button, and L does nothing', async () => {
    mockBackend({ options: options({ enabled: false }) })
    const view = renderCompanies()
    await ready(view)
    await view.user.keyboard('j')
    fireEvent.keyDown(document.body, { key: 'l' })
    await view.user.click(
      screen.getByRole('button', { name: 'Prep a call to Sample Logistics Pty Ltd' }),
    )
    // It opens on the quick look, calling Jo Sample, the first person on record (PLAN-V18 T3-7).
    const script = await screen.findByRole('dialog', { name: 'Jo Sample' })
    expect(await within(script).findByRole('button', { name: 'Copy script' })).toBeInTheDocument()
    expect(within(script).queryByRole('button', { name: 'Log call' })).toBeNull()
    fireEvent.keyDown(script, { key: 'l' })
    expect(screen.queryByRole('dialog', { name: 'Log call' })).toBeNull()
  })

  it('without the call notes routes (before they are merged), there is no Log call either', async () => {
    mockBackend({ options: null })
    const view = renderCompanies()
    await ready(view)
    await view.user.keyboard('j')
    fireEvent.keyDown(document.body, { key: 'l' })
    await view.user.click(screen.getByRole('button', { name: 'Sample Logistics Pty Ltd' }))
    const company = await screen.findByRole('dialog', { name: 'Sample Logistics Pty Ltd' })
    expect(await within(company).findByRole('button', { name: 'Prep a call' })).toBeInTheDocument()
    expect(within(company).queryByRole('button', { name: 'Log call' })).toBeNull()
  })
})

describe('Save and next', () => {
  it('saves at once: the panel closes, focus goes back to the row, the count and the toast', async () => {
    const backend = mockBackend()
    const view = renderCompanies()
    const panel = await logFromScript(view)
    await view.user.type(
      within(panel).getByRole('textbox', { name: 'Call note' }),
      'Lease ends June 2027. Call back in March.',
    )
    const outcome = within(panel).getByRole('group', { name: 'Outcome' })
    await view.user.click(within(outcome).getByRole('button', { name: 'Connected' }))
    expect(within(outcome).getByRole('button', { name: 'Connected' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await view.user.keyboard('{Control>}{Enter}{/Control}')

    expect(await screen.findByText('Saved. 7 to confirm.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Prep a call to Sample Logistics Pty Ltd' }),
      ).toHaveFocus()
    })
    await waitFor(() => {
      expect(count(view)).toBe(7)
    })

    await waitFor(() => {
      expect(posts(backend)).toHaveLength(1)
    })
    const [sent] = posts(backend)
    expect(sent?.key).toMatch(UUID)
    expect(sent?.body).toEqual({
      company_key: '101',
      contact_id: '201',
      prep_id: PREP_ID,
      text: 'Lease ends June 2027. Call back in March.',
      source: 'typed',
      called_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) as unknown,
      outcome: 'Connected',
    })
    // The server has it: the draft goes. No follow-up, so no PATCH.
    await waitFor(() => {
      expect(storedDrafts()).toEqual({})
    })
    expect(backend.sent.some((item) => item.method === 'PATCH')).toBe(false)
  })

  it('a note with only an outcome saves, and an empty one says what is missing', async () => {
    const backend = mockBackend()
    const view = renderCompanies()
    const panel = await logFirstRow(view)
    await view.user.click(within(panel).getByRole('button', { name: 'Save and next' }))
    expect(await within(panel).findByRole('alert')).toHaveTextContent(
      'Type a note or pick an outcome first.',
    )
    expect(posts(backend)).toHaveLength(0)
    await view.user.click(within(panel).getByRole('button', { name: 'No answer' }))
    await view.user.click(within(panel).getByRole('button', { name: 'Save and next' }))
    await waitFor(() => {
      expect(posts(backend)).toHaveLength(1)
    })
    expect(posts(backend)[0]?.body).toMatchObject({
      text: '',
      outcome: 'No answer',
      contact_id: null,
    })
  })

  it('says "Waiting for you to confirm" when the count is not known', async () => {
    mockBackend({ summary: null })
    const view = renderCompanies()
    const panel = await logFirstRow(view)
    await view.user.type(
      within(panel).getByRole('textbox', { name: 'Call note' }),
      'Spoke to reception.',
    )
    await view.user.keyboard('{Control>}{Enter}{/Control}')
    expect(await screen.findByText('Saved. Waiting for you to confirm.')).toBeInTheDocument()
  })

  it('Undo deletes the note, the count goes back, and the text comes back as the draft', async () => {
    const backend = mockBackend()
    const view = renderCompanies()
    const panel = await logFirstRow(view)
    await view.user.type(
      within(panel).getByRole('textbox', { name: 'Call note' }),
      'Wrong company.',
    )
    await view.user.keyboard('{Control>}{Enter}{/Control}')
    await waitFor(() => {
      expect(storedDrafts()).toEqual({})
    })
    const sentKey = posts(backend)[0]?.key

    await view.user.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => {
      expect(
        backend.sent.some((item) => item.method === 'DELETE' && item.path === `${NOTES}/note-1`),
      ).toBe(true)
    })
    expect(await screen.findByText('Undone. Your note is back as a draft.')).toBeInTheDocument()
    await waitFor(() => {
      expect(count(view)).toBe(6)
    })
    // Back as this call's draft, with a new key: the old note is gone.
    const restored = storedDrafts()['101|']
    expect(restored?.text).toBe('Wrong company.')
    expect(restored?.key).toMatch(UUID)
    expect(restored?.key).not.toBe(sentKey)

    fireEvent.keyDown(document.body, { key: 'l' })
    const again = await screen.findByRole('dialog', { name: 'Log call' })
    expect(within(again).getByRole('textbox', { name: 'Call note' })).toHaveValue('Wrong company.')
  })

  it('Undo before the save has answered: the delete follows the answer', async () => {
    const backend = mockBackend({ save: 'wait' })
    const view = renderCompanies()
    const panel = await logFirstRow(view)
    await view.user.type(within(panel).getByRole('textbox', { name: 'Call note' }), 'Oops.')
    await view.user.keyboard('{Control>}{Enter}{/Control}')
    await waitFor(() => {
      expect(posts(backend)).toHaveLength(1)
    })
    await view.user.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => {
      expect(count(view)).toBe(6)
    })
    expect(backend.sent.some((item) => item.method === 'DELETE')).toBe(false)

    await act(async () => {
      backend.release()
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(
        backend.sent.some((item) => item.method === 'DELETE' && item.path === `${NOTES}/note-1`),
      ).toBe(true)
    })
    // The text is safe as the draft, and the count stays where Undo put it.
    expect(storedDrafts()['101|']?.text).toBe('Oops.')
    expect(count(view)).toBe(6)
  })

  it('a failed save keeps the text: the count goes back, and Try again sends the same key', async () => {
    const backend = mockBackend({ save: 'fail' })
    const view = renderCompanies()
    const panel = await logFirstRow(view)
    await view.user.type(
      within(panel).getByRole('textbox', { name: 'Call note' }),
      'Left a message with reception.',
    )
    await view.user.keyboard('{Control>}{Enter}{/Control}')

    expect(await screen.findByText('Not saved yet. Try again.')).toBeInTheDocument()
    expect(screen.getByText('Your note is kept for this call.')).toBeInTheDocument()
    // The "Saved" toast goes: it wasn't saved.
    await waitFor(() => {
      expect(screen.queryByText('Saved. 7 to confirm.')).toBeNull()
    })
    await waitFor(() => {
      expect(count(view)).toBe(6)
    })
    const firstKey = posts(backend)[0]?.key
    expect(storedDrafts()['101|']).toMatchObject({
      key: firstKey,
      text: 'Left a message with reception.',
    })

    // Opening Log call for that call again shows the text.
    fireEvent.keyDown(document.body, { key: 'l' })
    const again = await screen.findByRole('dialog', { name: 'Log call' })
    expect(within(again).getByRole('textbox', { name: 'Call note' })).toHaveValue(
      'Left a message with reception.',
    )
    await view.user.keyboard('{Escape}{Escape}')
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })

    backend.save = 'ok'
    await view.user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Saved. 7 to confirm.')).toBeInTheDocument()
    await waitFor(() => {
      expect(posts(backend)).toHaveLength(2)
    })
    expect(posts(backend)[1]?.key).toBe(firstKey)
    await waitFor(() => {
      expect(storedDrafts()).toEqual({})
    })
  })

  it("a toast's Try again never sends the note for the next rep who signs in", async () => {
    const backend = mockBackend({ save: 'fail' })
    const view = renderCompaniesAs(MIA)
    const panel = await logFirstRow(view)
    await view.user.type(within(panel).getByRole('textbox', { name: 'Call note' }), 'Halfway')
    await view.user.keyboard('{Control>}{Enter}{/Control}')
    expect(await screen.findByText('Not saved yet. Try again.')).toBeInTheDocument()

    // Another rep signs in on the same browser while the toast is still up.
    backend.save = 'ok'
    act(() => {
      view.queryClient.setQueryData(queryKeys.auth.me(), signedInAs(SAM))
    })
    await view.user.click(screen.getByRole('button', { name: 'Try again' }))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100))
    })
    expect(posts(backend)).toHaveLength(1)
    // The note still waits for Mia, in her own entry.
    expect(window.localStorage.getItem(`${DRAFTS}.${MIA.id}`)).toContain('Halfway')
  })
})

describe('the draft', () => {
  it('survives a refresh: Log call for the same call shows the text again', async () => {
    mockBackend()
    const first = renderCompanies()
    const panel = await logFirstRow(first)
    await first.user.type(within(panel).getByRole('textbox', { name: 'Call note' }), 'Halfway')
    first.unmount()

    const second = renderCompanies()
    const again = await logFirstRow(second)
    expect(within(again).getByRole('textbox', { name: 'Call note' })).toHaveValue('Halfway')
  })

  it("is the signed-in rep's own: the next rep on the same browser starts with an empty note", async () => {
    mockBackend()
    const first = renderCompaniesAs(MIA)
    const panel = await logFirstRow(first)
    await first.user.type(within(panel).getByRole('textbox', { name: 'Call note' }), 'Halfway')
    first.unmount()
    // Kept in Mia's own entry, not the shared one sign-in off uses.
    expect(storedDrafts()).toEqual({})
    expect(window.localStorage.getItem(`${DRAFTS}.${MIA.id}`)).toContain('Halfway')

    const next = renderCompaniesAs(SAM)
    const empty = await logFirstRow(next)
    expect(within(empty).getByRole('textbox', { name: 'Call note' })).toHaveValue('')
    next.unmount()

    const back = renderCompaniesAs(MIA)
    const again = await logFirstRow(back)
    expect(within(again).getByRole('textbox', { name: 'Call note' })).toHaveValue('Halfway')
  })

  it('"Log call" on the company record asks who, and the person picked goes with the note', async () => {
    const backend = mockBackend()
    const view = renderCompanies()
    await ready(view)
    await view.user.click(screen.getByRole('button', { name: 'Sample Logistics Pty Ltd' }))
    const company = await screen.findByRole('dialog', { name: 'Sample Logistics Pty Ltd' })
    await view.user.click(await within(company).findByRole('button', { name: 'Log call' }))
    const panel = await screen.findByRole('dialog', { name: 'Log call' })
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Sample Logistics Pty Ltd' })).toBeNull()
    })
    const who = await within(panel).findByRole('radiogroup', { name: 'Who was the call with?' })
    await view.user.click(within(who).getByRole('radio', { name: 'Jo Sample' }))
    await view.user.type(
      within(panel).getByRole('textbox', { name: 'Call note' }),
      'Booked a visit.',
    )
    // The draft moved to the call with Jo.
    expect(Object.keys(storedDrafts())).toEqual(['101|201'])
    await view.user.click(within(panel).getByRole('button', { name: 'Save and next' }))
    await waitFor(() => {
      expect(posts(backend)).toHaveLength(1)
    })
    expect(posts(backend)[0]?.body).toMatchObject({
      contact_id: '201',
      prep_id: null,
      text: 'Booked a visit.',
    })
  })
})

describe('with the AI off', () => {
  it('takes one follow-up by hand: the date forgives, and it goes as a PATCH after the save', async () => {
    const backend = mockBackend()
    const view = renderCompanies()
    const panel = await logFirstRow(view)
    await view.user.type(
      within(panel).getByRole('textbox', { name: 'Call note' }),
      'Wants a call back.',
    )
    await view.user.click(within(panel).getByRole('button', { name: 'Add a follow-up' }))
    const what = within(panel).getByRole('textbox', { name: 'What to do' })
    expect(what).toHaveFocus()
    await view.user.type(what, 'Call back about the lease')
    const when = within(panel).getByRole('textbox', { name: 'When' })
    // A value it truly can't read gets plain words, once the field is left.
    await view.user.type(when, 'whenever')
    await view.user.tab()
    expect(await within(panel).findByRole('alert')).toHaveTextContent(
      "That date couldn't be read. Try tomorrow, next Tuesday, 24 Nov or 24/11.",
    )
    await view.user.clear(when)
    await view.user.type(when, 'next tue')
    const due = readDueDate('next tue', melbourneDate())
    if (due.kind !== 'date') throw new Error('next tue is a date')
    expect(within(panel).getByText(dueWords(due.date, due.moved))).toBeInTheDocument()

    await view.user.keyboard('{Control>}{Enter}{/Control}')
    await waitFor(() => {
      expect(backend.sent.filter((item) => item.method === 'PATCH')).toHaveLength(1)
    })
    const patch = backend.sent.find((item) => item.method === 'PATCH')
    expect(patch?.path).toBe(`${NOTES}/note-1`)
    expect(patch?.body).toEqual({
      tasks: [
        {
          subject: 'Call back about the lease',
          due: due.date,
          due_words: 'next tue',
          kind: 'call',
        },
      ],
    })
  })

  it('will not save a follow-up with no day, and says what to add', async () => {
    const backend = mockBackend()
    const view = renderCompanies()
    const panel = await logFirstRow(view)
    await view.user.type(within(panel).getByRole('textbox', { name: 'Call note' }), 'Busy.')
    await view.user.click(within(panel).getByRole('button', { name: 'Add a follow-up' }))
    await view.user.type(
      within(panel).getByRole('textbox', { name: 'What to do' }),
      'Email the plan',
    )
    await view.user.keyboard('{Control>}{Enter}{/Control}')
    expect(await within(panel).findByRole('alert')).toHaveTextContent(
      'Add when, like tomorrow or 24 Nov.',
    )
    expect(within(panel).getByRole('textbox', { name: 'When' })).toHaveFocus()
    expect(posts(backend)).toHaveLength(0)
  })

  it('has no follow-up line with the AI on: the sorter finds tasks', async () => {
    mockBackend({ options: options({ ai_enabled: true }) })
    const view = renderCompanies()
    const panel = await logFirstRow(view)
    expect(within(panel).getByRole('group', { name: 'Outcome' })).toBeInTheDocument()
    expect(within(panel).queryByRole('button', { name: 'Add a follow-up' })).toBeNull()
  })
})

describe('the mic button (PLAN-V18 T3-4)', () => {
  it('sits in the corner of the note box on a laptop, named Speak, and the Win+H line is gone', async () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32')
    mockBackend()
    const view = renderCompanies()
    const panel = await logFirstRow(view)
    const speak = within(panel).getByRole('button', { name: 'Speak' })
    // Never round (DESIGN.md "No pills"), and 44px.
    expect(speak).toHaveClass('size-11', 'rounded-lg')
    expect(speak).not.toHaveClass('rounded-full')
    const box = within(panel).getByRole('textbox', { name: 'Call note' })
    expect(box.parentElement).toContainElement(speak)
    // Room at the foot of the box, so the last line never hides under the button.
    expect(box).toHaveClass('pb-14')
    expect(within(panel).queryByText(/Win\+H/)).toBeNull()
  })

  it('opens the mic card from the button, and Done puts the words in the box', async () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32')
    const mic = new FakeMic()
    mic.install()
    mockBackend({ options: { ...options(), voice_tool: 'browser_service' } as CallNoteOptions })
    const view = renderCompanies()
    const panel = await logFirstRow(view)
    const box = within(panel).getByRole('textbox', { name: 'Call note' })
    await view.user.click(within(panel).getByRole('button', { name: 'Speak' }))
    await screen.findByRole('dialog', { name: 'Speak now' }, { timeout: 5000 })
    // The browser's own speech service, in Australian English.
    const [service] = mic.recognitions
    expect(service?.lang).toBe('en-AU')
    act(() => {
      service?.result('Spoke to Jo about the lease')
    })
    await view.user.keyboard('{Enter}')
    await waitFor(() => {
      expect(box).toHaveValue('Spoke to Jo about the lease')
    })
    await waitFor(() => {
      expect(box).toHaveFocus()
    })
    // The mic is let go, and the card is gone.
    expect(mic.live()).toBe(0)
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /Speak now|Writing it out|Done/ })).toBeNull()
    })
  })

  it('is not there when the voice tool is typing', async () => {
    mockBackend({ options: { ...options(), voice_tool: 'typing' } as CallNoteOptions })
    const view = renderCompanies()
    const panel = await logFirstRow(view)
    expect(within(panel).getByRole('textbox', { name: 'Call note' })).toBeInTheDocument()
    expect(within(panel).queryByRole('button', { name: 'Speak' })).toBeNull()
  })
})

describe('on a phone', () => {
  it('fills the screen, the text box first, and Save and next at the bottom above the safe area', async () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32')
    asPhone()
    const backend = mockBackend()
    const view = renderCompanies()
    await screen.findByRole('list', { name: 'Companies' })
    await waitFor(() => {
      expect(view.queryClient.getQueryData(queryKeys.companies.callNoteOptions())).toBeDefined()
    })
    // The company's record, then its Log call at the bottom.
    await view.user.click(screen.getByRole('button', { name: 'Sample Logistics Pty Ltd' }))
    const company = await screen.findByRole('dialog', { name: 'Sample Logistics Pty Ltd' })
    await view.user.click(await within(company).findByRole('button', { name: 'Log call' }))
    const panel = await screen.findByRole('dialog', { name: 'Log call' })

    const box = within(panel).getByRole('textbox', { name: 'Call note' })
    await waitFor(() => {
      expect(box).toHaveFocus()
    })
    // 16px text on touch, so a phone doesn't zoom in.
    expect(box).toHaveClass('touch:text-body')
    const who = await within(panel).findByRole('radiogroup', { name: 'Who was the call with?' })
    // The text box comes first.
    expect(box.compareDocumentPosition(who) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // The keyboard's own mic does the talking: no mic button, even on Windows.
    expect(within(panel).queryByRole('button', { name: 'Speak' })).toBeNull()

    const save = within(panel).getByRole('button', { name: 'Save and next' })
    expect(save).toHaveClass('w-full')
    expect(save.parentElement).toHaveClass('pb-[max(0.75rem,env(safe-area-inset-bottom))]')

    await view.user.type(box, 'Walking to the next one.')
    await view.user.click(save)
    expect(await screen.findByText('Saved. 7 to confirm.')).toBeInTheDocument()
    await waitFor(() => {
      expect(posts(backend)).toHaveLength(1)
    })
  })
})

describe('the timer', () => {
  it('counts up, and at the soft limit turns Ochre and says so once, without stopping', async () => {
    startManualClock()
    render(<NoteTimer softSeconds={180} />)
    const timer = document.querySelector<HTMLElement>('[data-slot=note-timer]')
    expect(screen.getByRole('timer')).toHaveTextContent('0:00')
    expect(screen.getByRole('status')).toHaveTextContent('')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(179_000)
    })
    expect(screen.getByRole('timer')).toHaveTextContent('2:59')
    expect(timer).not.toHaveAttribute('data-late')
    expect(timer).toHaveClass('text-muted-foreground')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    expect(screen.getByRole('status')).toHaveTextContent("That's 3 minutes. Wrap up when you can.")
    expect(timer).toHaveAttribute('data-late', 'true')
    expect(timer).toHaveClass('text-review-ink')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(65_000)
    })
    expect(screen.getByRole('timer')).toHaveTextContent('4:05')
  })
})
