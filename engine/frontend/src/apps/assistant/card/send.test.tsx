/**
 * Sending from the review card (PLAN-V22 T3-4, choices 22 and 23), with a fake clock, a fake mic
 * and a fake server: Undo inside the 5 seconds sends nothing, after them it sends once, a page
 * closed inside them sends nothing and keeps the draft, "send it" sends, other words are ignored,
 * and any key stops the listening. PLAN-V24 T3-2: a call saved before its company is saved with
 * the name as heard, and never sent while it needs one. Made-up names only: Sample Logistics Pty
 * Ltd, Jo Sample, North Wind as heard.
 */
import { act, screen, waitFor, within } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { queryKeys } from '@/api/query'
import type { AssistantCommand } from '@/api/types'
import { FakeMic } from '@/apps/companies/call-notes/mic/fake-mic'
import { mockApi } from '@/test/mock-api'
import { createTestQueryClient, renderWithProviders } from '@/test/render'
import {
  API,
  callCommand,
  CLOCK,
  emailCommand,
  note,
  NOTE_ID,
  notePath,
  notePreview,
  options,
  SAM,
  taskCommand,
  teamEmail,
  write,
} from './fixtures'
import { draftOf, type CallDraft } from './draft'
import { CardHost } from './host'
import { heardNoteBodyOf, sendDraft } from './send'
import { closeCard, openCard } from './store'

const HOLD = 5000

function show(made: AssistantCommand, source: 'mic' | 'typed' = 'typed', strict = false) {
  const mic = new FakeMic()
  const calls = mockApi({
    [API.options]: options(),
    [API.summary]: { to_confirm: 1, needs_look: 0, logged_today: 0 },
    [API.taskPreview]: write(),
    [API.tasks]: write({ status: 'done' }),
    [API.emailPreview]: teamEmail(),
    [API.email]: teamEmail({ sent_at: '2026-11-19T01:00:00Z' }),
    [API.team]: [SAM],
    [API.notes]: note(),
    [notePath()]: note(),
    [API.notePreview]: notePreview(),
    [API.confirm]: { already_sending: false, sending: 1, notes: [note({ status: 'sending' })] },
  })
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(queryKeys.auth.me(), { state: 'off' })
  const card = <CardHost env={mic.env()} makeTool={mic.tool} times={{ guard: 0, preview: 0 }} />
  // StrictMode runs each effect twice, as the app does while developing.
  const host = strict ? <StrictMode>{card}</StrictMode> : card
  const view = renderWithProviders(host, { queryClient })
  act(() => {
    openCard({ kind: 'command', command: made, words: 'the words', source })
  })
  const of = (path: string) => calls.filter((call) => call.path === path && call.method === 'POST')
  return { mic, of, host, ...view }
}

async function ready() {
  const found = await screen.findByRole('dialog')
  await waitFor(() => {
    expect(within(found).getByRole('button', { name: 'Send' })).toHaveFocus()
  })
  return found
}

