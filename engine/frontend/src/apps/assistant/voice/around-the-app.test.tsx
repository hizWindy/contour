/**
 * The V key and "Speak (V)" in the whole app (PLAN-V22 T3-1), against a fake server, a fake mic
 * and the browser's speech service played by the test: the top bar's button, V on a page through
 * to the page the command names, and who gets neither (a Viewer, and a person without the
 * Assistant). Made-up names only.
 */
import { act, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AssistantCommand, CallNoteOptions } from '@/api/types'
import { FakeMic } from '@/apps/companies/call-notes/mic/fake-mic'
import { routes } from '@/router'
import { createTestQueryClient, renderWithProviders } from '@/test/render'
import { asLaptop } from '@/test/screen'
import { closeVoiceBar } from './store'

// Pages and late parts load lazily. A busy test run can take more than a second to load one.
const LAZY = 5000
const NOTES = '/api/v1/companies/call-notes'
const COMMAND = '/api/v1/companies/assistant/command'
const GREETING = /^Good (morning|afternoon|evening)/
const BAR = 'Speak to the Assistant'

const OPEN_TODAY: AssistantCommand = {
  action: 'open',
  read_back: 'Open Today.',
  company: null,
  person: null,
  meeting: null,
  note_text: null,
  task: null,
  email: null,
  open: { page: 'today', company_key: null },
  change: null,
  unsure: null,
}

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

/** The fake server, for a person with these ticks and this role. Returns every request. */
function stubBackend(role: 'staff' | 'viewer', features: string[]): string[] {
  const requests: string[] = []
  const answer = (request: Request): Response => {
    const url = new URL(request.url)
    requests.push(`${request.method} ${url.pathname}`)
    switch (url.pathname) {
      case '/api/v1/auth/me':
        return Response.json({
          auth_required: true,
          user: {
            id: '11111111-2222-3333-4444-555555555555',
            email: 'jo@example.test',
            username: 'jo',
            name: 'Jo Sample',
            position: null,
            role,
            apps: [...new Set(features.map((feature) => feature.split('.')[0]))],
            features,
          },
          session: null,
        })
      case `${NOTES}/options`:
        return Response.json(options())
      case `${NOTES}/summary`:
        return Response.json({ to_confirm: 3, needs_look: 0, logged_today: 0 })
      case COMMAND:
        return Response.json(OPEN_TODAY)
      default:
        return Response.json({ title: 'Not found', status: 404 }, { status: 404 })
    }
  }
  vi.stubGlobal(
    'fetch',
    vi.fn((request: Request) => Promise.resolve(answer(request))),
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

async function home() {
  await screen.findByRole('heading', { level: 1, name: GREETING }, { timeout: LAZY })
}

/** The bar at the top of every page. */
function topBar() {
  const header = screen.getByRole('button', { name: 'Show or hide the menu' }).closest('header')
  if (!header) throw new Error('No top bar')
  return within(header)
}

/** The Assistant's late parts are in: Call logs' count shows in the menu. */
async function assistantPartsIn() {
  const menu = within(screen.getByRole('navigation', { name: 'Main menu' }))
  await menu.findByRole('link', { name: 'Call logs, 3 calls to confirm' }, { timeout: LAZY })
}

afterEach(() => {
  act(() => {
    closeVoiceBar()
  })
})

describe('the voice in the whole app', () => {
  it(
    '"Speak (V)" sits in the top bar, and V on a page listens, then opens the page said',
    async () => {
      asLaptop()
      const mic = new FakeMic()
      mic.install()
      const requests = stubBackend('staff', ['companies.call_logs'])
      const { user } = renderAt('/')
      await home()
      expect(
        await topBar().findByRole('button', { name: 'Speak (V)' }, { timeout: LAZY }),
      ).toHaveAttribute('aria-keyshortcuts', 'V')

      await user.keyboard('v')
      const bar = await screen.findByRole('dialog', { name: BAR }, { timeout: LAZY })
      await waitFor(
        () => {
          expect(bar.querySelector('[data-slot=voice-title]')).toHaveTextContent('Listening')
        },
        { timeout: LAZY },
      )
      // The browser's speech service hears the words, in Australian English.
      const service = mic.recognitions.at(-1)
      expect(service?.lang).toBe('en-AU')
      act(() => {
        service?.result('Open today')
      })
      await user.keyboard('v')
      expect(
        await screen.findByRole('heading', { level: 1, name: 'Today' }, { timeout: LAZY }),
      ).toBeInTheDocument()
      expect(requests).toContain(`POST ${COMMAND}`)
      await waitFor(() => {
        expect(screen.queryByRole('dialog', { name: BAR })).toBeNull()
      })
      expect(mic.live()).toBe(0)
    },
    LAZY * 3,
  )

  it('"Speak (V)" opens the bar too', async () => {
    asLaptop()
    new FakeMic().install()
    stubBackend('staff', ['companies.meetings', 'companies.call_logs'])
    const { user } = renderAt('/')
    await home()
    await user.click(await topBar().findByRole('button', { name: 'Speak (V)' }, { timeout: LAZY }))
    expect(await screen.findByRole('dialog', { name: BAR }, { timeout: LAZY })).toBeInTheDocument()
  })

  it('a Viewer has no "Speak (V)", and V does nothing (choice 18)', async () => {
    asLaptop()
    new FakeMic().install()
    stubBackend('viewer', ['companies.call_logs', 'companies.meetings'])
    const { user } = renderAt('/')
    await home()
    await assistantPartsIn()
    expect(topBar().queryByRole('button', { name: 'Speak (V)' })).toBeNull()
    await user.keyboard('v')
    expect(screen.queryByRole('dialog', { name: BAR })).toBeNull()
  })

  it('a person without the Assistant (Companies only) has neither', async () => {
    asLaptop()
    new FakeMic().install()
    const requests = stubBackend('staff', ['companies.companies'])
    const { user } = renderAt('/')
    await home()
    await user.keyboard('v')
    expect(screen.queryByRole('dialog', { name: BAR })).toBeNull()
    expect(topBar().queryByRole('button', { name: 'Speak (V)' })).toBeNull()
    expect(requests).not.toContain(`POST ${COMMAND}`)
  })
})
