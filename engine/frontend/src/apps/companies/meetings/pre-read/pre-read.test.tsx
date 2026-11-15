/**
 * The pre-read's page (PLAN-V17 T3-10), against Track 2's real contract (v17.ts Part 3) and a fake
 * server that keeps its pre-read between requests and answers as Track 2's does: a summary the rep
 * changes is theirs (`by: person`) and a redraft keeps it, a blank is tidied, and a change to a
 * sent pre-read makes it a draft again.
 *
 * Real time, not a fake clock: the status fades with motion, and a fake clock that stops leaves
 * motion's frame loop waiting for a frame (found in Activity's tests). Dates are matched with or
 * without the year, so the tests hold in any year. Made-up names only.
 */
import { act, render, screen, waitFor, within } from '@testing-library/react'
import { domMax, LazyMotion } from 'motion/react'
import type { ReactNode } from 'react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { toast } from 'sonner'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  FormFact,
  FormMeeting,
  FormSummaries,
  FormSummary,
  MeetingDetail,
  MeetingFormOut,
  MeetingFormPatch,
} from '@/api/v17'
import { MotionRoot } from '@/components/motion'
import { REDUCED_MOTION } from '@/lib/use-media-query'
import { routes } from '@/router'
import { prefetchPage } from '@/shell/prefetch'
import { createTestQueryClient, renderWithProviders } from '@/test/render'
import { FadeSwap } from './fade-swap'
import PreReadPage from './index'

const FORM_ID = '0f3c9a2e-1111-2222-3333-444444444444'
const FORM = `/api/v1/companies/meetings/forms/${FORM_ID}`
const REDRAFT = `${FORM}/redraft`
const MEETING = '/api/v1/companies/meetings/9001'
const HUBSPOT_URL = 'https://app.hubspot.com/contacts/1/record/0-47/9001'

/** The day and time the meeting is: 10 am on Friday 27 Nov 2026 in Melbourne. */
const WHEN = /^Fri 27 Nov( 2026)?, 10:00 am to 11:00 am$/

const SOURCES = {
  F1: { id: 'F1', kind: 'hubspot', label: 'HubSpot: the company', date: null, url: null },
  F2: { id: 'F2', kind: 'hubspot', label: 'HubSpot: Perth office', date: null, url: null },
  F3: { id: 'F3', kind: 'call', label: 'Call with Sam Sample', date: '2026-10-20', url: null },
} as const

function summary(text: string, source: keyof typeof SOURCES): FormSummary {
  return { text, by: 'ai', sources: [SOURCES[source]] }
}

const EMPTY: FormSummary = { text: '', by: 'ai', sources: [] }
const NONE_WRITTEN: FormSummaries = {
  what_they_do: EMPTY,
  what_we_know: EMPTY,
  talks_so_far: EMPTY,
}

const WRITTEN: FormSummaries = {
  what_they_do: summary('A freight company with about 300 staff.', 'F1'),
  what_we_know: summary('Their Perth lease ends in June 2028.', 'F2'),
  talks_so_far: summary('Jo called Sam in October about the Perth move.', 'F3'),
}

const FACTS: FormFact[] = [
  { label: 'When', value: 'Fri 27 Nov 2026, 10:00 am to 11:00 am', source: 'HubSpot meeting' },
  { label: 'Where', value: 'Online', source: 'HubSpot meeting' },
  { label: 'Who we meet', value: 'Sam Sample (Office Manager)', source: 'HubSpot contacts' },
  { label: 'Contour people', value: 'Jo Sample', source: 'HubSpot meeting' },
  { label: 'Staff', value: 'About 300', source: 'HubSpot company' },
  { label: 'Offices', value: 'Perth', source: 'HubSpot offices' },
  { label: 'Lease end', value: '30 Jun 2028', source: 'HubSpot offices' },
  { label: 'Deal stage', value: 'Perth move: Proposal', source: 'HubSpot deal' },
]

const MEETING_OF_FORM: FormMeeting = {
  meeting_id: '9001',
  company_key: '101',
  company_name: 'Sample Logistics Pty Ltd',
  title: 'Office walk-through',
  starts_at: '2026-11-26T23:00:00Z',
  ends_at: '2026-11-27T00:00:00Z',
  where: 'online',
}

