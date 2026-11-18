/**
 * The Assistant module (PLAN-V22 T2-1), in the whole app against a fake server: the menu for each
 * set of ticks, Today's guard, the old addresses sent on with their query, Ctrl+K found by its old
 * words, the People tab's groups, Home, and the app's shortcuts. The new addresses' titles and
 * breadcrumbs are in router.test.tsx. Made-up names only.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, matchRoutes, RouterProvider } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { queryKeys } from '@/api/query'
import AdminPeopleTab from '@/apps/lead-finder/admin/people'
import { FEATURE_GROUPS, type Feature } from '@/auth/can'
import { MODULES, PLANNED } from '@/modules'
import { routes } from '@/router'
import HomePage from '@/shell/home'
import { mockApi } from '@/test/mock-api'
import { createTestQueryClient, renderWithProviders } from '@/test/render'
import { asLaptop } from '@/test/screen'
import { ASSISTANT } from './module'
import { movedTo, OLD_PATHS } from './old-addresses'
import { CALL_LOGS_PATH, MEETINGS_PATH, TODAY_PATH } from './paths'

// Pages and late parts load lazily. A busy test run can take more than a second to load one.
const LAZY = 5000
const NOTES = '/api/v1/companies/call-notes'
const MEETINGS = '/api/v1/companies/meetings'
const GREETING = /^Good (morning|afternoon|evening)/
const FORM_ID = '0f3c9a2e-1111-2222-3333-444444444444'

interface Backend {
  /** The signed-in person's ticks. Left out: sign-in is off, so everyone sees every project. */
  features?: Feature[]
  /** Call notes are on. */
  notes?: boolean
  /** Pre-meeting forms are on. */
  forms?: boolean
}

function switchedOff(code: string): Response {
  return Response.json(
    { title: 'Switched off', status: 409, detail: 'An admin can switch it on.', code },
    { status: 409 },
  )
}

/** The fake server. Returns every request it got, as "GET /path?query". */
function stubBackend({ features, notes = true, forms = true }: Backend = {}): string[] {
  const requests: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn((request: Request) => {
      const url = new URL(request.url)
      requests.push(`${request.method} ${url.pathname}${url.search}`)
      const answer = (): Response => {
        switch (url.pathname) {
          case '/api/v1/auth/me':
            return Response.json(
              features
                ? {
                    auth_required: true,
                    user: {
                      id: '11111111-2222-3333-4444-555555555555',
                      email: 'jo@example.test',
                      username: 'jo',
                      name: 'Jo Sample',
                      position: null,
                      role: 'staff',
                      apps: [...new Set(features.map((feature) => feature.split('.')[0]))],
                      features,
                    },
                    session: null,
                  }
                : { auth_required: false, user: null, session: null },
            )
          case `${NOTES}/options`:
            return Response.json({
              enabled: notes,
              ai_enabled: false,
              sending_ready: true,
              waiting_for: null,
              outcomes: ['Connected', 'No answer'],
              fields: [],
              soft_seconds: 180,
              max_chars: 6000,
              voice_tool: 'browser_service',
            })
          case `${NOTES}/summary`:
            return notes
              ? Response.json({ to_confirm: 3, needs_look: 0, logged_today: 0 })
              : switchedOff('call_notes_off')
          case `${MEETINGS}/summary`:
            return forms
              ? Response.json({ need_pre_read: 1, draft_ready: 0 })
              : switchedOff('meeting_forms_off')
          default:
            return Response.json({ title: 'Not found', status: 404 }, { status: 404 })
        }
      }
      return Promise.resolve(answer())
    }),
  )
  return requests
}

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const result = renderWithProviders(<RouterProvider router={router} />, {
    withRouter: false,
    queryClient: createTestQueryClient(),
  })
  return { ...result, router }
}

function mainMenu() {
  return within(screen.getByRole('navigation', { name: 'Main menu' }))
}

function crumbs(): string[] {
  const nav = screen.getByRole('navigation', { name: 'breadcrumb' })
  return within(nav)
    .getAllByRole('listitem')
    .map((item) => item.textContent)
    .filter((text) => text !== '')
}

