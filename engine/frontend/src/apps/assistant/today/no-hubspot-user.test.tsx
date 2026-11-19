/**
 * Today for someone with no HubSpot user (PLAN-V23 T3-4, choice 16), against a fake server that
 * answers as `today.py` does for them: only the pre-reads sent to them and their calls, no tasks
 * part and no link message, no Sync, and "Press V to log a call." when the day is empty. An account
 * not linked yet keeps the link message. At a laptop's width (1440px) and a phone's (390px). Made-up
 * names only.
 */
import { act, screen } from '@testing-library/react'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SignIn } from '@/api/hooks/auth'
import { queryKeys } from '@/api/query'
import type { CallNoteOptions, Today } from '@/api/types'
import { mockApi } from '@/test/mock-api'
import { createTestQueryClient, renderWithProviders } from '@/test/render'
import { asLaptop, asPhone } from '@/test/screen'
import { closeCard } from '../card/store'
import { showOnScreen } from '../voice/on-screen'
import { closeVoiceBar } from '../voice/store'
import { SAMPLE, TEST_NOW, today } from './fixtures'
import TodayPage from './index'

const TODAY = '/api/v1/companies/assistant/today'
const OPTIONS = '/api/v1/companies/call-notes/options'

function options(): CallNoteOptions {
  return {
    enabled: true,
    ai_enabled: true,
    sending_ready: true,
    waiting_for: null,
    outcomes: ['Connected'],
    fields: [],
    soft_seconds: 180,
    max_chars: 6000,
    voice_tool: 'browser_service',
  }
}

/** Jo Sample, a designer: Call logs and Meetings, and no HubSpot login. */
function signedIn(hubspot: 'none' | 'not_set' | 'linked'): SignIn {
  return {
    state: 'signed_in',
    user: {
      id: '22222222-3333-4444-5555-666666666666',
      email: 'jo@example.test',
      username: 'jo',
      name: 'Jo Sample',
      position: 'Designer',
      role: 'staff',
      apps: ['companies'],
      features: ['companies.call_logs', 'companies.meetings'],
      hubspot,
    },
  }
}

/** Their day, as the server sends it: no tasks, meetings or deals, and no words about tasks. */
function noUserDay(change: Partial<Today> = {}): Today {
  return today({
    parts: ['pre_reads', 'calls'],
    tasks: [],
    tasks_state: 'none',
    tasks_sentence: null,
    meetings: [],
    deals: [],
    pre_reads: [
      {
        form_id: '7a1c2b3d-1111-2222-3333-444444444444',
        title: 'Design review',
        starts_at: '2026-11-20T14:00:00+11:00',
        company: SAMPLE,
        sent_by: 'Sam Sample',
      },
    ],
    calls: { to_confirm: 2, needs_look: 0 },
    ...change,
  })
}

function openToday(answer: Today, signIn: SignIn) {
  mockApi({ [TODAY]: answer, [OPTIONS]: options() })
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(queryKeys.auth.me(), signIn)
  return renderWithProviders(<TodayPage />, { queryClient, route: '/assistant' })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: TEST_NOW })
})

afterEach(() => {
  toast.dismiss()
  showOnScreen(null)
  act(() => {
    closeVoiceBar()
    closeCard()
  })
})

describe.each([
  ['a laptop (1440px)', asLaptop],
  ['a phone (390px)', asPhone],
])('Today with no HubSpot user, on %s', (_width, size) => {
  beforeEach(() => {
    size()
  })

  it('shows only the parts that apply: the pre-reads sent to them and their calls', async () => {
    openToday(noUserDay(), signedIn('none'))
    await screen.findByRole('region', { name: 'Pre-reads for you' })
    expect(screen.getByRole('region', { name: 'Calls to confirm' })).toBeInTheDocument()
    for (const gone of [
      'Your HubSpot tasks',
      'Your meetings today and tomorrow',
      'Deals that need a nudge',
    ]) {
      expect(screen.queryByRole('region', { name: gone })).toBeNull()
    }
    // No link message, and nothing about HubSpot tasks.
    expect(screen.queryByText(/linked to HubSpot/)).toBeNull()
    expect(document.querySelector('[data-slot=tasks-sentence]')).toBeNull()
    // Sync reads HubSpot tasks: they have none to read.
    expect(screen.queryByRole('button', { name: /^Sync/ })).toBeNull()
    // They can still give a task to a teammate.
    expect(screen.getByRole('button', { name: 'Add task' })).toBeInTheDocument()
  })

  it('an empty day says to log a call, not to add a task', async () => {
    openToday(
      noUserDay({ pre_reads: [], calls: { to_confirm: 0, needs_look: 0 } }),
      signedIn('none'),
    )
    expect(await screen.findByText('Nothing due today.')).toBeInTheDocument()
    expect(screen.getByText('Press V to log a call.')).toBeInTheDocument()
    expect(screen.getByText('Tap Speak to log a call.')).toBeInTheDocument()
    expect(screen.queryByText(/add a task/)).toBeNull()
  })

  it('an account not linked yet keeps the link message and Sync', async () => {
    openToday(
      today({
        tasks: [],
        tasks_state: 'no_owner',
        tasks_sentence: 'Today needs your account linked to HubSpot. Ask Sam Sample to link it.',
      }),
      signedIn('not_set'),
    )
    expect(
      await screen.findByText(
        'Today needs your account linked to HubSpot. Ask Sam Sample to link it.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Your HubSpot tasks' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Sync/ })).toBeInTheDocument()
  })
})