/** A pre-read whose draft is ready, with its two blanks still empty. */
function form(changes: Partial<MeetingFormOut> = {}): MeetingFormOut {
  return {
    id: FORM_ID,
    meeting: MEETING_OF_FORM,
    status: 'draft',
    facts: FACTS,
    summaries: WRITTEN,
    next_step: null,
    going: null,
    sent_to: [],
    sent_at: null,
    sent_by: null,
    hubspot_copy: null,
    cost_usd: '0.031200',
    error: null,
    ...changes,
  }
}

/** A pre-read just started: no facts yet, nothing written, nothing spent. */
function drafting(changes: Partial<MeetingFormOut> = {}): MeetingFormOut {
  return form({ status: 'drafting', facts: [], summaries: NONE_WRITTEN, cost_usd: '0', ...changes })
}

/** The server finishes a draft: Claude's new words, and the rep's own summaries as they were. */
function finished(
  current: MeetingFormOut,
  texts: Partial<Record<keyof FormSummaries, string>>,
  cost: string,
): MeetingFormOut {
  const summaries = { ...current.summaries }
  for (const [name, text] of Object.entries(texts) as [keyof FormSummaries, string][]) {
    if (summaries[name].by === 'ai') summaries[name] = summary(text, 'F1')
  }
  return { ...current, status: 'draft', summaries, cost_usd: cost }
}

interface Call {
  method: string
  path: string
  body: unknown
}

interface Server {
  form: MeetingFormOut
  /** What the next reads answer, one each, before `form` (a draft moving on). */
  next: MeetingFormOut[]
  /** How GET answers: the form, 404 `form_not_found`, 422 for an id that can't be one, off, or a fault. */
  get: 'ok' | 'missing' | 'bad-id' | 'off' | 'broken'
  /** How PATCH answers: at once, after `release()`, or a fault the first time. */
  patch: 'ok' | 'wait' | 'fail-once'
  release: () => void
  calls: Call[]
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status })
}

function problem(status: number, title: string, detail: string, code: string): Response {
  return json({ title, detail, status, code }, status)
}

const FAULT = (): Response => json({ title: 'Something went wrong on our side', status: 500 }, 500)

/** As the server keeps the rep's words: each line's spaces tidied, empty lines dropped. */
function tidy(text: string | null | undefined): string {
  return (text ?? '')
    .split('\n')
    .map((line) => line.split(/\s+/).filter(Boolean).join(' '))
    .filter(Boolean)
    .join('\n')
}

function applyPatch(current: MeetingFormOut, patch: MeetingFormPatch): MeetingFormOut {
  const next: MeetingFormOut = { ...current, summaries: { ...current.summaries } }
  for (const [name, text] of Object.entries(patch.summaries ?? {}) as [
    keyof FormSummaries,
    string | null,
  ][]) {
    next.summaries[name] = { ...next.summaries[name], text: tidy(text), by: 'person' }
  }
  if ('next_step' in patch) next.next_step = tidy(patch.next_step) || null
  if ('going' in patch) next.going = tidy(patch.going) || null
  if (next.status === 'sent') next.status = 'draft'
  return next
}

