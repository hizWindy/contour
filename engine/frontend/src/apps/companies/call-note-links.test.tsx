/**
 * Call notes around the app (PLAN-V17 T3-7, "The screens" part 4), in the whole app against a fake
 * server: Activity's count in the menu, Home's quick buttons, Ctrl+K's "Log a call" and "Calls to
 * confirm" (with `?log=1` on Activity), and a person without the Companies tick, who sees none of
 * it and whose browser asks nothing about call notes. Made-up names only.
 */
import { act, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { queryKeys } from '@/api/query'
import type { CallNoteOptions, CallNoteSummary } from '@/api/v17'
import { routes } from '@/router'
import { createTestQueryClient, renderWithProviders } from '@/test/render'
import { asLaptop } from '@/test/screen'
import { activityHref, readLog, withoutLog } from './activity/params'

// Pages load lazily. A busy test run can take more than the default second to load one.
const LAZY = 5000
const NOTES = '/api/v1/companies/call-notes'
const GREETING = /^Good (morning|afternoon|evening)/
const PICKER = 'Which company was the call with?'

function options(enabled: boolean): CallNoteOptions {
  return {
    enabled,
    ai_enabled: false,
    sending_ready: false,
    waiting_for: 'Waiting for HubSpot write access.',
    outcomes: ['Connected', 'No answer', 'Left voicemail'],
    fields: [],
    soft_seconds: 180,
    max_chars: 6000,
  }
}

interface Backend {
  /** Call notes are on. */
  enabled?: boolean
  /** The counts, or 'off' for the 409 the server answers while call notes are off. */
  summary?: CallNoteSummary | 'off'
  /** Who is signed in. Left out: sign-in is off, so everyone sees every project. */
  user?: { role: 'admin' | 'staff'; apps: string[] }
}

/** The fake server. Returns every request it got, as "GET /path?query". */
function stubBackend({
  enabled = true,
  summary = { to_confirm: 7, needs_look: 2, logged_today: 1 },
  user,
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
                    ...user,
                  },
                  session: null,
                }
              : { auth_required: false, user: null, session: null },
          ),
        )
      }
      if (path === `${NOTES}/options`) return Promise.resolve(Response.json(options(enabled)))
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
  return within(screen.getByRole('region', { name: 'Companies' }))
}

function callNoteRequests(requests: readonly string[]): string[] {
  return requests.filter((request) => request.includes('/companies/call-notes'))
}

const SUMMARY = `GET ${NOTES}/summary`

describe("Activity's count in the menu", () => {
  it('says how many calls wait to be confirmed, as a number with words for a screen reader', async () => {
    asLaptop()
    stubBackend()
    renderAt('/')
    await home()
    const companies = within(mainMenu().getByRole('group', { name: 'Companies' }))
    const activity = await companies.findByRole('link', { name: 'Activity, 7 calls to confirm' })
    expect(activity).toHaveAttribute('href', '/companies/activity')
    expect(activity.querySelector('[data-slot=menu-count]')).not.toBeNull()
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
    expect(mainMenu().getByRole('link', { name: 'Activity' })).toBeInTheDocument()
    first.unmount()

    const requests = stubBackend({ enabled: false })
    const { queryClient } = renderAt('/')
    await home()
    await waitFor(() => {
      expect(queryClient.getQueryState(queryKeys.companies.callNoteOptions())?.status).toBe(
        'success',
      )
    })
    // Activity stays in the menu (the page says call notes are off), with no count.
    expect(mainMenu().getByRole('link', { name: 'Activity' })).toBeInTheDocument()
    expect(requests).not.toContain(SUMMARY)
  })
})

describe("Home's quick buttons", () => {
  it('give each kind of work its count, and open its tab on Activity', async () => {
    asLaptop()
    stubBackend()
    const { user, router } = renderAt('/')
    await home()
    const confirm = await companiesCard().findByRole('link', { name: '7 calls to confirm' })
    expect(confirm).toHaveAttribute('href', '/companies/activity')
    const look = companiesCard().getByRole('link', { name: '2 need a look' })
    expect(look).toHaveAttribute('href', '/companies/activity?tab=needs-look')

    await user.click(look)
    expect(
      await screen.findByRole('tab', { name: 'Needs a look 2' }, { timeout: LAZY }),
    ).toHaveAttribute('aria-selected', 'true')
    expect(router.state.location.pathname).toBe('/companies/activity')
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
  it('"Log a call" opens Activity with the company picker open, once', async () => {
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
    expect(router.state.location.pathname).toBe('/companies/activity')
    // ...so going back and forward again doesn't open the picker a second time.
    await act(async () => {
      await router.navigate(-1)
    })
    await home()
    await act(async () => {
      await router.navigate(1)
    })
    await screen.findByRole('heading', { level: 1, name: 'Your call notes' }, { timeout: LAZY })
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
    expect(router.state.location.pathname).toBe('/companies/activity')
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
    expect(within(menu).getByRole('option', { name: 'Activity' })).toBeInTheDocument()
    expect(within(menu).queryByRole('option', { name: 'Log a call' })).toBeNull()
    expect(within(menu).queryByRole('option', { name: 'Calls to confirm' })).toBeNull()
  })
})

describe('Activity opened with ?log=1', () => {
  it('opens no picker while call notes are off, and drops log from the address', async () => {
    asLaptop()
    stubBackend({ enabled: false })
    const { router } = renderAt('/companies/activity?log=1&tab=logged')
    expect(
      await screen.findByText('Call notes are switched off.', undefined, { timeout: LAZY }),
    ).toBeInTheDocument()
    await waitFor(() => {
      expect(router.state.location.search).toBe('?tab=logged')
    })
    expect(screen.queryByRole('combobox', { name: PICKER })).toBeNull()
  })

  it('builds and reads its address', () => {
    expect(activityHref()).toBe('/companies/activity')
    expect(activityHref('needs_look')).toBe('/companies/activity?tab=needs-look')
    expect(activityHref('to_confirm', { log: true })).toBe('/companies/activity?log=1')
    expect(readLog(new URLSearchParams('log=1'))).toBe(true)
    expect(readLog(new URLSearchParams('log=yes'))).toBe(false)
    expect(withoutLog(new URLSearchParams('log=1&tab=logged')).toString()).toBe('tab=logged')
  })
})

describe('who sees it', () => {
  it('a person without the Companies tick sees none of it, and nothing asks about call notes', async () => {
    asLaptop()
    const requests = stubBackend({ user: { role: 'staff', apps: ['lead_finder'] } })
    const { user } = renderAt('/')
    await home()
    expect(await mainMenu().findByRole('group', { name: 'Lead Finder' })).toBeInTheDocument()

    // The menu: no Companies group, so no Meetings, no Activity and no count.
    expect(mainMenu().queryByRole('group', { name: 'Companies' })).toBeNull()
    expect(mainMenu().queryByRole('link', { name: /Meetings/ })).toBeNull()
    expect(mainMenu().queryByRole('link', { name: /Activity/ })).toBeNull()
    // Home: no Companies card, so no quick buttons.
    expect(screen.queryByRole('region', { name: 'Companies' })).toBeNull()
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
      await mainMenu().findByRole('link', { name: 'Activity, 7 calls to confirm' }),
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