describe('the menu, for each set of ticks (choice 4)', () => {
  it.each<[string, Feature[], { companies: boolean; assistant: string[] }]>([
    [
      'Call logs alone',
      ['companies.call_logs'],
      { companies: false, assistant: ['Today', 'Call logs'] },
    ],
    [
      'Meetings alone',
      ['companies.meetings'],
      { companies: false, assistant: ['Today', 'Meetings'] },
    ],
    ['Companies alone', ['companies.companies'], { companies: true, assistant: [] }],
    [
      'Companies and Call prep',
      ['companies.companies', 'companies.call_prep'],
      { companies: true, assistant: [] },
    ],
    ['Call prep alone', ['companies.call_prep'], { companies: false, assistant: [] }],
    [
      'Companies, Call logs and Meetings',
      ['companies.companies', 'companies.call_logs', 'companies.meetings'],
      { companies: true, assistant: ['Today', 'Meetings', 'Call logs'] },
    ],
  ])('with %s', async (_, features, shows) => {
    asLaptop()
    stubBackend({ features })
    renderAt('/')
    await screen.findByRole('heading', { level: 1, name: GREETING }, { timeout: LAZY })
    // Who this is decides the menu: wait until it is drawn for them.
    await waitFor(() => {
      expect(mainMenu().getByRole('link', { name: 'Home' })).toBeInTheDocument()
    })
    const companies = mainMenu().queryByRole('link', { name: 'Companies' })
    if (shows.companies) {
      // One page, so a plain link under Home, not a group.
      expect(companies).toHaveAttribute('href', '/companies')
      expect(mainMenu().queryByRole('group', { name: 'Companies' })).toBeNull()
    } else {
      expect(companies).toBeNull()
    }
    const group = mainMenu().queryByRole('group', { name: 'Assistant' })
    if (shows.assistant.length === 0) {
      expect(group).toBeNull()
      expect(mainMenu().queryByRole('link', { name: 'Today' })).toBeNull()
      return
    }
    expect(group).not.toBeNull()
    const names = within(group as HTMLElement)
      .getAllByRole('link')
      .map((link) => link.textContent)
    // Call logs' row may carry its count ("3"): the name is what it starts with.
    expect(names.map((name) => shows.assistant.find((page) => name?.startsWith(page)))).toEqual(
      shows.assistant,
    )
    // The Lead Finder isn't theirs, and "Relationships" is gone for everyone.
    expect(mainMenu().queryByRole('group', { name: 'Lead Finder' })).toBeNull()
    expect(mainMenu().queryByRole('group', { name: 'Relationships' })).toBeNull()
  })

  it('keeps Meetings and Call logs in the menu while their switches are off', async () => {
    asLaptop()
    stubBackend({ notes: false, forms: false })
    renderAt('/')
    await screen.findByRole('heading', { level: 1, name: GREETING }, { timeout: LAZY })
    const group = within(mainMenu().getByRole('group', { name: 'Assistant' }))
    expect(group.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      TODAY_PATH,
      MEETINGS_PATH,
      CALL_LOGS_PATH,
    ])
  })
})

describe('Today, for now (T2-2 builds it)', () => {
  it('opens with its title, its sentence, and its own tab title', async () => {
    stubBackend({ features: ['companies.call_logs'] })
    renderAt(TODAY_PATH)
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Today' }, { timeout: LAZY }),
    ).toBeInTheDocument()
    expect(screen.getByText(/the most urgent first\.$/)).toBeInTheDocument()
    expect(crumbs()).toEqual(['Assistant', 'Today'])
    expect(document.title).toBe('Today - Contour')
  })

  it('is not open to a person with neither the Call logs nor the Meetings tick', async () => {
    stubBackend({ features: ['companies.companies'] })
    renderAt(TODAY_PATH)
    expect(
      await screen.findByText(/^You don't have access to Today\./, undefined, { timeout: LAZY }),
    ).toBeInTheDocument()
  })
})

