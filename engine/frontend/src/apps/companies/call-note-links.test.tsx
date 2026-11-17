/**
 * Call notes around the app (PLAN-V17 T3-7, "The screens" part 4), in the whole app against a fake
 * server: Call logs' count in the menu, Home's quick buttons, Ctrl+K's "Log a call" and "Calls to
 * confirm" (with `?log=1` on Call logs), and a person without the Companies tick, who sees none of
 * it and whose browser asks nothing about call notes. Made-up names only.
 */
import { act, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { queryKeys } from '@/api/query'
import type { CallNoteOptions, CallNoteSummary } from '@/api/types'
import { routes } from '@/router'
import { createTestQueryClient, renderWithProviders } from '@/test/render'
import { asLaptop, asPhone } from '@/test/screen'
import { callLogsHref, readLog, withoutLog } from './call-logs/params'
import { closeMicCheck } from './call-notes/mic/check-store'
import { FakeMic } from './call-notes/mic/fake-mic'

// Pages load lazily. A busy test run can take more than the default second to load one.
const LAZY = 5000
const NOTES = '/api/v1/companies/call-notes'
const GREETING = /^Good (morning|afternoon|evening)/
const PICKER = 'Which company was the call with?'

function options(
  enabled: boolean,
  voiceTool: CallNoteOptions['voice_tool'] = 'browser_model',
): CallNoteOptions {
  return {
    enabled,
    ai_enabled: false,
    sending_ready: false,
    waiting_for: 'Waiting for HubSpot write access.',
    outcomes: ['Connected', 'No answer', 'Left voicemail'],
    fields: [],
    soft_seconds: 180,
    max_chars: 6000,
    voice_tool: voiceTool,
  }
}

interface Backend {
  /** Call notes are on. */
  enabled?: boolean
  /** The counts, or 'off' for the 409 the server answers while call notes are off. */
  summary?: CallNoteSummary | 'off'
  /** Who is signed in. Left out: sign-in is off, so everyone sees every project. */
  user?: { role: 'admin' | 'staff' | 'viewer'; apps: string[]; features?: string[] }
  /** The voice tool the options name (PLAN-V18 T3-4). Left out: the setting's default. */
  voiceTool?: CallNoteOptions['voice_tool']
}

/** The fake server. Returns every request it got, as "GET /path?query". */
function stubBackend({
  enabled = true,
  summary = { to_confirm: 7, needs_look: 2, logged_today: 1 },
  user,
  voiceTool,
}: Backend = {}): string[] {
  const requests: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn((request: Request) => {
      const url = new URL(request.url)
      requests.push(`${request.method} ${url.pathname}${url.search}`)
      const path = url.pathname
      if (path === '/api/v1/auth/me') {
        return Promise.resolve(
          Response.json(
            user
              ? {
                  auth_required: true,
                  user: {
                    id: '11111111-2222-3333-4444-555555555555',
                    email: 'jo@example.test',
                    username: 'jo',
                    name: 'Jo Sample',
                    position: null,
                    features: user.features ?? [],
                    ...user,
                  },
                  session: null,
                }
              : { auth_required: false, user: null, session: null },
          ),
        )
      }
      if (path === `${NOTES}/options`) {
        return Promise.resolve(Response.json(options(enabled, voiceTool)))
      }
      if (path === `${NOTES}/summary`) {
        return Promise.resolve(
          summary === 'off' || !enabled
            ? Response.json(
                {
                  title: 'Call notes are off',
                  status: 409,
                  detail: 'An admin can switch them on.',
                  code: 'call_notes_off',
                },
                { status: 409 },
              )
            : Response.json(summary),
        )
      }
      if (path === NOTES) return Promise.resolve(Response.json({ total: 0, items: [] }))
      if (path === '/api/v1/companies') {
        return Promise.resolve(Response.json({ items: [], total: 0, leads_shown: false }))
      }
      return Promise.resolve(Response.json({ title: 'Not found', status: 404 }, { status: 404 }))
    }),
  )
  return requests
}

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const queryClient = createTestQueryClient()
  const result = renderWithProviders(<RouterProvider router={router} />, {
    withRouter: false,
    queryClient,
  })
  return { ...result, router }
}

async function home() {
  await screen.findByRole('heading', { level: 1, name: GREETING }, { timeout: LAZY })
}

function mainMenu() {
  return within(screen.getByRole('navigation', { name: 'Main menu' }))
}

function companiesCard() {
  return within(screen.getByRole('region', { name: 'Relationships' }))
}

function callNoteRequests(requests: readonly string[]): string[] {
  return requests.filter((request) => request.includes('/companies/call-notes'))
}

const SUMMARY = `GET ${NOTES}/summary`