function mockServer(changes: Partial<Omit<Server, 'calls' | 'release'>> = {}): Server {
  const server: Server = {
    form: form(),
    next: [],
    get: 'ok',
    patch: 'ok',
    release: () => undefined,
    calls: [],
    ...changes,
  }
  let failed = false
  const respond = async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    const { method } = request
    const text = method === 'GET' ? '' : await request.clone().text()
    const body: unknown = text ? JSON.parse(text) : null
    server.calls.push({ method, path: url.pathname, body })
    if (url.pathname === FORM && method === 'GET') {
      switch (server.get) {
        case 'missing':
          return problem(
            404,
            "We can't find that pre-read",
            "It may have been removed, or it isn't open to your account.",
            'form_not_found',
          )
        case 'bad-id':
          return json(
            {
              title: "Contour couldn't read that",
              status: 422,
              errors: [{ field: 'path.form_id', message: 'Input should be a valid UUID' }],
            },
            422,
          )
        case 'off':
          return problem(
            409,
            'Meetings are off',
            'An admin can switch them on.',
            'meeting_forms_off',
          )
        case 'broken':
          return FAULT()
        case 'ok':
          break
      }
      const step = server.next.shift()
      if (step) server.form = step
      return json(server.form)
    }
    if (url.pathname === FORM && method === 'PATCH') {
      if (server.patch === 'wait') {
        await new Promise<void>((resolve) => {
          server.release = resolve
        })
      }
      if (server.patch === 'fail-once' && !failed) {
        failed = true
        return FAULT()
      }
      server.form = applyPatch(server.form, body as MeetingFormPatch)
      return json(server.form)
    }
    if (url.pathname === REDRAFT && method === 'POST') {
      if (server.form.status === 'drafting') {
        return problem(
          409,
          'Still writing',
          'This pre-read is still being written. Try again in a moment.',
          'form_drafting',
        )
      }
      server.form = { ...server.form, status: 'drafting', error: null }
      return json(server.form, 202)
    }
    if (url.pathname === MEETING && method === 'GET') {
      const detail: MeetingDetail = {
        meeting: {
          id: '9001',
          company_id: '101',
          title: 'Office walk-through',
          starts_at: MEETING_OF_FORM.starts_at,
          ends_at: MEETING_OF_FORM.ends_at,
          where: 'online',
          hubspot_url: HUBSPOT_URL,
        },
        company_name: 'Sample Logistics Pty Ltd',
        form: server.form,
      }
      return json(detail)
    }
    return problem(404, 'Not found', 'Not here.', 'not_found')
  }
  vi.stubGlobal(
    'fetch',
    vi.fn((request: Request) => respond(request)),
  )
  return server
}

function reads(server: Server): number {
  return server.calls.filter((call) => call.method === 'GET' && call.path === FORM).length
}

function patches(server: Server): unknown[] {
  return server.calls.filter((call) => call.method === 'PATCH').map((call) => call.body)
}

function renderPreRead(path = `/companies/meetings/${FORM_ID}`) {
  const router = createMemoryRouter(
    [
      { path: '/companies/meetings', element: <h1>Client meetings</h1> },
      { path: '/companies/meetings/:formId', element: <PreReadPage /> },
      { path: '/companies/:key', element: <h1>Company</h1> },
    ],
    { initialEntries: [path] },
  )
  const result = renderWithProviders(<RouterProvider router={router} />, { withRouter: false })
  return { ...result, router }
}

/** One summary, found by its title. */
function summaryOf(title: string) {
  const block = screen
    .getByRole('heading', { level: 3, name: title })
    .closest('[data-slot=summary]')
  if (!(block instanceof HTMLElement)) throw new Error(`No summary called ${title}`)
  return within(block)
}

/** The page's header: the meeting, its company, when and where, and the status. */
function pageHeader(): HTMLElement {
  const header = document.querySelector('[data-slot=page-header]')
  if (!(header instanceof HTMLElement)) throw new Error('No page header')
  return header
}

function stillBlocks(): number {
  return document.querySelectorAll('[data-slot=summary-pending]').length
}

/** The computer asks for reduced motion, for the rest of this test. */
function askForReducedMotion() {
  vi.stubGlobal('matchMedia', (query: string): MediaQueryList => ({
    matches: query === REDUCED_MOTION,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }))
}

afterEach(() => {
  // Sonner keeps toasts in one store for the whole file.
  toast.dismiss()
})