describe('the old addresses (choice 2)', () => {
  it.each([
    // Meetings keeps its view: Past, whose, the owner, the search, the page, an old team=1.
    ['/companies/meetings', MEETINGS_PATH, '', 'Client meetings'],
    [
      '/companies/meetings?when=past&who=team&q=vitera&page=2',
      MEETINGS_PATH,
      '?when=past&who=team&q=vitera&page=2',
      'Client meetings',
    ],
    ['/companies/meetings?team=1', MEETINGS_PATH, '?team=1', 'Client meetings'],
    // A pre-read keeps its id: the morning email's older links still open it.
    [
      `/companies/meetings/${FORM_ID}?from=email`,
      `${MEETINGS_PATH}/${FORM_ID}`,
      '?from=email',
      'Pre-read',
    ],
    // Call logs keeps its tab and History's filters, and Activity's tab Logged opens History.
    [
      '/companies/call-logs?tab=history&q=sample&outcome=Connected&when=week',
      CALL_LOGS_PATH,
      '?tab=history&q=sample&outcome=Connected&when=week',
      'Call logs',
    ],
    ['/companies/call-logs?tab=logged', CALL_LOGS_PATH, '?tab=history', 'Call logs'],
  ])('sends %s on, with its query', async (old, pathname, search, title) => {
    stubBackend()
    const { router } = renderAt(old)
    expect(
      await screen.findByRole('heading', { level: 1, name: title }, { timeout: LAZY }),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(pathname)
    expect(router.state.location.search).toBe(search)
    expect(crumbs()[0]).toBe('Assistant')
    // The old address is replaced, so Back doesn't bounce to it.
    expect(router.state.historyAction).toBe('REPLACE')
    // Never read as a company's own address.
    expect(screen.queryByRole('heading', { level: 1, name: 'Company' })).toBeNull()
  })

  it('keeps the hash too', async () => {
    stubBackend()
    const { router } = renderAt('/companies/call-logs?tab=needs-look#top')
    await screen.findByRole('heading', { level: 1, name: 'Call logs' }, { timeout: LAZY })
    expect(router.state.location.pathname).toBe(CALL_LOGS_PATH)
    expect(router.state.location.search).toBe('?tab=needs-look')
    expect(router.state.location.hash).toBe('#top')
  })

  it('works out each new address in code', () => {
    expect(OLD_PATHS).toEqual([
      '/companies/meetings',
      '/companies/call-logs',
      '/companies/activity',
    ])
    expect(movedTo('/companies/meetings')).toBe('/assistant/meetings')
    expect(movedTo('/companies/meetings/f%201', '?x=1')).toBe('/assistant/meetings/f%201?x=1')
    expect(movedTo('/companies/call-logs', '?tab=logged&log=1')).toBe(
      '/assistant/call-logs?tab=history&log=1',
    )
    expect(movedTo('/companies/activity', '', '#n1')).toBe('/assistant/call-logs#n1')
    // Meetings has no tab called Logged: its query is left alone.
    expect(movedTo('/companies/meetings', '?tab=logged')).toBe('/assistant/meetings?tab=logged')
    // An address that didn't move comes back as it was.
    expect(movedTo('/companies/hs-42', '?q=1')).toBe('/companies/hs-42?q=1')
    expect(movedTo('/companies/meetingsroom')).toBe('/companies/meetingsroom')
  })
})

describe('Ctrl+K (choice 2: found by the old words)', () => {
  async function openCtrlK() {
    asLaptop()
    stubBackend()
    const rendered = renderAt('/')
    await screen.findByRole('heading', { level: 1, name: GREETING }, { timeout: LAZY })
    await rendered.user.keyboard('{Control>}k{/Control}')
    const menu = await screen.findByRole('dialog', { name: 'Go to a page' })
    return { ...rendered, menu: within(menu) }
  }

  it('lists Today, the pages and the five entries under the Assistant', async () => {
    const { menu } = await openCtrlK()
    // The pre-read's entry comes last: it waits for Meetings' counts.
    await menu.findByRole('option', { name: 'Pre-read for a meeting' }, { timeout: LAZY })
    const group = within(menu.getByRole('group', { name: 'Assistant' }))
    expect(group.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Today',
      'Meetings',
      'Call logs',
      'Log a call',
      'Calls to confirm',
      'Check my mic',
      'Pre-read for a meeting',
    ])
    // Companies is a group of one, before the Assistant, and "Relationships" is gone.
    expect(
      within(menu.getByRole('group', { name: 'Companies' })).getAllByRole('option'),
    ).toHaveLength(1)
    expect(menu.queryByRole('group', { name: 'Relationships' })).toBeNull()
  })

  it.each<[string, string[]]>([
    ['relationships', ['Companies', 'Meetings', 'Call logs']],
    ['activity', ['Call logs', 'Log a call', 'Calls to confirm']],
    ['call logs', ['Call logs', 'Log a call', 'Calls to confirm']],
    ['meetings', ['Meetings', 'Pre-read for a meeting']],
    ['assistant', ['Today', 'Meetings', 'Call logs']],
  ])('finds by "%s"', async (typed, found) => {
    const { menu, user } = await openCtrlK()
    // The entries come once the switches are known.
    await menu.findByRole('option', { name: 'Pre-read for a meeting' }, { timeout: LAZY })
    await user.type(menu.getByPlaceholderText('Type a page or an action'), typed)
    for (const name of found) {
      expect(await menu.findByRole('option', { name })).toBeInTheDocument()
    }
  })

  it('"Today" opens Today', async () => {
    const { menu, user, router } = await openCtrlK()
    await user.type(menu.getByPlaceholderText('Type a page or an action'), 'today')
    await user.click(await menu.findByRole('option', { name: 'Today' }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(TODAY_PATH)
    })
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Today' }, { timeout: LAZY }),
    ).toBeInTheDocument()
  })
})

