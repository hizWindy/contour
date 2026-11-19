/**
 * Today (PLAN-V22 T2-2) against a fake server: each part, each state, Done with Undo (and each way
 * it can fail), Sync with "Checked 8:12 am", each key (J, K, Enter, D, L), V on a row, and "Speak"
 * pinned at the bottom of a phone. Made-up names only: Sample Logistics Pty Ltd, Vitera Pty Ltd,
 * Jo Sample.
 */
import { act, screen, waitFor, within } from '@testing-library/react'
import { useLocation } from 'react-router'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SignIn } from '@/api/hooks/auth'
import { queryKeys } from '@/api/query'
import type { CallNoteOptions, Today } from '@/api/types'
import { mockApi, type Answer, type Call } from '@/test/mock-api'
import { createTestQueryClient, renderWithProviders } from '@/test/render'
import { asPhone } from '@/test/screen'
import { onScreen, showOnScreen } from '../voice/on-screen'
import { closeVoiceBar, isVoiceBarOpen } from '../voice/store'
import { TEST_NOW, today } from './fixtures'
import TodayPage from './index'

const TODAY = '/api/v1/companies/assistant/today'
const TASKS = '/api/v1/companies/assistant/tasks'
const OPTIONS = '/api/v1/companies/call-notes/options'
const FORMS = '/api/v1/companies/meetings/forms'

function options(): CallNoteOptions {
  return {
    enabled: true,
    ai_enabled: true,
    sending_ready: true,
    waiting_for: null,
    outcomes: ['Connected', 'No answer'],
    fields: [],
    soft_seconds: 180,
    max_chars: 6000,
    voice_tool: 'browser_service',
  }
}

const VIEWER: SignIn = {
  state: 'signed_in',
  user: {
    id: '11111111-2222-3333-4444-555555555555',
    email: 'jo@example.test',
    username: 'jo',
    name: 'Jo Sample',
    position: null,
    role: 'viewer',
    apps: ['companies'],
    features: ['companies.call_logs', 'companies.meetings'],
  },
}

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>
}

function noContent(): Response {
  return new Response(null, { status: 204 })
}

/**
 * The server's tasks, which remember a Done and a reopen as HubSpot would, so reading Today again
 * after a Done doesn't bring the task back.
 */
function taskServer(): Pick<Open, 'answer' | 'more'> {
  const done = new Set<string>()
  const change =
    (id: string, isDone: boolean): Answer =>
    () => {
      if (isDone) done.add(id)
      else done.delete(id)
      return noContent()
    }
  return {
    answer: () => Response.json(today({ tasks: today().tasks.filter((one) => !done.has(one.id)) })),
    more: {
      [`${TASKS}/t1/done`]: change('t1', true),
      [`${TASKS}/t1/reopen`]: change('t1', false),
    },
  }
}

function refusal(status: number, code: string): Response {
  return Response.json(
    { title: "That didn't work", status, detail: 'Try again.', code },
    { status },
  )
}

interface Open {
  /** Today's answer, or a function of the call. */
  answer?: Today | Answer
  /** More answers by path. */
  more?: Record<string, unknown>
  signIn?: SignIn
}

function openToday({ answer = today(), more = {}, signIn = { state: 'off' } }: Open = {}) {
  const calls = mockApi({ [TODAY]: answer, [OPTIONS]: options(), ...more })
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(queryKeys.auth.me(), signIn)
  const view = renderWithProviders(
    <>
      <TodayPage />
      <Where />
    </>,
    { queryClient, route: '/assistant' },
  )
  const posts = (path: string): Call[] =>
    calls.filter((call) => call.method === 'POST' && call.path === path)
  return { calls, posts, ...view }
}

/** One part of the day, by its title. */
async function part(title: string) {
  return within(await screen.findByRole('region', { name: title }))
}

function row(name: string): HTMLElement {
  return screen.getByRole('article', { name })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: TEST_NOW })
})

afterEach(() => {
  // Sonner keeps toasts in one store for the whole file.
  toast.dismiss()
  showOnScreen(null)
  act(() => {
    closeVoiceBar()
  })
})

