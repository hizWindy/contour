/**
 * The pre-read's page (PLAN-V17 T3-10, and the centered form of PLAN-V18 T2-5), against the
 * contract and a fake server that keeps its pre-read between requests and answers as Track 2's
 * does: a summary the rep changes is theirs (`by: person`) and a redraft keeps it, a blank is
 * tidied, and a change to a sent pre-read makes it a draft again.
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
} from '@/api/types'
import { MotionRoot } from '@/components/motion'
import { REDUCED_MOTION } from '@/lib/use-media-query'
import { routes } from '@/router'
import { prefetchPage } from '@/shell/prefetch'
import { createTestQueryClient, renderWithProviders } from '@/test/render'
import { asPhone } from '@/test/screen'
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
  /** How PATCH answers: at once, after `release()`, a fault the first time, or one after `release()`. */
  patch: 'ok' | 'wait' | 'fail-once' | 'wait-then-fail'
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
          // Track 1's words (`meeting_form.py`), word for word.
          return problem(
            404,
            "We can't find that pre-read",
            "It may have been removed, or it isn't open to your account. Go back to Meetings and open it again.",
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
      if (server.patch === 'wait' || server.patch === 'wait-then-fail') {
        await new Promise<void>((resolve) => {
          server.release = resolve
        })
      }
      if (server.patch === 'wait-then-fail') return FAULT()
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
          more_companies: false,
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

/** One summary, found by its box's label. */
function summaryOf(title: string) {
  const block = screen.getByLabelText(title).closest('[data-slot=summary]')
  if (!(block instanceof HTMLElement)) throw new Error(`No summary called ${title}`)
  return within(block)
}

/** The form's footer: the status, and Check and send. */
function footerOf(): HTMLElement {
  const footer = document.querySelector('[data-slot=send-bar]')
  if (!(footer instanceof HTMLElement)) throw new Error('No footer')
  return footer
}

/** The draft's steps (PLAN-V18 T2-4), each with its state: done, now, waiting or stopped. */
function steps(): Record<string, string | undefined> {
  const list = screen.getByRole('list', { name: 'How the draft is going' })
  return Object.fromEntries(
    within(list)
      .getAllByRole('listitem')
      .map((item) => [item.textContent.split(',')[0] ?? '', item.dataset.state]),
  )
}

/** The page's header: the meeting, its company, and the status. */
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

describe('the form', () => {
  it('is one centered card in four numbered sections, with its footer at the end', async () => {
    mockServer()
    renderPreRead()
    await screen.findByRole('heading', { level: 1, name: 'Office walk-through' })
    const card = screen.getByRole('article', { name: 'Pre-read' })
    // About 840px wide, in the middle of the page (TBC after Al-khair's look).
    expect(card.parentElement).toHaveClass('mx-auto', 'max-w-[52.5rem]')
    expect(card).toHaveClass('rounded-lg', 'border', 'bg-card')
    // The four sections, each a heading for a screen reader, its number for the eye only.
    const sections = within(card).getAllByRole('region')
    expect(sections.map((section) => section.getAttribute('aria-labelledby') !== null)).toEqual([
      true,
      true,
      true,
      true,
    ])
    expect(
      within(card)
        .getAllByRole('heading', { level: 2 })
        .map((heading) => heading.textContent),
    ).toEqual(['1The meeting', '2The company', '3The summaries', '4Your part'])
    expect(
      within(card)
        .getAllByRole('heading', { level: 2 })
        .map((heading) => heading.querySelector('[aria-hidden=true]')?.textContent),
    ).toEqual(['1', '2', '3', '4'])
    expect(screen.getByRole('region', { name: 'The meeting' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Your part' })).toBeInTheDocument()
    // The footer is the card's last part, with the status on the left and the one Navy button.
    const footer = footerOf()
    expect(card.lastElementChild).toBe(footer)
    expect(footer).toHaveClass('sticky', 'bottom-0')
    expect(within(footer).getByText('Draft ready')).toBeInTheDocument()
    expect(within(footer).getByRole('button', { name: 'Check and send' })).toHaveAttribute(
      'data-variant',
      'default',
    )
    expect(
      [...document.querySelectorAll('[data-slot=button][data-variant=default]')].map(
        (button) => button.textContent,
      ),
    ).toEqual(['Check and send'])
  })

  it('shows the meeting and the company as quiet fields, each with its label above and its source', async () => {
    mockServer()
    renderPreRead()
    await screen.findByRole('heading', { level: 1, name: 'Office walk-through' })
    // The header: the company (a link to its record), and the status on a line of its own, so a
    // new word moves nothing. When and where are the form's to say, once.
    const header = within(pageHeader())
    expect(header.getByRole('link', { name: 'Sample Logistics Pty Ltd' })).toHaveAttribute(
      'href',
      '/companies/101',
    )
    expect(header.queryByText(WHEN)).toBeNull()
    expect(pageHeader()).toHaveClass('flex-col')
    const statusLine = pageHeader().querySelector('[data-slot=pre-read-status-line]')
    expect(statusLine).toHaveTextContent('Draft ready')
    expect(statusLine).not.toContainElement(header.getByRole('heading', { level: 1 }))
    // HubSpot's link comes from the meeting itself, and opens in a new tab.
    const hubspot = await screen.findByRole('link', { name: /^Open in HubSpot/ })
    expect(hubspot).toHaveAttribute('href', HUBSPOT_URL)
    expect(hubspot).toHaveAttribute('target', '_blank')

    // 1 The meeting: the date and the time apart, where, who we meet and the Contour people.
    const meeting = within(screen.getByRole('region', { name: 'The meeting' }))
    expect(meeting.getAllByRole('term').map((term) => term.textContent)).toEqual([
      'Date',
      'Time',
      'Teams or in person',
      'Who we meet',
      'Contour people',
    ])
    expect(meeting.getByText(/^Fri 27 Nov( 2026)?$/)).toBeInTheDocument()
    expect(meeting.getByText('10:00 am to 11:00 am')).toBeInTheDocument()
    expect(meeting.getByText('Online')).toBeInTheDocument()
    expect(meeting.getByText('Sam Sample (Office Manager)')).toBeInTheDocument()
    expect(meeting.getAllByText('HubSpot meeting')[0]).toHaveClass('text-muted-foreground')

    // 2 The company: the company, then the server's facts, in its order.
    const company = within(screen.getByRole('region', { name: 'The company' }))
    expect(company.getByText('From HubSpot and our notes, with no AI.')).toBeInTheDocument()
    expect(company.getAllByRole('term').map((term) => term.textContent)).toEqual([
      'Company',
      'Staff',
      'Offices',
      'Lease end',
      'Deal stage',
    ])
    expect(company.getByRole('link', { name: 'Sample Logistics Pty Ltd' })).toHaveAttribute(
      'href',
      '/companies/101',
    )
    expect(company.getByText('About 300')).toBeInTheDocument()
    expect(company.getByText('HubSpot company')).toHaveClass('text-muted-foreground')
    // Fields that can be read are never boxes to type into.
    expect(meeting.queryByRole('textbox')).toBeNull()
    expect(company.queryByRole('textbox')).toBeNull()
  })

  it("has three summaries to type into, each marked as the AI's, with its sources, and Redraft", async () => {
    mockServer()
    renderPreRead()
    await screen.findByRole('heading', { level: 1, name: 'Office walk-through' })
    const written: [string, string, string][] = [
      ['What they do', 'A freight company with about 300 staff.', 'F1'],
      ['What we know about the project', 'Their Perth lease ends in June 2028.', 'F2'],
      ['The talks so far', 'Jo called Sam in October about the Perth move.', 'F3'],
    ]
    for (const [title, words, chip] of written) {
      const one = summaryOf(title)
      // A box with its label above it, typed into directly: no pencil.
      expect(one.getByRole('textbox', { name: title })).toHaveValue(words)
      expect(one.getByText('Written by AI')).toBeInTheDocument()
      expect(one.getByText(chip)).toBeInTheDocument()
      expect(one.queryByRole('button', { name: /^Edit / })).toBeNull()
    }
    expect(screen.getByText('Source: Call with Sam Sample, 20 Oct 2026')).toBeInTheDocument()
    // Redraft says what one draft costs by the plan's estimate, that edits stay, and what the
    // drafts have cost so far (the server's total).
    const redraft = screen.getByRole('button', { name: 'Redraft (under US$0.01)' })
    expect(redraft).toBeEnabled()
    expect(redraft).toHaveAccessibleDescription(
      'It writes the three summaries again. Your edits are kept. US$0.03 so far.',
    )
  })

  it('has two required blanks, starred, and Check and send waits for them', async () => {
    mockServer()
    renderPreRead()
    await screen.findByRole('heading', { level: 1, name: 'Office walk-through' })
    for (const name of ['Ideal next step', 'Who is going']) {
      const blank = screen.getByRole('textbox', { name })
      expect(blank).toHaveValue('')
      // A screen reader hears "required"; the eye sees the star, which a screen reader skips.
      expect(blank).toBeRequired()
      const label = document.querySelector(`label[for="${blank.id}"]`)
      expect(label?.querySelector('[data-slot=required-star]')).toHaveAttribute(
        'aria-hidden',
        'true',
      )
    }
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
        facts: [],
      }),
    })
    renderPreRead()
    await screen.findByRole('heading', { level: 1, name: 'Office walk-through' })
    for (const link of screen.getAllByRole('link', { name: 'Sample Logistics Pty Ltd' })) {
      expect(link).toHaveAttribute('href', '/companies/lead%3A7')
    }
    expect(screen.queryByRole('link', { name: /Open in HubSpot/ })).toBeNull()
    expect(server.calls.map((call) => call.path)).toEqual([FORM])
    // Its own copy says when and where, typed in.
    const meeting = within(screen.getByRole('region', { name: 'The meeting' }))
    expect(meeting.getByText('In person')).toBeInTheDocument()
    expect(meeting.getAllByText('Typed in')).toHaveLength(3)
  })

  it('an empty summary says so in its box, with no mark', async () => {
    mockServer({ form: form({ summaries: { ...WRITTEN, talks_so_far: EMPTY } }) })
    renderPreRead()
    await screen.findByRole('heading', { level: 1, name: 'Office walk-through' })
    const talks = summaryOf('The talks so far')
    expect(talks.getByRole('textbox', { name: 'The talks so far' })).toHaveAttribute(
      'placeholder',
      'Nothing in the facts for this yet. Write it here.',
    )
    // The AI wrote nothing here, so nothing is marked as its own.
    expect(talks.queryByText('Written by AI')).toBeNull()
  })

  it('Ctrl+Enter opens Check and send, or goes to the first blank still to fill', async () => {
    mockServer()
    const { user } = renderPreRead()
    await screen.findByRole('heading', { level: 1, name: 'Office walk-through' })
    const what = screen.getByRole('textbox', { name: 'What they do' })
    what.focus()
    await user.keyboard('{Control>}{Enter}{/Control}')
    expect(screen.getByRole('textbox', { name: 'Ideal next step' })).toHaveFocus()
    await user.type(screen.getByRole('textbox', { name: 'Ideal next step' }), 'Site visit.')
    await user.keyboard('{Control>}{Enter}{/Control}')
    expect(screen.getByRole('textbox', { name: 'Who is going' })).toHaveFocus()
    await user.type(screen.getByRole('textbox', { name: 'Who is going' }), 'Jo Sample')
    await user.keyboard('{Control>}{Enter}{/Control}')
    expect(
      await screen.findByRole('alertdialog', { name: 'Send the pre-read?' }),
    ).toBeInTheDocument()
  })

  it('on a phone: one column, and the footer fixed above the safe area', async () => {
    asPhone()
    mockServer()
    renderPreRead()
    await screen.findByRole('heading', { level: 1, name: 'Office walk-through' })
    const footer = footerOf()
    expect(footer).toHaveClass('fixed', 'bottom-0', 'pb-[max(0.75rem,env(safe-area-inset-bottom))]')
    expect(footer).not.toHaveClass('sticky')
    // The page ends above the footer, so its last field is never under it.
    expect(screen.getByRole('article', { name: 'Pre-read' }).parentElement).toHaveClass('pb-36')
    // One column: the grids have two only from the small screen up.
    for (const grid of document.querySelectorAll('[data-slot=pre-read-form] dl')) {
      expect(grid).toHaveClass('grid', 'sm:grid-cols-2')
      expect(grid.className).not.toMatch(/(?<!:)grid-cols-2/)
    }
  })

  it('opens once: the four sections rise and fade in one after another, and the footer stays still', async () => {
    mockServer()
    renderPreRead()
    await screen.findByRole('heading', { level: 1, name: 'Office walk-through' })
    const card = screen.getByRole('article', { name: 'Pre-read' })
    const reveals = [...card.querySelectorAll('[data-slot=reveal]')]
    expect(reveals).toHaveLength(4)
    expect(footerOf().closest('[data-slot=reveal]')).toBeNull()
  })

  it('is simply there with reduced motion', async () => {
    askForReducedMotion()
    mockServer()
    renderPreRead()
    await screen.findByRole('heading', { level: 1, name: 'Office walk-through' })
    for (const reveal of document.querySelectorAll('[data-slot=reveal]')) {
      expect(reveal).not.toHaveStyle({ opacity: '0' })
    }
  })
})