describe('a draft', () => {
  it('shows the meeting, the facts with their sources, and three summaries written by AI', async () => {
    mockServer()
    renderPreRead()
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Office walk-through' }),
    ).toBeInTheDocument()
    // The header: the company (a link to its record), the day and time, Teams, the status.
    const header = within(pageHeader())
    expect(header.getByRole('link', { name: 'Sample Logistics Pty Ltd' })).toHaveAttribute(
      'href',
      '/companies/101',
    )
    expect(header.getByText(WHEN)).toBeInTheDocument()
    expect(header.getByText('Teams')).toBeInTheDocument()
    expect(header.getByText('Draft ready')).toBeInTheDocument()
    // HubSpot's link comes from the meeting itself, and opens in a new tab.
    const hubspot = await screen.findByRole('link', { name: /^Open in HubSpot/ })
    expect(hubspot).toHaveAttribute('href', HUBSPOT_URL)
    expect(hubspot).toHaveAttribute('target', '_blank')

    // The facts, as the server sends them, each with where it came from in quiet text.
    const facts = within(screen.getByRole('region', { name: 'The facts' }))
    expect(facts.getByText('From HubSpot and our notes, with no AI.')).toBeInTheDocument()
    expect(facts.getAllByRole('term').map((term) => term.textContent)).toEqual(
      FACTS.map((fact) => fact.label),
    )
    expect(facts.getByText('Sam Sample (Office Manager)')).toBeInTheDocument()
    expect(facts.getByText('About 300')).toBeInTheDocument()
    expect(facts.getByText('HubSpot company')).toHaveClass('text-muted-foreground')

    // Three summaries, each marked, each with its sources as call prep's chips, each with a pencil.
    const written: [string, string, string, string][] = [
      ['What they do', 'A freight company with about 300 staff.', 'F1', 'Edit what they do'],
      [
        'What we know about the project',
        'Their Perth lease ends in June 2028.',
        'F2',
        'Edit what we know about the project',
      ],
      [
        'The talks so far',
        'Jo called Sam in October about the Perth move.',
        'F3',
        'Edit the talks so far',
      ],
    ]
    for (const [title, words, chip, pencil] of written) {
      const one = summaryOf(title)
      expect(one.getByText(words)).toBeInTheDocument()
      expect(one.getByText('Written by AI')).toBeInTheDocument()
      expect(one.getByText(chip)).toBeInTheDocument()
      expect(one.getByRole('button', { name: pencil })).toBeInTheDocument()
    }
    expect(screen.getByText('Source: Call with Sam Sample, 20 Oct 2026')).toBeInTheDocument()

    // Redraft says it costs money, with the last cost, and that edits stay.
    const redraft = screen.getByRole('button', { name: 'Redraft (about US$0.03)' })
    expect(redraft).toBeEnabled()
    expect(redraft).toHaveAccessibleDescription(
      'It writes the three summaries again. Your edits are kept.',
    )

    // The two blanks, empty, with clear labels; Check and send waits for them.
    expect(screen.getByRole('textbox', { name: 'Ideal next step' })).toHaveValue('')
    expect(screen.getByRole('textbox', { name: 'Who is going' })).toHaveValue('')
    const send = screen.getByRole('button', { name: 'Check and send' })
    expect(send).toBeDisabled()
    expect(send).toHaveAccessibleDescription('Fill in the ideal next step and who is going first.')
  })

  it('a meeting typed in has no HubSpot link, and the page asks for none', async () => {
    const server = mockServer({
      form: form({
        meeting: {
          ...MEETING_OF_FORM,
          meeting_id: null,
          company_key: 'lead:7',
          where: 'in_person',
        },
      }),
    })
    renderPreRead()
    await screen.findByRole('heading', { level: 1, name: 'Office walk-through' })
    expect(screen.getByRole('link', { name: 'Sample Logistics Pty Ltd' })).toHaveAttribute(
      'href',
      '/companies/lead%3A7',
    )
    expect(within(pageHeader()).getByText('In person')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Open in HubSpot/ })).toBeNull()
    expect(server.calls.map((call) => call.path)).toEqual([FORM])
  })

  it('an empty summary says so, and its pencil can write it', async () => {
    mockServer({ form: form({ summaries: { ...WRITTEN, talks_so_far: EMPTY } }) })
    renderPreRead()
    await screen.findByRole('heading', { level: 1, name: 'Office walk-through' })
    const talks = summaryOf('The talks so far')
    expect(
      talks.getByText('Nothing in the facts for this yet. Write it with the pencil.'),
    ).toBeInTheDocument()
    // The AI wrote nothing here, so nothing is marked as its own.
    expect(talks.queryByText('Written by AI')).toBeNull()
    expect(talks.getByRole('button', { name: 'Edit the talks so far' })).toBeInTheDocument()
  })
})