describe('the People tab (choice 4)', () => {
  const person = {
    id: 'bbbbbbbb-2222-3333-4444-555555555555',
    email: 'pat@example.test',
    username: null,
    name: 'Pat Sample',
    position: 'Designer',
    role: 'staff',
    apps: ['companies'],
    features: ['companies.call_logs', 'companies.meetings'],
    hubspot_owner: null,
    active: true,
    last_signed_in_at: null,
    created_at: '2026-11-19T00:00:00Z',
  }

  it('groups Call logs and Meetings under Assistant, and Companies and Call prep under Companies', async () => {
    const calls = mockApi({
      '/api/v1/auth/me': { auth_required: false, user: null, session: null },
      '/api/v1/people': [person],
      [`/api/v1/people/${person.id}`]: { ...person, features: ['companies.call_logs'] },
    })
    const { user } = renderWithProviders(<AdminPeopleTab />)
    const table = await screen.findByRole('table', { name: 'People' })
    // Both of the Assistant's ticks read as the one word.
    expect(within(table).getByText('Assistant')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Edit Pat Sample' }))
    const sheet = await screen.findByRole('dialog')
    const dialog = within(sheet)
    const legends = [...sheet.querySelectorAll('fieldset > legend')].map(
      (legend) => legend.textContent,
    )
    expect(legends).toEqual(['Companies', 'Assistant', 'Lead Finder'])
    const ticks = (name: string) =>
      within(dialog.getByRole('group', { name }))
        .getAllByRole('checkbox')
        .map((box) => box.closest('label')?.textContent)
    expect(ticks('Companies')).toEqual(['Companies', 'Call prep'])
    expect(ticks('Assistant')).toEqual(['Call logs', 'Meetings'])
    expect(FEATURE_GROUPS.map((group) => group.app)).toEqual([
      'companies',
      'companies',
      'lead_finder',
    ])

    // The ticks keep their names: no change on the server.
    await user.click(
      within(dialog.getByRole('group', { name: 'Assistant' })).getByRole('checkbox', {
        name: 'Meetings',
      }),
    )
    await waitFor(() => {
      expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({
        features: ['companies.call_logs'],
      })
    })
  })
})

describe('Home (T2-3 gives the Assistant its own card)', () => {
  it('keeps the Lead Finder card first, then Companies, and the Assistant’s card comes last', async () => {
    mockApi({})
    const queryClient = createTestQueryClient()
    queryClient.setQueryData(queryKeys.auth.me(), { state: 'off' })
    renderWithProviders(<HomePage />, { queryClient })
    const assistant = await screen.findByRole('region', { name: 'Assistant' }, { timeout: LAZY })
    const companies = screen.getByRole('region', { name: 'Companies' })
    const leadFinder = screen.getByRole('region', { name: 'Lead Finder' })
    const runsCost = screen.getByRole('region', { name: 'Runs and cost' })
    const after = (one: HTMLElement, other: HTMLElement) =>
      Boolean(one.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING)
    expect(after(leadFinder, companies)).toBe(true)
    // It comes late, where "Upcoming meetings" was, so its coming moves no other card.
    expect(after(runsCost, assistant)).toBe(true)
    expect(within(assistant).getByRole('link', { name: 'Open Today' })).toHaveAttribute(
      'href',
      TODAY_PATH,
    )
  })
})

describe('the rest of the app', () => {
  it('lists the projects as the menu reads: Companies, the Assistant, then the Lead Finder', () => {
    expect(MODULES.map((module) => module.name)).toEqual(['Companies', 'Assistant', 'Lead Finder'])
    expect(ASSISTANT.app).toBe('companies')
  })

  it('opens the new addresses from the app shortcuts, each a real page', () => {
    const manifest = JSON.parse(
      readFileSync(
        join(import.meta.dirname, '..', '..', '..', 'public', 'manifest.webmanifest'),
        'utf8',
      ),
    ) as { shortcuts: { name: string; url: string }[] }
    expect(manifest.shortcuts.map((shortcut) => shortcut.url)).toEqual([
      TODAY_PATH,
      CALL_LOGS_PATH,
      MEETINGS_PATH,
      '/companies',
      '/start',
    ])
    for (const { url } of manifest.shortcuts) {
      expect(OLD_PATHS.some((old) => url.startsWith(old))).toBe(false)
      expect(matchRoutes(routes, url)?.at(-1)?.route.path, url).not.toBe('*')
    }
  })

  it('leaves the daily task list out of Deal review: Today does it now', () => {
    const dealReview = PLANNED.find((project) => project.id === 'deal-review')
    expect(dealReview?.description).not.toMatch(/task list/)
  })
})