describe('the four parts, the most urgent first (choice 6)', () => {
  it('show the tasks overdue, then today’s, with the next 7 days folded', async () => {
    const { user } = openToday()
    const tasks = await part('Your HubSpot tasks')
    expect(tasks.getByRole('heading', { name: 'Overdue' })).toBeInTheDocument()
    expect(tasks.getByRole('heading', { name: 'Due today' })).toBeInTheDocument()
    const first = row('Call: Call Jo Sample about the quote')
    expect(within(first).getByText('Sample Logistics Pty Ltd')).toBeInTheDocument()
    expect(within(first).getByText('Overdue, due Tue 17 Nov')).toBeInTheDocument()
    // Folded: its count shows, its rows don't.
    expect(screen.queryByRole('article', { name: 'To-do: Book the site visit' })).toBeNull()
    await user.click(tasks.getByRole('button', { name: 'Next 7 days (1)' }))
    expect(row('To-do: Book the site visit')).toBeInTheDocument()
  })

  it('show "Open in HubSpot" only where HubSpot gave a link', async () => {
    openToday()
    await part('Your HubSpot tasks')
    expect(
      within(row('Call: Call Jo Sample about the quote')).getByRole('link', {
        name: /Open in HubSpot: Call Jo Sample about the quote/,
      }),
    ).toHaveAttribute('target', '_blank')
    expect(
      within(row('Email: Email the floor plan')).queryByRole('link', { name: /Open in HubSpot/ }),
    ).toBeNull()
  })

  it('show the meetings today and tomorrow, each with its pre-read’s state', async () => {
    openToday()
    const meetings = await part('Your meetings today and tomorrow')
    expect(meetings.getByRole('heading', { name: 'Today' })).toBeInTheDocument()
    expect(meetings.getByRole('heading', { name: 'Tomorrow' })).toBeInTheDocument()
    const first = meetings.getByRole('article', { name: '10:00 am Vitera Pty Ltd' })
    expect(within(first).getByText('10:00 am')).toBeInTheDocument()
    expect(within(first).getByText('Needs pre-read')).toBeInTheDocument()
    expect(within(first).getByRole('button', { name: /Draft the pre-read/ })).toBeInTheDocument()
    const second = meetings.getByRole('article', { name: '2:00 pm Sample Logistics Pty Ltd' })
    expect(within(second).getByText('Draft ready')).toBeInTheDocument()
    expect(within(second).getByRole('link', { name: /Check and send/ })).toHaveAttribute(
      'href',
      '/assistant/meetings/0f3c9a2e-1111-2222-3333-444444444444',
    )
  })

  it('show the calls to confirm and those that need a look, each opening its tab', async () => {
    openToday()
    const calls = await part('Calls to confirm')
    expect(
      within(calls.getByRole('article', { name: '3 calls to confirm' })).getByRole('link', {
        name: /Open/,
      }),
    ).toHaveAttribute('href', '/assistant/call-logs')
    expect(
      within(calls.getByRole('article', { name: '1 needs a look' })).getByRole('link', {
        name: /Open/,
      }),
    ).toHaveAttribute('href', '/assistant/call-logs?tab=needs-look')
  })

  it('show the deals that need a nudge, with why', async () => {
    openToday({ answer: today({ deals_more: 4 }) })
    const deals = await part('Deals that need a nudge')
    const first = deals.getByRole('article', { name: 'Sample Logistics Pty Ltd Stage 2 fitout' })
    expect(within(first).getByText('Close date passed, 12 Nov')).toBeInTheDocument()
    expect(within(first).getByRole('link', { name: /^Open: / })).toHaveAttribute(
      'href',
      '/companies/201',
    )
    expect(deals.getByText('And 4 more deals that need a nudge.')).toBeInTheDocument()
  })

  it('show only the parts a person sees', async () => {
    openToday({ answer: today({ parts: ['meetings', 'calls'] }) })
    await part('Your meetings today and tomorrow')
    expect(screen.getByRole('region', { name: 'Calls to confirm' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Your HubSpot tasks' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Deals that need a nudge' })).toBeNull()
  })
})