describe('the pencil', () => {
  it('shows the new words and "Edited by you" at once, and a redraft keeps them', async () => {
    const server = mockServer({ patch: 'wait' })
    const { user } = renderPreRead()
    await screen.findByRole('heading', { level: 1, name: 'Office walk-through' })
    const words = 'The Perth lease ends 30 June 2028, and they want to move early.'

    await user.click(
      summaryOf('What we know about the project').getByRole('button', {
        name: 'Edit what we know about the project',
      }),
    )
    const box = summaryOf('What we know about the project').getByRole('textbox', {
      name: 'What we know about the project, your wording',
    })
    expect(box).toHaveFocus()
    expect(box).toHaveValue('Their Perth lease ends in June 2028.')
    await user.clear(box)
    await user.type(box, words)
    await user.click(
      summaryOf('What we know about the project').getByRole('button', { name: 'Save' }),
    )

    // At once, before the server answers: the new words, and the mark turns.
    expect(summaryOf('What we know about the project').getByText(words)).toBeInTheDocument()
    expect(
      await summaryOf('What we know about the project').findByText('Edited by you'),
    ).toBeInTheDocument()
    expect(summaryOf('What we know about the project').queryByText('Written by AI')).toBeNull()
    await waitFor(() => {
      expect(patches(server)).toEqual([{ summaries: { what_we_know: words } }])
    })
    server.release()
    // The focus is back on the pencil, so the keyboard carries on from there.
    await waitFor(() => {
      expect(
        summaryOf('What we know about the project').getByRole('button', {
          name: 'Edit what we know about the project',
        }),
      ).toHaveFocus()
    })

    // Redraft: the AI's two go still and grey while they are written; the rep's stays as it is.
    server.patch = 'ok'
    await user.click(screen.getByRole('button', { name: 'Redraft (about US$0.03)' }))
    expect(await screen.findByText('Drafting')).toBeInTheDocument()
    expect(server.calls.filter((call) => call.path === REDRAFT)).toHaveLength(1)
    expect(stillBlocks()).toBe(2)
    expect(screen.getByText('Writing the summaries.')).toBeInTheDocument()
    expect(summaryOf('What we know about the project').getByText(words)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Redraft/ })).toBeDisabled()

    // The server writes the other two again, keeps the rep's, and the page asks again in 2s.
    server.form = finished(
      server.form,
      {
        what_they_do: 'A freight and storage company.',
        what_we_know: "Not used: the rep's own stays.",
        talks_so_far: 'Sam asked for a proposal by December.',
      },
      '0.062400',
    )
    expect(
      await screen.findByText('A freight and storage company.', {}, { timeout: 4000 }),
    ).toBeInTheDocument()
    expect(screen.getByText('Sam asked for a proposal by December.')).toBeInTheDocument()
    expect(summaryOf('What we know about the project').getByText(words)).toBeInTheDocument()
    expect(
      summaryOf('What we know about the project').getByText('Edited by you'),
    ).toBeInTheDocument()
    expect(stillBlocks()).toBe(0)
    expect(await screen.findByText('Draft ready')).toBeInTheDocument()
  }, 15_000)

  it('a refused save puts the summary back, and opens the box again with the words and why', async () => {
    const server = mockServer({ patch: 'fail-once' })
    const { user } = renderPreRead()
    await screen.findByRole('heading', { level: 1, name: 'Office walk-through' })
    await user.click(summaryOf('What they do').getByRole('button', { name: 'Edit what they do' }))
    const box = summaryOf('What they do').getByRole('textbox', {
      name: 'What they do, your wording',
    })
    await user.clear(box)
    await user.type(box, 'A freight company in Perth.')
    await user.click(summaryOf('What they do').getByRole('button', { name: 'Save' }))

    // The box comes back with the rep's words, and says why in plain words.
    const again = await summaryOf('What they do').findByRole('textbox', {
      name: 'What they do, your wording',
    })
    expect(again).toHaveValue('A freight company in Perth.')
    expect(summaryOf('What they do').getByRole('alert')).toHaveTextContent(
      'Something went wrong on our side. Not saved yet. Try again.',
    )
    // What the server holds: the AI's summary, so its mark again.
    expect(await summaryOf('What they do').findByText('Written by AI')).toBeInTheDocument()

    // Saved again, it goes.
    await user.click(summaryOf('What they do').getByRole('button', { name: 'Save' }))
    expect(await summaryOf('What they do').findByText('Edited by you')).toBeInTheDocument()
    expect(summaryOf('What they do').getByText('A freight company in Perth.')).toBeInTheDocument()
    expect(patches(server)).toHaveLength(2)
  })
})