describe("Call logs' count in the menu", () => {
  it('says how many calls wait to be confirmed, as a number with words for a screen reader', async () => {
    asLaptop()
    stubBackend()
    renderAt('/')
    await home()
    const companies = within(mainMenu().getByRole('group', { name: 'Relationships' }))
    const callLogs = await companies.findByRole('link', { name: 'Call logs, 7 calls to confirm' })
    expect(callLogs).toHaveAttribute('href', '/companies/call-logs')
    expect(callLogs.querySelector('[data-slot=menu-count]')).not.toBeNull()
    // Home, then the Lead Finder's group, then Companies': the order of MODULES.
    const groups = mainMenu()
      .getAllByRole('group')
      .map((group) => group.getAttribute('aria-labelledby'))
    expect(groups.indexOf('menu-lead-finder')).toBeLessThan(groups.indexOf('menu-companies'))
  })

  it('shows no count at 0, and asks for no counts while call notes are off', async () => {
    asLaptop()
    stubBackend({ summary: { to_confirm: 0, needs_look: 0, logged_today: 0 } })
    const first = renderAt('/')
    await home()
    await waitFor(() => {
      expect(first.queryClient.getQueryState(queryKeys.companies.callNoteSummary())?.status).toBe(
        'success',
      )
    })
    expect(mainMenu().getByRole('link', { name: 'Call logs' })).toBeInTheDocument()
    first.unmount()

    const requests = stubBackend({ enabled: false })
    const { queryClient } = renderAt('/')
    await home()
    await waitFor(() => {
      expect(queryClient.getQueryState(queryKeys.companies.callNoteOptions())?.status).toBe(
        'success',
      )
    })
    // Call logs stays in the menu (the page says call notes are off), with no count.
    expect(mainMenu().getByRole('link', { name: 'Call logs' })).toBeInTheDocument()
    expect(requests).not.toContain(SUMMARY)
  })
})