describe('every state', () => {
  it('loading: the shape of the day, still, and only after 200ms', async () => {
    // A server that never answers.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => undefined)),
    )
    const queryClient = createTestQueryClient()
    queryClient.setQueryData(queryKeys.auth.me(), { state: 'off' })
    renderWithProviders(<TodayPage />, { queryClient })
    const label = screen.getByText('Loading your day.')
    const blocks = label.parentElement?.querySelector('[aria-hidden="true"]')
    expect(blocks).toHaveClass('invisible')
    await waitFor(() => {
      expect(blocks).not.toHaveClass('invisible')
    })
  })

  it('empty: nothing due today, in the serif voice, with what to do', async () => {
    openToday({
      answer: today({
        tasks: [],
        meetings: [],
        calls: { to_confirm: 0, needs_look: 0 },
        deals: [],
      }),
    })
    const title = await screen.findByRole('heading', { name: 'Nothing due today.' })
    expect(title).toHaveClass('font-serif')
    expect(screen.getByText('Press V to log a call or add a task.')).toBeInTheDocument()
  })

  it('no HubSpot link: the server’s sentence, the rest still shows, and nothing to retry', async () => {
    const sentence = 'Today needs your account linked to HubSpot. Ask Sam Sample to link it.'
    openToday({
      answer: today({ tasks: [], tasks_state: 'no_owner', tasks_sentence: sentence }),
    })
    const tasks = await part('Your HubSpot tasks')
    expect(tasks.getByText(sentence)).toBeInTheDocument()
    expect(tasks.queryByRole('button', { name: 'Try again' })).toBeNull()
    expect(screen.getByRole('region', { name: 'Calls to confirm' })).toBeInTheDocument()
    // No time: no tasks were read.
    expect(screen.queryByText(/^Checked/)).toBeNull()
  })

  it('tasks can’t be read: the sentence, and Try again reads them again', async () => {
    const sentence = "We can't read your HubSpot tasks yet. Your meetings and calls still show."
    const { calls, user } = openToday({
      answer: (call) =>
        Response.json(
          call.search.includes('fresh=true')
            ? today()
            : today({ tasks: [], tasks_state: 'failed', tasks_sentence: sentence }),
        ),
    })
    const tasks = await part('Your HubSpot tasks')
    expect(tasks.getByText(sentence)).toBeInTheDocument()
    await user.click(tasks.getByRole('button', { name: 'Try again' }))
    expect(
      await screen.findByRole('article', { name: 'Call: Call Jo Sample about the quote' }),
    ).toBeInTheDocument()
    expect(calls.some((call) => call.path === TODAY && call.search === '?fresh=true')).toBe(true)
  })

  it('Today can’t load: says so, with Try again', async () => {
    openToday({ answer: () => refusal(500, 'internal') })
    expect(await screen.findByText("Today couldn't be loaded.")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Try again/ })).toBeInTheDocument()
  })
})

describe('Done and Undo (choice 7)', () => {
  it('Done ticks the task in HubSpot at once, and Undo opens it again', async () => {
    const { posts, user } = openToday(taskServer())
    await part('Your HubSpot tasks')
    const leaving = row('Call: Call Jo Sample about the quote')
    await user.click(within(leaving).getByRole('button', { name: /^Done: Call Jo Sample/ }))
    // It leaves at once: out of the keys' and a screen reader's reach while it fades, then gone.
    await waitFor(() => {
      expect(leaving.closest('[inert]')).not.toBeNull()
    })
    await waitFor(
      () => {
        expect(
          screen.queryByRole('article', { name: 'Call: Call Jo Sample about the quote' }),
        ).toBeNull()
      },
      { timeout: 5000 },
    )
    expect(posts(`${TASKS}/t1/done`)).toHaveLength(1)
    expect(
      await screen.findByText('Ticked done in HubSpot: Call Jo Sample about the quote'),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(
      await screen.findByRole('article', { name: 'Call: Call Jo Sample about the quote' }),
    ).toBeInTheDocument()
    await waitFor(() => {
      expect(posts(`${TASKS}/t1/reopen`)).toHaveLength(1)
    })
    expect(await screen.findByText('The task is open again in HubSpot.')).toBeInTheDocument()
  })

  it.each<[string, number, string, string]>([
    [
      'HubSpot writing is off',
      409,
      'hubspot_writing_off',
      'Changing HubSpot from Contour is off for now. Tick it in HubSpot.',
    ],
    [
      'the account isn’t linked',
      409,
      'no_hubspot_link',
      "Your account isn't linked to HubSpot yet. Ask the Platform admin to link it.",
    ],
    [
      'another rep’s task',
      403,
      'not_your_task',
      "That task isn't yours in HubSpot, so it wasn't changed.",
    ],
  ])(
    '%s: the task comes back, and a toast says why in a task’s words',
    async (_, status, code, words) => {
      const { user } = openToday({ more: { [`${TASKS}/t1/done`]: () => refusal(status, code) } })
      await part('Your HubSpot tasks')
      await user.click(
        within(row('Call: Call Jo Sample about the quote')).getByRole('button', {
          name: /^Done: Call Jo Sample/,
        }),
      )
      expect(await screen.findByText('The task is still open')).toBeInTheDocument()
      expect(screen.getByText(words)).toBeInTheDocument()
      expect(row('Call: Call Jo Sample about the quote')).toBeInTheDocument()
    },
  )

  it('a Viewer has no Done', async () => {
    openToday({ signIn: VIEWER })
    await part('Your HubSpot tasks')
    expect(screen.queryByRole('button', { name: /^Done/ })).toBeNull()
  })
})

describe('Sync (choice 7)', () => {
  it('reads the tasks again, and the line says when', async () => {
    const { calls, user } = openToday({
      answer: (call) =>
        Response.json(
          call.search.includes('fresh=true')
            ? today({ checked_at: '2026-11-19T09:30:00+11:00' })
            : today(),
        ),
    })
    expect(await screen.findByText('Checked 8:12 am')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Sync/ }))
    expect(await screen.findByText('Checked 9:30 am')).toBeInTheDocument()
    expect(calls.filter((call) => call.path === TODAY).map((call) => call.search)).toEqual([
      '',
      '?fresh=true',
    ])
  })
})