describe('the two blanks', () => {
  it('each saves when it is left, only if it changed, and Check and send waits for both', async () => {
    const server = mockServer()
    const { user } = renderPreRead()
    await screen.findByRole('heading', { level: 1, name: 'Office walk-through' })
    const send = screen.getByRole('button', { name: 'Check and send' })
    const next = screen.getByRole('textbox', { name: 'Ideal next step' })
    const going = screen.getByRole('textbox', { name: 'Who is going' })

    // Left as it was, a blank sends nothing.
    await user.click(next)
    await user.tab()
    expect(patches(server)).toEqual([])

    // The rule follows what is typed; the save goes when the field is left.
    await user.click(next)
    await user.type(next, 'Book a site visit  for early December. ')
    expect(send).toHaveAccessibleDescription('Fill in who is going first.')
    expect(patches(server)).toEqual([])
    await user.tab()
    await waitFor(() => {
      expect(next).toHaveAccessibleDescription('Saved.')
    })
    expect(patches(server)).toEqual([{ next_step: 'Book a site visit  for early December.' }])
    // The server tidies the spaces, and the field shows what it keeps.
    expect(next).toHaveValue('Book a site visit for early December.')

    await user.type(going, 'Jo Sample and Mia Sample')
    expect(send).toBeEnabled()
    expect(send).not.toHaveAttribute('aria-describedby')
    await user.tab()
    await waitFor(() => {
      expect(going).toHaveAccessibleDescription('Saved.')
    })
    expect(patches(server)).toEqual([
      { next_step: 'Book a site visit  for early December.' },
      { going: 'Jo Sample and Mia Sample' },
    ])

    // Back in a field and out again, unchanged: nothing more is sent.
    await user.click(next)
    await user.tab()
    expect(patches(server)).toHaveLength(2)
    expect(send).toBeEnabled()
  })

  it('a failed save keeps the text, says so, and Try again sends it again', async () => {
    const server = mockServer({ patch: 'fail-once', form: form({ going: 'Jo Sample' }) })
    const { user } = renderPreRead()
    await screen.findByRole('heading', { level: 1, name: 'Office walk-through' })
    const next = screen.getByRole('textbox', { name: 'Ideal next step' })
    expect(screen.getByRole('textbox', { name: 'Who is going' })).toHaveValue('Jo Sample')

    await user.type(next, 'Book a site visit.')
    await user.tab()
    const alert = await screen.findByText(
      'Something went wrong on our side. Not saved yet. Try again.',
    )
    expect(alert).toHaveAttribute('role', 'alert')
    expect(next).toHaveValue('Book a site visit.')
    expect(next).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('button', { name: 'Check and send' })).toHaveAccessibleDescription(
      "Your part isn't saved yet. Try again first.",
    )

    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => {
      expect(next).toHaveAccessibleDescription('Saved.')
    })
    expect(patches(server)).toEqual([
      { next_step: 'Book a site visit.' },
      { next_step: 'Book a site visit.' },
    ])
    expect(next).not.toHaveAttribute('aria-invalid')
    expect(screen.getByRole('button', { name: 'Check and send' })).toBeEnabled()
  })
})