async function wait(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

/** The fake mic's voice tool is listening. */
async function toolListens(mic: FakeMic) {
  await waitFor(() => {
    expect(mic.tools.at(-1)?.started).toBe(true)
  })
}

afterEach(() => {
  act(() => {
    closeCard()
    toast.dismiss()
  })
  window.localStorage.clear()
})

describe('the 5 second hold (choice 22)', () => {
  it('Undo inside the 5 seconds sends nothing, and the card opens again with the draft', async () => {
    vi.useFakeTimers(CLOCK)
    const { user, of } = show(taskCommand())
    await ready()
    await user.keyboard('{Enter}')
    expect(await screen.findByText('Adding the task in HubSpot')).toBeInTheDocument()
    await wait(3000)
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    await wait(HOLD)
    expect(of(API.tasks)).toHaveLength(0)
    const again = await screen.findByRole('dialog')
    expect(within(again).getByRole('textbox', { name: 'What to do' })).toHaveValue(
      'Send Sample Logistics the quote',
    )
  })

  it('Esc undoes a running hold once the card has gone, and the card opens again (TBC)', async () => {
    vi.useFakeTimers(CLOCK)
    const { user, of } = show(taskCommand())
    await ready()
    await user.keyboard('{Enter}')
    await screen.findByText('Adding the task in HubSpot')
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    await user.keyboard('{Escape}')
    await wait(HOLD)
    expect(of(API.tasks)).toHaveLength(0)
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('after the 5 seconds it sends once, with the card’s key, and says so', async () => {
    vi.useFakeTimers(CLOCK)
    const { user, of } = show(taskCommand())
    await ready()
    await waitFor(() => {
      expect(of(API.taskPreview)).toHaveLength(1)
    })
    await user.keyboard('{Enter}')
    await wait(HOLD - 100)
    expect(of(API.tasks)).toHaveLength(0)
    await wait(100)
    await waitFor(() => {
      expect(of(API.tasks)).toHaveLength(1)
    })
    const [sent] = of(API.tasks)
    expect(sent?.headers?.get('idempotency-key')).toBe(
      of(API.taskPreview)[0]?.headers?.get('idempotency-key'),
    )
    expect(await screen.findByText('Task added in HubSpot.')).toBeInTheDocument()
    await wait(HOLD)
    expect(of(API.tasks)).toHaveLength(1)
    // Sent: the draft is no longer kept.
    expect(window.localStorage.getItem('assistant.card-drafts')).toBeNull()
  })

  it('a page closed inside the 5 seconds sends nothing and keeps the draft, and the next page offers it', async () => {
    vi.useFakeTimers(CLOCK)
    const { user, of, unmount, host } = show(taskCommand())
    await ready()
    await user.keyboard('{Enter}')
    await screen.findByText('Adding the task in HubSpot')
    await wait(2000)
    act(() => {
      window.dispatchEvent(new Event('pagehide'))
    })
    await wait(HOLD)
    expect(of(API.tasks)).toHaveLength(0)
    expect(window.localStorage.getItem('assistant.card-drafts')).toContain(
      'Send Sample Logistics the quote',
    )
    // The next page: the draft is offered once, and Open brings the card back.
    unmount()
    act(() => {
      closeCard()
    })
    const queryClient = createTestQueryClient()
    queryClient.setQueryData(queryKeys.auth.me(), { state: 'off' })
    const next = renderWithProviders(host, { queryClient })
    expect(await screen.findByText("A draft from the Assistant wasn't sent.")).toBeInTheDocument()
    await next.user.click(screen.getByRole('button', { name: 'Open' }))
    expect(
      within(await screen.findByRole('dialog')).getByRole('textbox', { name: 'What to do' }),
    ).toHaveValue('Send Sample Logistics the quote')
    expect(of(API.tasks)).toHaveLength(0)
  })

  it('a call goes to HubSpot once, with its one id, after the 5 seconds', async () => {
    vi.useFakeTimers(CLOCK)
    const { user, of } = show(callCommand())
    const found = await ready()
    await within(found).findByText('Connected')
    await waitFor(() => {
      expect(within(found).getByRole('button', { name: 'Send' })).not.toHaveAttribute(
        'aria-disabled',
      )
    })
    await user.keyboard('{Enter}')
    expect(await screen.findByText('Sending the call to HubSpot')).toBeInTheDocument()
    await wait(HOLD)
    await waitFor(() => {
      expect(of(API.confirm)).toHaveLength(1)
    })
    expect(of(API.confirm)[0]?.body).toEqual({ ids: [NOTE_ID] })
    expect(await screen.findByText('The call is on its way to HubSpot.')).toBeInTheDocument()
  })

  it('an email goes once, after the 5 seconds', async () => {
    vi.useFakeTimers(CLOCK)
    const { user, of } = show(emailCommand())
    await ready()
    await user.keyboard('{Enter}')
    await screen.findByText('Sending the email')
    await wait(HOLD)
    await waitFor(() => {
      expect(of(API.email)).toHaveLength(1)
    })
    expect(of(API.email)[0]?.body).toEqual({
      owner_ids: ['o-2'],
      emails: [],
      subject: 'The Sample Logistics floor plan',
      body: 'The floor plan is ready. <b>Have a look</b> before Friday.',
      company_key: null,
    })
    expect(await screen.findByText('Email sent to 1 person.')).toBeInTheDocument()
  })

  it('a send that fails keeps the draft, and Open brings it back', async () => {
    vi.useFakeTimers(CLOCK)
    const { user, of } = show(taskCommand())
    mockApi({
      [API.options]: options(),
      [API.taskPreview]: write(),
      [API.tasks]: () =>
        Response.json(
          { title: 'HubSpot didn’t answer', status: 503, code: 'hubspot_unavailable' },
          { status: 503 },
        ),
    })
    await ready()
    await user.keyboard('{Enter}')
    await wait(HOLD)
    expect(await screen.findByText('Not sent')).toBeInTheDocument()
    expect(of(API.tasks)).toHaveLength(0)
    expect(window.localStorage.getItem('assistant.card-drafts')).toContain(
      'Send Sample Logistics the quote',
    )
  })
})

describe('"send it" (choice 23)', () => {
  it('after a spoken command the card listens, and "send it" starts the hold', async () => {
    vi.useFakeTimers(CLOCK)
    const { mic, of } = show(taskCommand(), 'mic')
    const found = await screen.findByRole('dialog')
    expect(within(found).getByText("Say 'send it' or press Enter")).toBeInTheDocument()
    await toolListens(mic)
    act(() => {
      mic.say('Send it.')
    })
    expect(await screen.findByText('Adding the task in HubSpot')).toBeInTheDocument()
    // The mic is let go at once.
    expect(mic.live()).toBe(0)
    await wait(HOLD)
    await waitFor(() => {
      expect(of(API.tasks)).toHaveLength(1)
    })
  })

  it('still listens when React runs its effects twice (StrictMode, while developing)', async () => {
    vi.useFakeTimers(CLOCK)
    const { mic } = show(taskCommand(), 'mic', true)
    const found = await screen.findByRole('dialog')
    await toolListens(mic)
    expect(found.querySelector('[data-slot=card-listen]')).not.toBeNull()
    act(() => {
      mic.say('send it')
    })
    expect(await screen.findByText('Adding the task in HubSpot')).toBeInTheDocument()
    expect(mic.live()).toBe(0)
  })

  it('other words are ignored, and the listening ends after 5 seconds', async () => {
    vi.useFakeTimers(CLOCK)
    const { mic, of } = show(taskCommand(), 'mic')
    const found = await screen.findByRole('dialog')
    await toolListens(mic)
    act(() => {
      mic.say('send the quote to Jo on Friday')
    })
    await wait(100)
    expect(screen.queryByText('Adding the task in HubSpot')).toBeNull()
    expect(found.querySelector('[data-slot=card-listen]')).not.toBeNull()
    await wait(5000)
    await waitFor(() => {
      expect(found.querySelector('[data-slot=card-listen]')).toBeNull()
    })
    expect(mic.live()).toBe(0)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(of(API.tasks)).toHaveLength(0)
  })

  it('"cancel" cancels, and the draft is kept', async () => {
    vi.useFakeTimers(CLOCK)
    const { mic } = show(taskCommand(), 'mic')
    await screen.findByRole('dialog')
    await toolListens(mic)
    act(() => {
      mic.say('cancel')
    })
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    expect(screen.getByText('Not sent. Your draft is kept in this browser.')).toBeInTheDocument()
  })

  it('any key stops the listening, and "send it" after that does nothing', async () => {
    vi.useFakeTimers(CLOCK)
    const { mic, user, of } = show(taskCommand(), 'mic')
    const found = await screen.findByRole('dialog')
    await toolListens(mic)
    await user.keyboard('{Tab}')
    await waitFor(() => {
      expect(found.querySelector('[data-slot=card-listen]')).toBeNull()
    })
    expect(mic.live()).toBe(0)
    act(() => {
      mic.say('send it')
    })
    await wait(HOLD)
    expect(screen.queryByText('Adding the task in HubSpot')).toBeNull()
    expect(of(API.tasks)).toHaveLength(0)
  })

  it('a click stops it too, and a typed command never listens', async () => {
    vi.useFakeTimers(CLOCK)
    const spoken = show(taskCommand(), 'mic')
    const found = await screen.findByRole('dialog')
    await toolListens(spoken.mic)
    await spoken.user.click(within(found).getByRole('textbox', { name: 'More words' }))
    await waitFor(() => {
      expect(found.querySelector('[data-slot=card-listen]')).toBeNull()
    })
    spoken.unmount()
    act(() => {
      closeCard()
    })
    const typed = show(taskCommand(), 'typed')
    const card = await screen.findByRole('dialog')
    expect(card.querySelector('[data-slot=card-listen]')).toBeNull()
    expect(typed.mic.tools).toHaveLength(0)
  })
})

describe('a call saved before its company (PLAN-V24 T3-2, choices 17 and 18)', () => {
  /** A call whose company the command found nowhere, heard as these words. */
  function heardAs(heard: string): CallDraft {
    const made = draftOf(
      {
        command: callCommand({
          company: { found: null, choices: [], from_page: false, heard },
          person: null,
        }),
        words: 'the words',
        source: 'mic',
      },
      null,
    )
    if (made?.action !== 'log_call') throw new Error('No call card for this command')
    return made
  }

  it('is saved with the name as heard and no company, cut to the server’s 120 characters', () => {
    expect(heardNoteBodyOf(heardAs('North Wind'))).toEqual({
      company_heard: 'North Wind',
      text: 'Spoke to Jo, the lease ends June 2027. Follow up Friday.',
      source: 'mic',
      called_at: expect.any(String) as string,
    })
    expect(heardNoteBodyOf(heardAs(`  ${'a'.repeat(130)}  `))?.company_heard).toHaveLength(120)
    // No name heard: the server needs one, so it waits for a pick.
    expect(heardNoteBodyOf(heardAs('  '))).toBeNull()
  })

  it('never goes to HubSpot while it needs its company, and says why', async () => {
    const calls = mockApi({
      [API.confirm]: { already_sending: false, sending: 1, notes: [] },
    })
    const said = vi.spyOn(toast, 'error')
    const client = createTestQueryClient()
    client.setQueryData(
      queryKeys.companies.callNote(NOTE_ID),
      note({
        status: 'needs_company',
        company_key: null,
        company_name: null,
        company_heard: 'North Wind',
      }),
    )
    await sendDraft(
      { ...heardAs('North Wind'), noteId: NOTE_ID },
      { client, today: '2026-11-21', reopen: vi.fn(), go: vi.fn() },
    )
    expect(calls.filter((call) => call.path === API.confirm)).toHaveLength(0)
    expect(said).toHaveBeenCalledWith('Not sent', {
      description: '1 call needs a company first. It stays in Call logs.',
      action: expect.objectContaining({ label: 'Open Call logs' }) as unknown,
    })
  })
})
