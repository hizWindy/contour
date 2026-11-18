/**
 * Each action, start to end (PLAN-V22 T3-5): V on a page, the words, the command step, the review
 * card, then the send after the 5 second hold. A pre-read and a page open with no card (choice
 * 24). A fake mic, a fake clock and a fake server; nothing real is sent. Made-up names only:
 * Sample Logistics Pty Ltd, Jo Sample.
 */
import { act, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { useLocation } from 'react-router'
import { queryKeys } from '@/api/query'
import type { AssistantCommand } from '@/api/types'
import { FakeMic } from '@/apps/companies/call-notes/mic/fake-mic'
import { mockApi } from '@/test/mock-api'
import { createTestQueryClient, renderWithProviders } from '@/test/render'
import VoiceBar from '../voice/bar'
import type { Times } from '../voice/bar-session'
import { closeVoiceBar, openVoiceBar } from '../voice/store'
import {
  API,
  callCommand,
  CLOCK,
  command,
  emailCommand,
  LEASE,
  note,
  NOTE_ID,
  notePath,
  notePreview,
  options,
  SAM,
  SAMPLE,
  taskCommand,
  teamEmail,
  write,
} from './fixtures'
import { closeCard } from './store'

/** Only V ends the talk here. */
const QUIET: Partial<Times> = { silence: 600_000, firstWords: 600_000, limit: 600_000 }
const HOLD = 5000
const GUARD = 500

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>
}

/** A page with the voice bar on it, and the fake server's answer to the command. */
function page(answer: AssistantCommand, extra: Record<string, unknown> = {}) {
  const mic = new FakeMic()
  const calls = mockApi({
    [API.options]: options(),
    [API.summary]: { to_confirm: 0, needs_look: 0, logged_today: 0 },
    [API.command]: answer,
    [API.taskPreview]: write(),
    [API.tasks]: write({ status: 'done' }),
    [API.emailPreview]: teamEmail(),
    [API.email]: teamEmail({ sent_at: '2026-11-19T01:00:00Z' }),
    [API.team]: [SAM],
    [API.notes]: note({
      status: 'sorting',
      call: { in_hubspot: false, outcome: null, summary: '' },
    }),
    [notePath()]: note(),
    [API.notePreview]: notePreview(),
    [API.confirm]: { already_sending: false, sending: 1, notes: [note({ status: 'sending' })] },
    ...extra,
  })
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(queryKeys.auth.me(), { state: 'off' })
  const view = renderWithProviders(
    <>
      <VoiceBar env={mic.env()} makeTool={mic.tool} times={QUIET} />
      <Where />
    </>,
    { queryClient, route: '/assistant' },
  )
  const of = (path: string) => calls.filter((call) => call.path === path && call.method === 'POST')
  return { mic, of, ...view }
}