describe('while it drafts', () => {
  it('shows still grey blocks, asks every 2 seconds, and stops once it is ready', async () => {
    const server = mockServer({
      form: form(),
      next: [drafting(), drafting({ facts: FACTS }), form()],
    })
    const { user } = renderPreRead()
    expect(await screen.findByText('Writing the summaries.')).toBeInTheDocument()
    expect(screen.getByText('Drafting')).toBeInTheDocument()
    // The facts come a moment after the start: their place is kept.
    expect(screen.getByText('The facts show in a moment.')).toBeInTheDocument()
    // Each summary is a still block at its real size, and says nothing until it is written.
    expect(stillBlocks()).toBe(3)
    for (const block of document.querySelectorAll(
      '[data-slot=summary-pending] [data-slot=skeleton]',
    )) {
      expect(block.className).not.toMatch(/animate-pulse/)
    }
    expect(screen.queryByText('Written by AI')).toBeNull()
    expect(screen.queryByRole('button', { name: /^Edit / })).toBeNull()
    expect(screen.getByRole('button', { name: /^Redraft/ })).toBeDisabled()
    // The blanks can be filled meanwhile: they are the rep's, not the draft's.
    await user.type(screen.getByRole('textbox', { name: 'Ideal next step' }), 'Site visit.')
    await user.type(screen.getByRole('textbox', { name: 'Who is going' }), 'Jo Sample')
    expect(screen.getByRole('button', { name: 'Check and send' })).toHaveAccessibleDescription(
      'The summaries are still being written.',
    )
    expect(reads(server)).toBe(1)

    // 2 seconds later: the facts.
    expect(await screen.findByText('About 300', {}, { timeout: 4000 })).toBeInTheDocument()
    expect(reads(server)).toBe(2)
    expect(stillBlocks()).toBe(3)

    // 2 more: the summaries, and the draft is ready.
    expect(
      await screen.findByText('A freight company with about 300 staff.', {}, { timeout: 4000 }),
    ).toBeInTheDocument()
    expect(reads(server)).toBe(3)
    expect(stillBlocks()).toBe(0)
    expect(await screen.findByText('Draft ready')).toBeInTheDocument()
    expect(screen.queryByText('Writing the summaries.')).toBeNull()

    // Then it stops asking.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2500))
    })
    expect(reads(server)).toBe(3)
  }, 15_000)
})

describe('a failed draft', () => {
  it('says what went wrong in plain words, with Try again and what it costs', async () => {
    const server = mockServer({
      form: form({
        status: 'failed',
        error: 'Claude is busy right now. Try again in a minute.',
        summaries: NONE_WRITTEN,
        next_step: 'Book a site visit.',
        going: 'Jo Sample',
      }),
    })
    const { user } = renderPreRead()
    const notice = await screen.findByRole('alert')
    expect(notice).toHaveTextContent("The summaries weren't written")
    expect(notice).toHaveTextContent('Claude is busy right now. Try again in a minute.')
    expect(screen.getByText('Draft failed')).toBeInTheDocument()
    // The summaries' place is the notice: no empty summaries, and no second Redraft.
    expect(screen.queryByRole('heading', { level: 3 })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Redraft/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Check and send' })).toHaveAccessibleDescription(
      "The summaries weren't written. Try again first.",
    )

    const tryAgain = within(notice).getByRole('button', { name: 'Try again (about US$0.03)' })
    expect(tryAgain).toHaveAccessibleDescription(
      'It writes the three summaries again. Your edits are kept.',
    )
    await user.click(tryAgain)
    expect(await screen.findByText('Writing the summaries.')).toBeInTheDocument()
    expect(server.calls.filter((call) => call.path === REDRAFT)).toHaveLength(1)
    expect(stillBlocks()).toBe(3)
    expect(screen.queryByText("The summaries weren't written")).toBeNull()
  })
})

