/**
 * The Assistant's card on Home (PLAN-V22 T2-3, choice 5) against a fake server: today's counts
 * from Today's own answer (never `fresh`), each opening where its work is, the quick buttons it
 * took over (calls to confirm, and those that need a look), only the parts a person sees, the
 * tasks' sentence when they can't show, loading, failing, and "Press V to speak". Made-up names
 * only.
 */
import { act, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SignIn } from '@/api/hooks/auth'
import { queryKeys } from '@/api/query'
import type { Today } from '@/api/types'
import { mockApi, type Answer } from '@/test/mock-api'
import { createTestQueryClient, renderWithProviders } from '@/test/render'
import { AssistantHomeCard } from './home-card'
import { TEST_NOW, today } from './today/fixtures'
import { closeVoiceBar, isVoiceBarOpen } from './voice/store'

const TODAY = '/api/v1/companies/assistant/today'

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

function openCard({
  answer = today(),
  signIn = { state: 'off' },
}: { answer?: Today | Answer; signIn?: SignIn } = {}) {
  const calls = mockApi({ [TODAY]: answer })
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(queryKeys.auth.me(), signIn)
  const view = renderWithProviders(<AssistantHomeCard />, { queryClient })
  return { calls, ...view }
}

async function card() {
  return within(await screen.findByRole('region', { name: 'Assistant' }))
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: TEST_NOW })
})

afterEach(() => {
  act(() => {
    closeVoiceBar()
  })
})

describe("Home's Assistant card", () => {
  it("counts today's work, each opening where it is, from Today's own answer (never fresh)", async () => {
    const { calls } = openCard()
    const found = await card()
    await found.findByText('3 calls to confirm')
    const links = found.getAllByRole('link')
    expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Open', '/assistant'],
      ['2 tasks due, 1 overdue', '/assistant'],
      ['1 meeting today', '/assistant'],
      ['3 calls to confirm', '/assistant/call-logs'],
      ['1 needs a look', '/assistant/call-logs?tab=needs-look'],
    ])
    expect(found.getByRole('link', { name: 'Open Today' })).toBeInTheDocument()
    expect(calls.map((call) => `${call.method} ${call.path}${call.search}`)).toEqual([
      `GET ${TODAY}`,
    ])
  })

  it('says when there is nothing waiting, and leaves out the look row at 0', async () => {
    openCard({
      answer: today({ tasks: [], meetings: [], calls: { to_confirm: 0, needs_look: 0 } }),
    })
    const found = await card()
    expect(await found.findByText('No tasks due today')).toBeInTheDocument()
    expect(found.getByText('No meetings today')).toBeInTheDocument()
    expect(found.getByText('No calls to confirm')).toBeInTheDocument()
    expect(found.queryByText(/a look/)).toBeNull()
  })

  it('counts only the parts a person sees', async () => {
    openCard({ answer: today({ parts: ['meetings'] }) })
    const found = await card()
    expect(await found.findByText('1 meeting today')).toBeInTheDocument()
    expect(found.queryByText(/tasks? due/)).toBeNull()
    expect(found.queryByText(/to confirm/)).toBeNull()
  })

  it("shows the tasks' sentence where their count would be, when they can't show", async () => {
    const sentence = 'Today needs your account linked to HubSpot. Ask Sam Sample to link it.'
    openCard({ answer: today({ tasks: [], tasks_state: 'no_owner', tasks_sentence: sentence }) })
    const found = await card()
    expect(await found.findByText(sentence)).toBeInTheDocument()
    expect(found.queryByText(/tasks? due/)).toBeNull()
    expect(found.getByText('3 calls to confirm')).toBeInTheDocument()
  })

  it('keeps the rows’ room while the counts come, grey only after 200ms', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => undefined)),
    )
    const queryClient = createTestQueryClient()
    queryClient.setQueryData(queryKeys.auth.me(), { state: 'off' })
    renderWithProviders(<AssistantHomeCard />, { queryClient })
    const label = screen.getByText("Loading today's counts.")
    const block = label.parentElement?.querySelector('[aria-hidden="true"] > span')
    expect(block).toHaveClass('invisible')
    await waitFor(() => {
      expect(block).toHaveClass('bg-muted')
    })
  })

  it('says so in one quiet line when the counts fail', async () => {
    openCard({
      answer: () => Response.json({ title: 'Something went wrong', status: 500 }, { status: 500 }),
    })
    const found = await card()
    expect(
      await found.findByText("Today's counts couldn't be loaded right now."),
    ).toBeInTheDocument()
  })

  it('says "Press V to speak", and its Speak button opens the voice bar on a touch screen', async () => {
    const { user } = openCard()
    const found = await card()
    expect(found.getByText(/to speak, on any page\./)).toBeInTheDocument()
    expect(found.getByText('V')).toBeInTheDocument()
    await user.click(found.getByRole('button', { name: 'Speak' }))
    expect(isVoiceBarOpen()).toBe(true)
  })

  it('has no Speak for a Viewer, who has no V (choice 18)', async () => {
    openCard({ signIn: VIEWER })
    const found = await card()
    await found.findByText('3 calls to confirm')
    expect(found.queryByText(/to speak/)).toBeNull()
    expect(found.queryByRole('button', { name: 'Speak' })).toBeNull()
  })
})