describe("Home's quick buttons", () => {
  it('give each kind of work its count, and open its tab on Call logs', async () => {
    asLaptop()
    stubBackend()
    const { user, router } = renderAt('/')
    await home()
    const confirm = await companiesCard().findByRole('link', { name: '7 calls to confirm' })
    expect(confirm).toHaveAttribute('href', '/companies/call-logs')
    const look = companiesCard().getByRole('link', { name: '2 need a look' })
    expect(look).toHaveAttribute('href', '/companies/call-logs?tab=needs-look')

    await user.click(look)
    expect(
      await screen.findByRole('tab', { name: 'Needs a look 2' }, { timeout: LAZY }),
    ).toHaveAttribute('aria-selected', 'true')
    expect(router.state.location.pathname).toBe('/companies/call-logs')
  })

  it('show only the work there is, in the right words for one', async () => {
    asLaptop()
    stubBackend({ summary: { to_confirm: 1, needs_look: 0, logged_today: 0 } })
    renderAt('/')
    await home()
    expect(
      await companiesCard().findByRole('link', { name: '1 call to confirm' }),
    ).toBeInTheDocument()
    expect(companiesCard().queryByRole('link', { name: /a look/ })).toBeNull()
  })

  it.each<[string, Backend]>([
    ['call notes are off', { enabled: false }],
    ['the counts fail (409)', { summary: 'off' }],
  ])('leave the card as it was when %s, with no error', async (_, backend) => {
    asLaptop()
    stubBackend(backend)
    const { queryClient } = renderAt('/')
    await home()
    await waitFor(() => {
      expect(queryClient.getQueryState(queryKeys.companies.callNoteOptions())?.status).toBe(
        'success',
      )
    })
    if (backend.summary === 'off') {
      await waitFor(() => {
        expect(queryClient.getQueryState(queryKeys.companies.callNoteSummary())?.status).toBe(
          'error',
        )
      })
    }
    expect(companiesCard().getByRole('searchbox')).toBeInTheDocument()
    expect(companiesCard().queryByRole('link', { name: /to confirm|a look/ })).toBeNull()
    expect(companiesCard().queryByText(/call notes|couldn't/i)).toBeNull()
  })
})

describe('Ctrl+K', () => {
  it('"Log a call" opens Call logs with the company picker open, once', async () => {
    asLaptop()
    stubBackend()
    const { user, router } = renderAt('/')
    await home()
    // Opened from its button. Putting the focus back on it as the menu closes (in a browser, after
    // a 150ms fade) would close the picker that has just opened. Radix's dialog puts the focus
    // back only on its own trigger, and this menu has none: this keeps it that way.
    const opener = screen.getByRole('button', { name: /Go to a page/ })
    await user.click(opener)
    const backToOpener = vi.fn()
    opener.addEventListener('focus', backToOpener)
    await user.click(await screen.findByRole('option', { name: 'Log a call' }))

    const picker = await screen.findByRole('combobox', { name: PICKER }, { timeout: LAZY })
    await waitFor(() => {
      expect(picker).toHaveFocus()
    })
    expect(backToOpener).not.toHaveBeenCalled()
    // The address drops `log` at once, with `replace`...
    await waitFor(() => {
      expect(router.state.location.search).toBe('')
    })
    expect(router.state.location.pathname).toBe('/companies/call-logs')
    // ...so going back and forward again doesn't open the picker a second time.
    await act(async () => {
      await router.navigate(-1)
    })
    await home()
    await act(async () => {
      await router.navigate(1)
    })
    await screen.findByRole('heading', { level: 1, name: 'Call logs' }, { timeout: LAZY })
    await screen.findByRole('button', { name: 'Log call' })
    expect(screen.queryByRole('combobox', { name: PICKER })).toBeNull()
  })

  it('"Calls to confirm" opens To confirm', async () => {
    asLaptop()
    stubBackend()
    const { user, router } = renderAt('/')
    await home()
    await user.keyboard('{Control>}k{/Control}')
    await user.type(await screen.findByPlaceholderText('Type a page or an action'), 'confirm')
    await user.click(await screen.findByRole('option', { name: 'Calls to confirm' }))
    expect(
      await screen.findByRole('tab', { name: 'To confirm 7' }, { timeout: LAZY }),
    ).toHaveAttribute('aria-selected', 'true')
    expect(router.state.location.pathname).toBe('/companies/call-logs')
    expect(router.state.location.search).toBe('')
  })

  it('has neither while call notes are off', async () => {
    asLaptop()
    stubBackend({ enabled: false })
    const { user, queryClient } = renderAt('/')
    await home()
    await waitFor(() => {
      expect(queryClient.getQueryState(queryKeys.companies.callNoteOptions())?.status).toBe(
        'success',
      )
    })
    await user.keyboard('{Control>}k{/Control}')
    const menu = await screen.findByRole('dialog', { name: 'Go to a page' })
    expect(within(menu).getByRole('option', { name: 'Call logs' })).toBeInTheDocument()
    expect(within(menu).queryByRole('option', { name: 'Log a call' })).toBeNull()
    expect(within(menu).queryByRole('option', { name: 'Calls to confirm' })).toBeNull()
  })
})

describe('Call logs opened with ?log=1', () => {
  it('opens no picker while call notes are off, and drops log from the address', async () => {
    asLaptop()
    stubBackend({ enabled: false })
    const { router } = renderAt('/companies/call-logs?log=1&tab=history')
    expect(
      await screen.findByText('Call notes are switched off.', undefined, { timeout: LAZY }),
    ).toBeInTheDocument()
    await waitFor(() => {
      expect(router.state.location.search).toBe('?tab=history')
    })
    expect(screen.queryByRole('combobox', { name: PICKER })).toBeNull()
  })

  it('builds and reads its address', () => {
    expect(callLogsHref()).toBe('/companies/call-logs')
    expect(callLogsHref('needs_look')).toBe('/companies/call-logs?tab=needs-look')
    expect(callLogsHref('to_confirm', { log: true })).toBe('/companies/call-logs?log=1')
    expect(readLog(new URLSearchParams('log=1'))).toBe(true)
    expect(readLog(new URLSearchParams('log=yes'))).toBe(false)
    expect(withoutLog(new URLSearchParams('log=1&tab=history')).toString()).toBe('tab=history')
  })
})

describe('who sees it', () => {
  it('a person without the Companies tick sees none of it, and nothing asks about call notes', async () => {
    asLaptop()
    const requests = stubBackend({ user: { role: 'staff', apps: ['lead_finder'] } })
    const { user } = renderAt('/')
    await home()
    expect(await mainMenu().findByRole('group', { name: 'Lead Finder' })).toBeInTheDocument()

    // The menu: no Companies group, so no Meetings, no Call logs and no count.
    expect(mainMenu().queryByRole('group', { name: 'Relationships' })).toBeNull()
    expect(mainMenu().queryByRole('link', { name: /Meetings/ })).toBeNull()
    expect(mainMenu().queryByRole('link', { name: /Call logs/ })).toBeNull()
    // Home: no Companies card, so no quick buttons.
    expect(screen.queryByRole('region', { name: 'Relationships' })).toBeNull()
    expect(screen.queryByText(/to confirm|a look/)).toBeNull()
    // Ctrl+K: neither entry.
    await user.keyboard('{Control>}k{/Control}')
    const menu = await screen.findByRole('dialog', { name: 'Go to a page' })
    expect(within(menu).queryByRole('option', { name: 'Log a call' })).toBeNull()
    expect(within(menu).queryByRole('option', { name: 'Calls to confirm' })).toBeNull()
    // And not one call notes or meetings request.
    expect(callNoteRequests(requests)).toEqual([])
    expect(requests.filter((request) => request.includes('/companies/meetings'))).toEqual([])
  })

  it('the same person with the tick sees all three', async () => {
    asLaptop()
    const requests = stubBackend({ user: { role: 'staff', apps: ['lead_finder', 'companies'] } })
    const { user } = renderAt('/')
    await home()
    expect(
      await mainMenu().findByRole('link', { name: 'Call logs, 7 calls to confirm' }),
    ).toBeInTheDocument()
    // Meetings is in the group too (T3-9), with no count of its own.
    expect(mainMenu().getByRole('link', { name: 'Meetings' })).toHaveAttribute(
      'href',
      '/companies/meetings',
    )
    expect(
      await companiesCard().findByRole('link', { name: '7 calls to confirm' }),
    ).toBeInTheDocument()
    await user.keyboard('{Control>}k{/Control}')
    expect(await screen.findByRole('option', { name: 'Log a call' })).toBeInTheDocument()
    // The switches once and the counts once, shared by the menu, Home and Ctrl+K.
    expect(callNoteRequests(requests).sort()).toEqual([`GET ${NOTES}/options`, SUMMARY])
  })
})

describe('Check my mic (PLAN-V18 T3-4)', () => {
  // Each opens the whole app on Home, then a late part: slow on a cold, busy run.
  const SLOW = LAZY * 4

  // The card's open state lives in the page, not in the test's render: shut it after each test.
  afterEach(() => {
    act(() => {
      closeMicCheck()
    })
  })

  async function optionsKnown(queryClient: ReturnType<typeof createTestQueryClient>) {
    await waitFor(() => {
      expect(queryClient.getQueryState(queryKeys.companies.callNoteOptions())?.status).toBe(
        'success',
      )
    })
  }

  it(
    'opens the mic card from Ctrl+K, in check only mode, and Done closes it',
    async () => {
      asLaptop()
      stubBackend({ voiceTool: 'browser_service' })
      const mic = new FakeMic()
      mic.install()
      const { user, queryClient } = renderAt('/')
      await home()
      await optionsKnown(queryClient)
      await user.keyboard('{Control>}k{/Control}')
      const menu = await screen.findByRole('dialog', { name: 'Go to a page' })
      await user.click(await within(menu).findByRole('option', { name: 'Check my mic' }))
      const card = await screen.findByRole('dialog', { name: 'Your mic works' }, { timeout: LAZY })
      // A check never starts the speech service: nothing of the voice goes anywhere.
      expect(mic.recognitions).toHaveLength(0)
      await user.click(within(card).getByRole('button', { name: 'Done' }))
      await waitFor(() => {
        expect(screen.queryByRole('dialog', { name: 'Your mic works' })).toBeNull()
      })
      expect(mic.live()).toBe(0)
    },
    SLOW,
  )

  it(
    'is in the account menu, before Sign out, and opens the same card',
    async () => {
      asLaptop()
      stubBackend({ voiceTool: 'browser_model', user: { role: 'staff', apps: ['companies'] } })
      new FakeMic().install()
      const { user, queryClient } = renderAt('/')
      await home()
      await optionsKnown(queryClient)
      await user.click(screen.getByRole('button', { name: 'Account menu, Jo Sample' }))
      // The row loads late, with the rest of Companies' parts.
      await screen.findByRole('menuitem', { name: 'Check my mic' }, { timeout: LAZY })
      const names = screen.getAllByRole('menuitem').map((item) => item.textContent)
      expect(names).toEqual(['Check my mic', 'Sign out'])
      await user.click(screen.getByRole('menuitem', { name: 'Check my mic' }))
      // Whisper waits for T3-3: the card checks the mic and says speech to words isn't set up yet.
      expect(
        await screen.findByText(
          "Turning speech into words isn't set up here yet. Your mic works. Type the note for now.",
          undefined,
          { timeout: LAZY },
        ),
      ).toBeInTheDocument()
    },
    SLOW,
  )

  it.each<[string, Backend, boolean]>([
    ['on a phone', { voiceTool: 'browser_service' }, true],
    ['with the voice tool set to typing', { voiceTool: 'typing' }, false],
    ['while call notes are off', { voiceTool: 'browser_service', enabled: false }, false],
  ])(
    'is not offered %s',
    async (_, backend, phone) => {
      if (phone) asPhone()
      else asLaptop()
      stubBackend(backend)
      const { user, queryClient } = renderAt('/')
      await home()
      await optionsKnown(queryClient)
      await user.keyboard('{Control>}k{/Control}')
      const menu = await screen.findByRole('dialog', { name: 'Go to a page' })
      await within(menu).findByRole('option', { name: 'Call logs' })
      expect(within(menu).queryByRole('option', { name: 'Check my mic' })).toBeNull()
    },
    SLOW,
  )
})