describe('sent', () => {
  it('says who got it and when, and where its copy in HubSpot stands', async () => {
    mockServer({
      form: form({
        status: 'sent',
        next_step: 'Book a site visit.',
        going: 'Jo Sample',
        sent_to: [
          { name: 'Jo Sample', email: 'jo.sample@example.com' },
          { name: null, email: 'mia.sample@example.com' },
        ],
        sent_at: '2026-11-25T22:12:00Z',
        sent_by: 'Al Sample',
        hubspot_copy: {
          state: 'waiting',
          sentence: "Writing to HubSpot isn't on yet, so the copy waits.",
        },
      }),
    })
    const { user } = renderPreRead()
    expect(
      await screen.findByText(
        'Sent to Jo Sample and mia.sample@example.com on 26 Nov 2026 at 9:12 am, by Al Sample.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('Sent')).toBeInTheDocument()
    expect(
      screen.getByText("Writing to HubSpot isn't on yet, so the copy waits."),
    ).toBeInTheDocument()
    expect(
      screen.getByText('A change makes it a draft again, so you can send the new words.'),
    ).toBeInTheDocument()

    // A change: the server makes it a draft again, and the page says when it was last sent.
    await user.type(screen.getByRole('textbox', { name: 'Ideal next step' }), ' Bring the plans.')
    await user.tab()
    expect(await screen.findByText('Draft ready')).toBeInTheDocument()
    expect(
      screen.getByText(/^Last sent to Jo Sample and mia\.sample@example\.com/),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        "It changed after it was sent, so it's a draft again. Send it again to share the new words.",
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText("Writing to HubSpot isn't on yet, so the copy waits.")).toBeNull()
  })
})

describe('the states', () => {
  it.each(['missing', 'bad-id'] as const)(
    'not there (%s): plain words, and the way back to Meetings',
    async (get) => {
      mockServer({ get })
      renderPreRead()
      expect(
        await screen.findByRole('heading', { level: 1, name: "We can't find that pre-read" }),
      ).toBeInTheDocument()
      expect(
        screen.getByText(/It may have been removed, or the link is wrong\./),
      ).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Back to Meetings' })).toHaveAttribute(
        'href',
        '/companies/meetings',
      )
    },
  )

  it('pre-meeting forms switched off: the words Meetings uses, and the way back', async () => {
    mockServer({ get: 'off' })
    renderPreRead()
    expect(
      await screen.findByRole('heading', { name: 'Pre-meeting forms are switched off.' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Pre-read' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to Meetings' })).toHaveAttribute(
      'href',
      '/companies/meetings',
    )
  })

  it('any other failure: the error box, in plain words, with Try again', async () => {
    mockServer({ get: 'broken' })
    renderPreRead()
    expect(await screen.findByText("This pre-read couldn't be loaded.")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it("the route's prefetch asks for the form in the address, and nothing else", async () => {
    const server = mockServer()
    const client = createTestQueryClient()
    prefetchPage(routes, { pathname: `/companies/meetings/${FORM_ID}`, search: '' }, client)
    // The prefetch loads its own small file first.
    await waitFor(() => {
      expect(server.calls).toHaveLength(1)
    })
    expect(server.calls.map((call) => call.path)).toEqual([FORM])
  })
})

describe('a status that changes', () => {
  function Status({ word }: { word: string }) {
    return <FadeSwap swapKey={word}>{word}</FadeSwap>
  }

  /** motion's features, there from the start, as the app has them right after it opens. */
  function WithFeatures({ children }: { children: ReactNode }) {
    return (
      <MotionRoot>
        <LazyMotion features={domMax} strict>
          {children}
        </LazyMotion>
      </MotionRoot>
    )
  }

  it('fades the old word out, then the new one in', async () => {
    const { rerender } = render(<Status word="Draft ready" />, { wrapper: WithFeatures })
    rerender(<Status word="Sent" />)
    expect(screen.getByText('Draft ready')).toBeInTheDocument()
    expect(screen.queryByText('Sent')).toBeNull()
    expect(await screen.findByText('Sent')).toBeInTheDocument()
    expect(screen.queryByText('Draft ready')).toBeNull()
  })

  it('simply swaps with reduced motion', () => {
    askForReducedMotion()
    const { rerender } = render(<Status word="Draft ready" />, { wrapper: WithFeatures })
    rerender(<Status word="Sent" />)
    expect(screen.getByText('Sent')).toBeInTheDocument()
    expect(screen.queryByText('Draft ready')).toBeNull()
  })
})