async function wait(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

/** V, the words said, then V again: the talk is over and goes to the command step. */
async function speak(mic: FakeMic, words: string, user: ReturnType<typeof page>['user']) {
  act(() => {
    openVoiceBar()
  })
  const bar = await screen.findByRole('dialog', { name: 'Speak to the Assistant' })
  await waitFor(() => {
    expect(bar.querySelector('[data-slot=voice-title]')).toHaveTextContent('Listening')
  })
  act(() => {
    mic.say(words)
  })
  await user.keyboard('v')
}

afterEach(() => {
  act(() => {
    closeVoiceBar()
    closeCard()
    toast.dismiss()
  })
  window.localStorage.clear()
})

describe('each action from V to sent (T3-5)', () => {
  it('a task: said, checked on the card, "send it", and one HubSpot task after 5 seconds', async () => {
    vi.useFakeTimers(CLOCK)
    const words = 'Add a task to send Sample Logistics the quote on Friday'
    const { mic, of, user } = page(taskCommand())
    await speak(mic, words, user)
    const card = await screen.findByRole('dialog', {
      name: 'Add a task for you: send Sample Logistics the quote, due Fri 27 Nov.',
    })
    expect(of(API.command)[0]?.body).toEqual({ text: words, source: 'mic' })
    // The card listens for "send it" after a spoken command.
    expect(within(card).getByText("Say 'send it' or press Enter")).toBeInTheDocument()
    await waitFor(() => {
      expect(mic.tools.at(-1)?.started).toBe(true)
    })
    act(() => {
      mic.say('send it')
    })
    expect(await screen.findByText('Adding the task in HubSpot')).toBeInTheDocument()
    expect(of(API.tasks)).toHaveLength(0)
    await wait(HOLD)
    await waitFor(() => {
      expect(of(API.tasks)).toHaveLength(1)
    })
    expect(of(API.tasks)[0]?.body).toEqual({
      company_key: '201',
      subject: 'Send Sample Logistics the quote',
      body: '',
      due: '2099-11-27',
      kind: 'email',
      owner_id: null,
    })
    expect(await screen.findByText('Task added in HubSpot.')).toBeInTheDocument()
  })

  it('a call with a follow-up and a field change: saved, sorted, checked, then sent with its one id', async () => {
    vi.useFakeTimers(CLOCK)
    const words =
      'Log a call with Jo from Sample Logistics, the lease ends June 2027, follow up Friday'
    const { mic, of, user } = page(callCommand())
    await speak(mic, words, user)
    const card = await screen.findByRole('dialog', {
      name: 'Log a call with Jo Sample at Sample Logistics. Follow-up task on Fri 27 Nov.',
    })
    await waitFor(() => {
      expect(of(API.notes)).toHaveLength(1)
    })
    expect(of(API.notes)[0]?.body).toMatchObject({
      company_key: SAMPLE.key,
      contact_id: 'c-1',
      source: 'mic',
      text: 'Spoke to Jo, the lease ends June 2027. Follow up Friday.',
    })
    // The sort comes in: how it went, the change (old to new) and the follow-up.
    await wait(2000)
    expect(await within(card).findByText('Connected')).toBeInTheDocument()
    const changes = await within(card).findByRole('region', { name: 'Changes' })
    expect(changes).toHaveTextContent(LEASE.label)
    expect(within(card).getByRole('region', { name: 'Follow-ups' })).toHaveTextContent(
      'Call Jo about the lease',
    )
    await waitFor(() => {
      expect(within(card).getByRole('button', { name: 'Send' })).not.toHaveAttribute(
        'aria-disabled',
      )
    })
    within(card).getByRole('button', { name: 'Send' }).focus()
    await wait(GUARD)
    await user.keyboard('{Enter}')
    expect(await screen.findByText('Sending the call to HubSpot')).toBeInTheDocument()
    await wait(HOLD)
    await waitFor(() => {
      expect(of(API.confirm)).toHaveLength(1)
    })
    expect(of(API.confirm)[0]?.body).toEqual({ ids: [NOTE_ID] })
  })

  it('an email: said, checked, Enter, and one email after 5 seconds', async () => {
    vi.useFakeTimers(CLOCK)
    const { mic, of, user } = page(emailCommand())
    await speak(mic, 'Email Sam that the Sample Logistics floor plan is ready', user)
    const card = await screen.findByRole('dialog', {
      name: 'Email Sam Sample: The Sample Logistics floor plan.',
    })
    await waitFor(() => {
      expect(within(card).getByRole('button', { name: 'Send' })).toHaveFocus()
    })
    await wait(GUARD)
    await user.keyboard('{Enter}')
    await screen.findByText('Sending the email')
    await wait(HOLD)
    await waitFor(() => {
      expect(of(API.email)).toHaveLength(1)
    })
    expect(of(API.email)[0]?.headers?.get('idempotency-key')).toBeTruthy()
    expect(await screen.findByText('Email sent to 1 person.')).toBeInTheDocument()
  })

  it('a pre-read: the meeting is found, its pre-read starts, and its page opens as it drafts', async () => {
    vi.useFakeTimers(CLOCK)
    const answer = command({
      action: 'pre_read',
      read_back: 'Make the pre-read for the Sample Logistics meeting on Thu 26 Nov.',
      company: { found: SAMPLE, choices: [], from_page: false, heard: 'Sample Logistics' },
      meeting: {
        found: {
          id: 'meeting-1',
          title: 'Fit-out walkthrough',
          starts_at: '2099-11-26T23:00:00Z',
          company_key: SAMPLE.key,
          company_name: SAMPLE.name,
          form: null,
        },
        choices: [],
        from_page: false,
        heard: 'the Sample Logistics meeting',
      },
    })
    const { mic, of, user } = page(answer, { [API.forms]: { id: 'form-9' } })
    await speak(mic, 'Make a pre-meeting form for Sample Logistics', user)
    await waitFor(() => {
      expect(screen.getByTestId('where')).toHaveTextContent('/assistant/meetings/form-9')
    })
    expect(of(API.forms)[0]?.body).toEqual({ meeting_id: 'meeting-1', where: 'unknown' })
    // Its card is the pre-read's own page: the bar goes, and no review card opens.
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
  })

  it('opening a page: it goes there, with no card and nothing sent', async () => {
    vi.useFakeTimers(CLOCK)
    const { mic, of, user } = page(
      command({
        action: 'open',
        read_back: 'Open Call logs.',
        open: { page: 'call_logs', company_key: null },
      }),
    )
    await speak(mic, 'Open call logs', user)
    await waitFor(() => {
      expect(screen.getByTestId('where')).toHaveTextContent('/assistant/call-logs')
    })
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    expect(of(API.tasks).length + of(API.email).length + of(API.notes).length).toBe(0)
  })
})