describe('the keys (choice 8)', () => {
  it('J and K move through the rows, and the active one is marked', async () => {
    const { user } = openToday()
    await part('Your HubSpot tasks')
    await user.keyboard('j')
    const first = row('Call: Call Jo Sample about the quote')
    expect(first).toHaveAttribute('aria-current', 'true')
    expect(first).toHaveFocus()
    await user.keyboard('j')
    expect(row('Email: Email the floor plan')).toHaveAttribute('aria-current', 'true')
    await user.keyboard('k')
    expect(first).toHaveAttribute('aria-current', 'true')
  })

  it('Enter does the row’s main button: here, Call logs’ tab', async () => {
    const { user } = openToday({ answer: today({ parts: ['calls'] }) })
    await part('Calls to confirm')
    await user.keyboard('j')
    await user.keyboard('{Enter}')
    expect(screen.getByTestId('where')).toHaveTextContent('/assistant/call-logs')
  })

  it('D ticks the active task done', async () => {
    const { posts, user } = openToday(taskServer())
    await part('Your HubSpot tasks')
    await user.keyboard('j')
    await user.keyboard('d')
    await waitFor(() => {
      expect(posts(`${TASKS}/t1/done`)).toHaveLength(1)
    })
    // The focus moves on with the active mark, to the next row.
    await waitFor(() => {
      expect(row('Email: Email the floor plan')).toHaveAttribute('aria-current', 'true')
    })
  })

  it('L logs a call with the row’s company', async () => {
    const { user } = openToday({ answer: today({ parts: ['deals'] }) })
    await part('Deals that need a nudge')
    await user.keyboard('j')
    await user.keyboard('l')
    const panel = await screen.findByRole('dialog', {}, { timeout: 5000 })
    expect(within(panel).getAllByText(/Sample Logistics Pty Ltd/).length).toBeGreaterThan(0)
  })

  it('V on a row that names no company uses the row’s company', async () => {
    const { user } = openToday({ answer: today({ parts: ['meetings'] }) })
    await part('Your meetings today and tomorrow')
    await user.keyboard('j')
    expect(onScreen()).toEqual({
      onPage: { company_key: '202', meeting_id: 'm1' },
      names: ['Vitera Pty Ltd'],
    })
  })

  it('Draft the pre-read starts it, then opens its page', async () => {
    const { posts, user } = openToday({
      more: {
        [FORMS]: () => Response.json({ id: 'f9', meeting: { meeting_id: 'm1' } }),
      },
    })
    const meetings = await part('Your meetings today and tomorrow')
    await user.click(meetings.getByRole('button', { name: /Draft the pre-read: Vitera/ }))
    await waitFor(() => {
      expect(screen.getByTestId('where')).toHaveTextContent('/assistant/meetings/f9')
    })
    expect(posts(FORMS)[0]?.body).toEqual({ meeting_id: 'm1', where: 'unknown' })
  })
})

describe('on a phone (choice 13)', () => {
  it('"Speak" is pinned at the bottom, and opens the voice bar', async () => {
    asPhone()
    const { user } = openToday()
    await part('Your HubSpot tasks')
    await user.click(screen.getByRole('button', { name: 'Speak' }))
    expect(isVoiceBarOpen()).toBe(true)
  })
})