describe('a summary typed into', () => {
  it('is "Edited by you" as soon as it changes, saves when it is left, and a redraft keeps it', async () => {
    const server = mockServer({ patch: 'wait' })
    const { user } = renderPreRead()
    await screen.findByRole('heading', { level: 1, name: 'Office walk-through' })
    const words = 'The Perth lease ends 30 June 2028, and they want to move early.'
    const box = summaryOf('What we know about the project').getByRole('textbox', {
      name: 'What we know about the project',
    })
    await user.clear(box)
    await user.type(box, words)
    // At once, before it is saved: the mark turns.
    expect(
      await summaryOf('What we know about the project').findByText('Edited by you'),
    ).toBeInTheDocument()
    expect(patches(server)).toEqual([])
    // Left: it saves.
    await user.tab()
    await waitFor(() => {
      expect(patches(server)).toEqual([{ summaries: { what_we_know: words } }])
    })
    expect(summaryOf('What we know about the project').getByText('Saving.')).toBeInTheDocument()
    server.release()
    expect(await summaryOf('What we know about the project').findByText('Saved.')).toBeVisible()
    // The footer says when it was last saved.
    expect(within(footerOf()).getByText(/^Draft ready, saved \d{1,2}:\d{2} [ap]m$/)).toBeVisible()

    // Redraft: the AI's two go still and grey while they are written; the rep's stays a box.
    server.patch = 'ok'
    await user.click(screen.getByRole('button', { name: 'Redraft (under US$0.01)' }))
    expect(await within(pageHeader()).findByText('Drafting')).toBeInTheDocument()
    expect(server.calls.filter((call) => call.path === REDRAFT)).toHaveLength(1)
    expect(stillBlocks()).toBe(2)
    expect(
      screen.getByRole('heading', { name: 'AI is drafting this pre-read' }),
    ).toBeInTheDocument()
    expect(box).toHaveValue(words)
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
      await screen.findByDisplayValue('A freight and storage company.', {}, { timeout: 4000 }),
    ).toBeInTheDocument()
    expect(screen.getByDisplayValue('Sam asked for a proposal by December.')).toBeInTheDocument()
    expect(box).toHaveValue(words)
    expect(
      summaryOf('What we know about the project').getByText('Edited by you'),
    ).toBeInTheDocument()
    expect(stillBlocks()).toBe(0)
    expect(await within(pageHeader()).findByText('Draft ready')).toBeInTheDocument()
    // Two drafts so far: the button still says one draft's cost, the line what both cost.
    expect(
      screen.getByRole('button', { name: 'Redraft (under US$0.01)' }),
    ).toHaveAccessibleDescription(
      'It writes the three summaries again. Your edits are kept. US$0.06 so far.',
    )
  }, 15_000)

  it('left as it was, sends nothing', async () => {
    const server = mockServer()
    const { user } = renderPreRead()
    await screen.findByRole('heading', { level: 1, name: 'Office walk-through' })
    await user.click(screen.getByRole('textbox', { name: 'What they do' }))
    await user.tab()
    expect(patches(server)).toEqual([])
    expect(summaryOf('What they do').getByText('Written by AI')).toBeInTheDocument()
  })

  it('a refused save keeps the words, says why, and Try again sends them again', async () => {
    const server = mockServer({ patch: 'fail-once' })
    const { user } = renderPreRead()
    await screen.findByRole('heading', { level: 1, name: 'Office walk-through' })
    const box = screen.getByRole('textbox', { name: 'What they do' })
    await user.type(box, ' Mostly freight.')
    await user.tab()
    const why = await summaryOf('What they do').findByRole('alert')
    expect(why).toHaveTextContent('Something went wrong on our side. Not saved yet. Try again.')
    expect(box).toHaveValue('A freight company with about 300 staff. Mostly freight.')
    expect(box).toHaveAttribute('aria-invalid', 'true')
    await user.click(summaryOf('What they do').getByRole('button', { name: 'Try again' }))
    expect(await summaryOf('What they do').findByText('Saved.')).toBeInTheDocument()
    expect(patches(server)).toHaveLength(2)
    expect(server.form.summaries.what_they_do).toMatchObject({
      text: 'A freight company with about 300 staff. Mostly freight.',
      by: 'person',
    })
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

describe('a save that fails after the rep has left the page', () => {
  const LEFT_WHY =
    'Something went wrong on our side. Open the pre-read for Sample Logistics Pty Ltd and write it again.'

  it('a blank says so in a toast, naming it and the pre-read', async () => {
    const server = mockServer({ patch: 'wait-then-fail' })
    const { user, router } = renderPreRead()
    await screen.findByRole('heading', { level: 1, name: 'Office walk-through' })
    await user.type(screen.getByRole('textbox', { name: 'Ideal next step' }), 'Book a visit.')
    await user.tab()
    await waitFor(() => {
      expect(patches(server)).toHaveLength(1)
    })
    // Back to Meetings while it saves: the page that would say so is gone.
    await act(async () => {
      await router.navigate('/companies/meetings')
    })
    await screen.findByRole('heading', { level: 1, name: 'Client meetings' })
    server.release()
    expect(await screen.findByText(`"Ideal next step" wasn't saved`)).toBeInTheDocument()
    expect(screen.getByText(LEFT_WHY)).toBeInTheDocument()
  })

  it('a summary says so in a toast too', async () => {
    const server = mockServer({ patch: 'wait-then-fail' })
    const { user, router } = renderPreRead()
    await screen.findByRole('heading', { level: 1, name: 'Office walk-through' })
    await user.type(screen.getByRole('textbox', { name: 'What they do' }), ' Mostly freight.')
    await user.tab()
    await waitFor(() => {
      expect(patches(server)).toHaveLength(1)
    })
    await act(async () => {
      await router.navigate('/companies/meetings')
    })
    await screen.findByRole('heading', { level: 1, name: 'Client meetings' })
    server.release()
    expect(await screen.findByText(`"What they do" wasn't saved`)).toBeInTheDocument()
    expect(screen.getByText(LEFT_WHY)).toBeInTheDocument()
  })
})

describe('while it drafts', () => {
  it('fills each step as its real state arrives, asks every 2 seconds, and stops once it is ready', async () => {
    const server = mockServer({
      form: form(),
      next: [drafting(), drafting({ facts: FACTS }), form()],
    })
    const { user } = renderPreRead()
    // AI drafts it, and the rep checks it before anyone gets it (PLAN-V18 T2-4).
    const progress = await screen.findByRole('region', { name: 'AI is drafting this pre-read' })
    expect(progress).toHaveTextContent('You check it before anyone gets it.')
    expect(within(pageHeader()).getByText('Drafting')).toBeInTheDocument()
    // No facts yet: HubSpot is being read.
    expect(steps()).toEqual({
      'Reading HubSpot': 'now',
      'Writing the summaries': 'waiting',
      'Ready for you to check': 'waiting',
    })
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

    // 2 seconds later: the facts, so the summaries are being written. Never on a timer: the step
    // moved with the answer that brought the facts.
    expect(await screen.findByText('About 300', {}, { timeout: 4000 })).toBeInTheDocument()
    expect(reads(server)).toBe(2)
    expect(steps()).toEqual({
      'Reading HubSpot': 'done',
      'Writing the summaries': 'now',
      'Ready for you to check': 'waiting',
    })
    expect(stillBlocks()).toBe(3)

    // 2 more: the summaries, and the draft is ready. The steps stay, full.
    expect(
      await screen.findByDisplayValue(
        'A freight company with about 300 staff.',
        {},
        { timeout: 4000 },
      ),
    ).toBeInTheDocument()
    expect(reads(server)).toBe(3)
    expect(stillBlocks()).toBe(0)
    expect(await within(pageHeader()).findByText('Draft ready')).toBeInTheDocument()
    expect(steps()).toEqual({
      'Reading HubSpot': 'done',
      'Writing the summaries': 'done',
      'Ready for you to check': 'done',
    })
    expect(screen.getByRole('region', { name: 'AI drafted this pre-read' })).toBeInTheDocument()

    // Then it stops asking.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2500))
    })
    expect(reads(server)).toBe(3)
  }, 15_000)

  it('shows no steps on a pre-read that opens ready: there was nothing to watch', async () => {
    mockServer()
    renderPreRead()
    await screen.findByRole('heading', { level: 1, name: 'Office walk-through' })
    expect(screen.queryByRole('list', { name: 'How the draft is going' })).toBeNull()
  })
})

describe('a failed draft', () => {
  it('stops the steps where it failed, says why in plain words, with Try again and what it costs', async () => {
    // Track 1's words for a fault on its side (`meeting_form.py`), word for word. They don't say
    // what wasn't written, so the page says that first.
    const server = mockServer({
      form: form({
        status: 'failed',
        error: 'Something went wrong on our side while writing the summaries. Try again.',
        summaries: NONE_WRITTEN,
        next_step: 'Book a site visit.',
        going: 'Jo Sample',
      }),
    })
    const { user } = renderPreRead()
    const notice = await screen.findByRole('alert')
    expect(notice.textContent).toBe(
      "The summaries weren't written. Something went wrong on our side while writing the summaries. Try again.",
    )
    expect(within(pageHeader()).getByText('Draft failed')).toBeInTheDocument()
    // The facts were read: it stopped while writing the summaries.
    expect(steps()).toEqual({
      'Reading HubSpot': 'done',
      'Writing the summaries': 'stopped',
      'Ready for you to check': 'waiting',
    })
    const progress = screen.getByRole('region', { name: 'The draft stopped' })
    // The summaries stay, empty, so the rep can write them; Try again is the one redraft.
    for (const title of ['What they do', 'What we know about the project', 'The talks so far']) {
      expect(screen.getByRole('textbox', { name: title })).toHaveValue('')
    }
    expect(screen.queryByRole('button', { name: /^Redraft/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Check and send' })).toHaveAccessibleDescription(
      "The summaries weren't written. Try again first.",
    )

    const tryAgain = within(progress).getByRole('button', { name: 'Try again (under US$0.01)' })
    expect(tryAgain).toHaveAccessibleDescription(
      'It writes the three summaries again. Your edits are kept. US$0.03 so far.',
    )
    await user.click(tryAgain)
    expect(
      await screen.findByRole('region', { name: 'AI is drafting this pre-read' }),
    ).toBeInTheDocument()
    expect(server.calls.filter((call) => call.path === REDRAFT)).toHaveLength(1)
    expect(stillBlocks()).toBe(3)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it("says the server's own sentence as it is, and stops at Reading HubSpot before the facts", async () => {
    const limit =
      "The summaries weren't written: today's AI spending limit is reached. Write them yourself, or draft again tomorrow."
    mockServer({
      form: form({ status: 'failed', error: limit, facts: [], summaries: NONE_WRITTEN }),
    })
    renderPreRead()
    expect(await screen.findByRole('alert')).toHaveTextContent(limit)
    expect(screen.getByRole('alert').textContent).toBe(limit)
    expect(steps()).toEqual({
      'Reading HubSpot': 'stopped',
      'Writing the summaries': 'waiting',
      'Ready for you to check': 'waiting',
    })
  })
})

describe('words for when things go wrong (PLAN-V18 T2-7)', () => {
  it.each([
    [
      'the AI limit',
      "The summaries weren't written: today's AI spending limit is reached. Write them yourself, or draft again tomorrow.",
    ],
    [
      'the AI service',
      "The summaries weren't written: the AI service didn't answer. Try again in a minute, or write them yourself.",
    ],
  ])(
    "the draft failed for %s: the server's sentence as it is, Try again, and the boxes to write in",
    async (_, words) => {
      mockServer({ form: form({ status: 'failed', error: words, summaries: NONE_WRITTEN }) })
      renderPreRead()
      const alert = await screen.findByRole('alert')
      expect(alert.textContent).toBe(words)
      const progress = screen.getByRole('region', { name: 'The draft stopped' })
      expect(
        within(progress).getByRole('button', { name: 'Try again (under US$0.01)' }),
      ).toBeEnabled()
      expect(screen.getByRole('textbox', { name: 'What they do' })).toBeEnabled()
    },
  )
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
    expect(within(pageHeader()).getByText('Sent')).toBeInTheDocument()
    expect(
      screen.getByText("Writing to HubSpot isn't on yet, so the copy waits."),
    ).toBeInTheDocument()
    expect(
      screen.getByText('A change makes it a draft again, so you can send the new words.'),
    ).toBeInTheDocument()
    // Sent and unchanged: nothing to send (T3-11).
    expect(screen.queryByRole('button', { name: 'Check and send' })).toBeNull()

    // A change: the server makes it a draft again, and the page says when it was last sent.
    await user.type(screen.getByRole('textbox', { name: 'Ideal next step' }), ' Bring the plans.')
    await user.tab()
    expect(await within(pageHeader()).findByText('Draft ready')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Check and send' })).toBeEnabled()
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
      // In the page's own frame, as the switched-off state is, in the serif voice.
      expect(
        await screen.findByRole('heading', { level: 2, name: "We can't find that pre-read." }),
      ).toHaveClass('font-serif')
      expect(screen.getByRole('heading', { level: 1, name: 'Pre-read' })).toBeInTheDocument()
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
