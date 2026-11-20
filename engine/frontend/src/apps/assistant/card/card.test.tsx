/**
 * The review card (PLAN-V22 T3-3, choices 19 to 21 and 24), with a fake server and a fake mic: each
 * layout, each key rule, the half second guard, the jump to a box still to fill, each choice, and a
 * change by voice. Sending itself (the hold, Undo and "send it") is in `send.test.tsx`. Made-up
 * names only: Sample Logistics Pty Ltd, Jo Sample.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { useLocation } from 'react-router'
import type { SignIn } from '@/api/hooks/auth'
import { queryKeys } from '@/api/query'
import type { AssistantCommand, CallNoteOut, CallNotePatch } from '@/api/types'
import { FakeMic, type FakeMicOptions } from '@/apps/companies/call-notes/mic/fake-mic'
import { mockApi, type Answer } from '@/test/mock-api'
import { createTestQueryClient, renderWithProviders } from '@/test/render'
import {
  API,
  callCommand,
  CLOCK,
  command,
  emailCommand,
  FOLLOW_UP,
  JAMES,
  JAMES_TOO,
  LEASE,
  note,
  NOTE_ID,
  notePath,
  notePreview,
  options,
  OTHER_SAMPLE,
  SAM,
  SAM_TOO,
  SAMPLE,
  taskCommand,
  teamEmail,
  write,
} from './fixtures'
import { CardHost } from './host'
import { closeCard, openCard } from './store'
import type { CardTimes } from './times'

type Opening = Parameters<typeof openCard>[0]

function Where() {
  const location = useLocation()
  return (
    <p data-testid="where" data-state={JSON.stringify(location.state ?? null)}>
      {location.pathname}
    </p>
  )
}

interface Show {
  answers?: Record<string, unknown>
  mic?: FakeMicOptions
  times?: Partial<CardTimes>
  signIn?: SignIn
}

/** Opens a card on a page with a fake server. Enter works at once unless `times.guard` says. */
function show(opening: Opening, { answers = {}, mic: micOptions, times, signIn }: Show = {}) {
  const mic = new FakeMic(micOptions)
  const calls = mockApi({
    [API.options]: options(),
    [API.summary]: { to_confirm: 0, needs_look: 0, logged_today: 0 },
    [API.taskPreview]: write(),
    [API.emailPreview]: teamEmail(),
    [API.team]: [SAM, SAM_TOO],
    ...answers,
  })
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(queryKeys.auth.me(), signIn ?? { state: 'off' })
  const view = renderWithProviders(
    <>
      <button type="button">The page</button>
      <CardHost
        env={mic.env()}
        makeTool={mic.tool}
        times={{ guard: 0, preview: 0, sort: 20, ...times }}
      />
      <Where />
    </>,
    { queryClient },
  )
  act(() => {
    openCard(opening)
  })
  const of = (path: string) => calls.filter((call) => call.path === path)
  return { mic, calls, of, ...view }
}

function typed(made: AssistantCommand, words = 'typed words'): Opening {
  return { kind: 'command', command: made, words, source: 'typed' }
}

async function card() {
  return screen.findByRole('dialog')
}

/** The send hasn't started: no hold toast, and the card is open. */
function notSending() {
  expect(screen.queryByText(/^(Adding the task|Sending the)/)).toBeNull()
  expect(screen.getByRole('dialog')).toBeInTheDocument()
}

afterEach(() => {
  act(() => {
    closeCard()
    toast.dismiss()
  })
  window.localStorage.clear()
})

describe('each layout (choice 24)', () => {
  it('a task: the read-back first, then the company, what, when, the kind, for whom and more words', async () => {
    show(typed(taskCommand()))
    const found = await card()
    expect(found).toHaveAccessibleName(
      'Add a task for you: send Sample Logistics the quote, due Fri 27 Nov.',
    )
    expect(within(found).getByText('Sample Logistics Pty Ltd')).toBeInTheDocument()
    expect(within(found).getByRole('textbox', { name: 'What to do' })).toHaveValue(
      'Send Sample Logistics the quote',
    )
    expect(within(found).getByRole('textbox', { name: 'When' })).toHaveValue('Friday')
    expect(within(found).getByText('Due Fri 27 Nov 2099')).toBeInTheDocument()
    expect(within(found).getByRole('radio', { name: 'Email' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(within(found).getByText('You')).toBeInTheDocument()
    expect(within(found).getByRole('textbox', { name: 'More words' })).toHaveValue('')
    // Each box has its own mic, which writes straight into it (choice 19), once the voice tool
    // setting is known (PLAN-V24 T4-3: no mic on a guess).
    expect(await within(found).findAllByRole('button', { name: 'Speak' })).toHaveLength(2)
  })

  it('a task: the preview asks the server once the boxes settle, with the card’s key', async () => {
    const { of } = show(typed(taskCommand()), {
      answers: { [API.taskPreview]: write({ waiting_for: 'Waiting for HubSpot write access.' }) },
    })
    const found = await card()
    expect(await within(found).findByText('Waiting for HubSpot write access.')).toBeInTheDocument()
    const [asked] = of(API.taskPreview)
    expect(asked?.body).toEqual({
      company_key: '201',
      subject: 'Send Sample Logistics the quote',
      body: '',
      due: '2099-11-27',
      kind: 'email',
      owner_id: null,
    })
    expect(asked?.headers?.get('idempotency-key')).toBeTruthy()
  })

  it('a call: it is saved at once, sorts, then shows how it went, the note, the changes and the follow-ups', async () => {
    const { of } = show(
      { kind: 'command', command: callCommand(), words: 'log a call with Jo', source: 'typed' },
      {
        answers: {
          [API.notes]: note({
            status: 'sorting',
            call: { in_hubspot: false, outcome: null, summary: '' },
          }),
          [notePath()]: note(),
          [API.notePreview]: notePreview(
            note({ changes: [{ ...note().changes[0], current: '2026-12-31' }] }),
          ),
        },
      },
    )
    const found = await card()
    expect(found).toHaveAccessibleName(
      'Log a call with Jo Sample at Sample Logistics. Follow-up task on Fri 27 Nov.',
    )
    expect(within(found).getByText('Jo Sample')).toBeInTheDocument()
    await waitFor(() => {
      expect(of(API.notes)).toHaveLength(1)
    })
    expect(of(API.notes)[0]?.body).toMatchObject({
      company_key: '201',
      contact_id: 'c-1',
      text: 'Spoke to Jo, the lease ends June 2027. Follow up Friday.',
      source: 'typed',
    })
    expect(of(API.notes)[0]?.headers?.get('idempotency-key')).toBeTruthy()
    // The sort, once ready, with HubSpot's value now (from a fresh preview) and the new one, each
    // part a box to type in (PLAN-V23 T4-2).
    expect(await within(found).findByRole('button', { name: 'Connected' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(within(found).getByRole('textbox', { name: 'The note' })).toHaveValue(
      'Jo says the lease ends in June 2027.',
    )
    const changes = await within(found).findByRole('region', { name: 'Changes' })
    await waitFor(() => {
      expect(changes).toHaveTextContent('31 Dec 2026')
    })
    expect(
      within(changes).getByRole('textbox', { name: 'Lease end · Perth: new value' }),
    ).toHaveValue('30 June 2027')
    expect(within(found).getByRole('textbox', { name: 'Follow-up 1: what to do' })).toHaveValue(
      'Call Jo about the lease',
    )
    expect(of(API.notePreview)[0]?.body).toEqual({ ids: [NOTE_ID] })
  })

  it('a call: while HubSpot sending is off, it says so, and Send waits', async () => {
    show(typed(callCommand()), {
      answers: {
        [API.notes]: note(),
        [notePath()]: note(),
        [API.notePreview]: notePreview(note(), { sending_ready: false }),
      },
    })
    const found = await card()
    expect(
      await within(found).findByText(
        'Sending to HubSpot is off for now, so the call waits in Call logs. Nothing is lost.',
      ),
    ).toBeInTheDocument()
    expect(within(found).getByRole('button', { name: 'Send' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })

  it('an email: to whom, the subject, and the body as text, never as HTML', async () => {
    show(typed(emailCommand()))
    const found = await card()
    expect(found).toHaveAccessibleName('Email Sam Sample: The Sample Logistics floor plan.')
    expect(within(found).getByText('Sam Sample')).toBeInTheDocument()
    expect(within(found).getByRole('textbox', { name: 'Subject' })).toHaveValue(
      'The Sample Logistics floor plan',
    )
    const body = within(found).getByRole('textbox', { name: 'The email' })
    expect(body).toHaveValue('The floor plan is ready. <b>Have a look</b> before Friday.')
    expect(found.querySelector('b')).toBeNull()
  })

  it('an email: a person it can’t go to says why, and Enter goes to them first', async () => {
    const { user } = show(
      typed(
        emailCommand({
          email: {
            to: [
              { heard: 'Sam', found: SAM, choices: [], address: null, problem: null },
              {
                heard: 'jo@client.example',
                found: null,
                choices: [],
                address: 'jo@client.example',
                problem: 'Not a Contour address.',
              },
            ],
            subject: 'The floor plan',
            body: 'It is ready.',
          },
        }),
      ),
    )
    const found = await card()
    expect(within(found).getByText('Not a Contour address.')).toBeInTheDocument()
    await user.keyboard('{Enter}')
    expect(within(found).getByRole('button', { name: 'Remove jo@client.example' })).toHaveFocus()
    notSending()
  })

  it('a pre-read with two meetings asks which, and the one picked opens', async () => {
    const meetings = [
      {
        id: 'm-1',
        title: 'Fit-out walkthrough',
        starts_at: '2099-11-26T23:00:00Z',
        company_key: '201',
        company_name: SAMPLE.name,
        form: {
          id: 'form-1',
          sent_at: null,
          sent_count: 0,
          sent_names: [],
          status: 'draft' as const,
        },
      },
      {
        id: 'm-2',
        title: 'Lease review',
        starts_at: '2099-11-27T23:00:00Z',
        company_key: '201',
        company_name: SAMPLE.name,
        form: null,
      },
    ]
    const { user } = show(
      typed(
        command({
          action: 'pre_read',
          read_back: 'Make a pre-read for a Sample Logistics meeting.',
          meeting: { found: null, choices: meetings, from_page: false, heard: '' },
        }),
      ),
    )
    const found = await card()
    expect(within(found).getByRole('group', { name: 'Which meeting?' })).toBeInTheDocument()
    await user.click(within(found).getByRole('button', { name: /Fit-out walkthrough/ }))
    await waitFor(() => {
      expect(screen.getByTestId('where')).toHaveTextContent('/assistant/meetings/form-1')
    })
  })

  it('a pre-read with no meeting ahead says so, with New pre-read', async () => {
    const { user } = show(
      typed(
        command({
          action: 'pre_read',
          read_back: 'Make a pre-read for Sample Logistics.',
          company: { found: SAMPLE, choices: [], from_page: false, heard: 'Sample Logistics' },
          meeting: { found: null, choices: [], from_page: false, heard: '' },
        }),
      ),
    )
    const found = await card()
    expect(
      within(found).getByText(
        'Sample Logistics Pty Ltd has no meeting in HubSpot in the next 60 days. Start a pre-read and type the date.',
      ),
    ).toBeInTheDocument()
    await user.click(within(found).getByRole('button', { name: 'New pre-read' }))
    await waitFor(() => {
      expect(screen.getByTestId('where')).toHaveTextContent('/assistant/meetings')
    })
    // Meetings opens its New pre-read with the company filled in (PLAN-V23 T4-2).
    expect(JSON.parse(screen.getByTestId('where').dataset.state ?? 'null')).toEqual({
      newPreRead: { key: '201', name: 'Sample Logistics Pty Ltd' },
    })
  })
})

/**
 * A note on the server that takes edits (PATCH) and answers with the note as it is now, as the
 * real one does: so the card's own copy, read again after an edit, keeps what was typed.
 */
function noteServer(start: CallNoteOut = note()): Answer {
  let now = start
  return (call) => {
    if (call.method === 'PATCH') {
      const patch = call.body as CallNotePatch
      now = {
        ...now,
        call: {
          ...now.call,
          ...(typeof patch.summary === 'string' ? { summary: patch.summary } : {}),
          ...(patch.outcome !== undefined ? { outcome: patch.outcome } : {}),
        },
        changes: patch.changes
          ? patch.changes.map((change, index) => ({
              ...(now.changes[index] ?? LEASE),
              ...change,
              id: change.id ?? `c-new-${String(index)}`,
              office: change.office ?? '',
            }))
          : now.changes,
        tasks: patch.tasks
          ? patch.tasks.map((task, index) => ({
              ...(now.tasks[index] ?? FOLLOW_UP),
              ...task,
              id: task.id ?? `t-new-${String(index)}`,
              due_words: task.due_words ?? '',
            }))
          : now.tasks,
      }
    }
    return Response.json(now)
  }
}

function callAnswers(): Record<string, unknown> {
  return {
    [API.notes]: note(),
    [notePath()]: noteServer(),
    [API.notePreview]: notePreview(),
  }
}

describe('typing in a call, and Later (PLAN-V23 T4-2)', () => {
  it('each box of a call takes typing, and saves when it is left', async () => {
    const { user, of } = show(typed(callCommand()), { answers: callAnswers() })
    const found = await card()
    const patches = () =>
      of(notePath())
        .filter((call) => call.method === 'PATCH')
        .map((call) => call.body)

    // The note.
    const summary = await within(found).findByRole('textbox', { name: 'The note' })
    await user.click(summary)
    await user.type(summary, ' Wants three options.')
    await user.tab()
    await waitFor(() => {
      expect(patches()).toContainEqual({
        summary: 'Jo says the lease ends in June 2027. Wants three options.',
      })
    })

    // How it went.
    await user.click(within(found).getByRole('button', { name: 'No answer' }))
    await waitFor(() => {
      expect(patches()).toContainEqual({ outcome: 'No answer' })
    })
    expect(within(found).getByRole('button', { name: 'No answer' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    // A change's new value: any way of writing the day, saved in one form.
    const lease = within(found).getByRole('textbox', { name: 'Lease end · Perth: new value' })
    await user.clear(lease)
    await user.type(lease, '31/12/2027{Enter}')
    await waitFor(() => {
      expect(patches()).toContainEqual({
        changes: [{ id: 'c1', field: 'lease_end', office: 'Perth', value: '2027-12-31' }],
      })
    })

    // A follow-up's words, and its day: the read-back follows the day.
    const what = within(found).getByRole('textbox', { name: 'Follow-up 1: what to do' })
    await user.clear(what)
    await user.type(what, 'Send Jo three options{Enter}')
    const when = within(found).getByRole('textbox', { name: 'Follow-up 1: when' })
    await user.clear(when)
    await user.type(when, '30/11/2099{Enter}')
    await waitFor(() => {
      expect(patches()).toContainEqual({
        tasks: [
          {
            id: 't1',
            subject: 'Send Jo three options',
            due: '2099-11-30',
            due_words: '30/11/2099',
            kind: 'call',
          },
        ],
      })
    })
    await waitFor(() => {
      expect(found).toHaveAccessibleName(
        'Log a call with Jo Sample at Sample Logistics Pty Ltd. Follow-up task on Mon 30 Nov 2099.',
      )
    })
    // Typing sends nothing to HubSpot: the card is still open.
    expect(of(API.confirm)).toHaveLength(0)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('a follow-up added by typing goes with the others', async () => {
    const { user, of } = show(typed(callCommand()), { answers: callAnswers() })
    const found = await card()
    await user.click(await within(found).findByRole('button', { name: 'Add a follow-up' }))
    const what = within(found).getByRole('textbox', { name: 'What to do' })
    await user.type(what, 'Email the floor plan')
    await user.type(within(found).getByRole('textbox', { name: 'When' }), '1/12/2099')
    await user.click(within(found).getByRole('button', { name: 'Add' }))
    await waitFor(() => {
      const last = of(notePath())
        .filter((call) => call.method === 'PATCH')
        .at(-1)?.body as CallNotePatch | undefined
      expect(last?.tasks?.map((task) => [task.id, task.subject])).toEqual([
        ['t1', 'Call Jo about the lease'],
        [null, 'Email the floor plan'],
      ])
    })
  })

  it('Later keeps the call in To confirm, with its words, and says so', async () => {
    const { user, of } = show(typed(callCommand()), { answers: callAnswers() })
    const found = await card()
    await within(found).findByRole('textbox', { name: 'The note' })
    // A call is put off, not cancelled: Later, on the button and in the hint bar.
    expect(within(found).queryByRole('button', { name: 'Cancel' })).toBeNull()
    expect(found.querySelector('[data-slot=card-hints]')).toHaveTextContent('EscLater')
    await user.click(within(found).getByRole('button', { name: 'Later' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    expect(
      await screen.findByText('Kept in Call logs, to send with the others.'),
    ).toBeInTheDocument()
    // Saved once, as said, and never sent or taken away.
    expect(of(API.notes)).toHaveLength(1)
    expect(of(API.notes)[0]?.body).toMatchObject({
      text: 'Spoke to Jo, the lease ends June 2027. Follow up Friday.',
    })
    expect(of(API.confirm)).toHaveLength(0)
    expect(of(notePath()).filter((call) => call.method === 'DELETE')).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: 'Open Call logs' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/assistant/call-logs')
  })

  it('Esc on a call card does the same as Later', async () => {
    const { user, of } = show(typed(callCommand()), { answers: callAnswers() })
    const found = await card()
    await within(found).findByRole('textbox', { name: 'The note' })
    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    expect(
      await screen.findByText('Kept in Call logs, to send with the others.'),
    ).toBeInTheDocument()
    expect(of(API.confirm)).toHaveLength(0)
  })

  it('Later right after typing in a box saves the box first', async () => {
    const { user, of } = show(typed(callCommand()), { answers: callAnswers() })
    const found = await card()
    const summary = await within(found).findByRole('textbox', { name: 'The note' })
    await user.click(summary)
    await user.type(summary, ' Call back in March.')
    await user.click(within(found).getByRole('button', { name: 'Later' }))
    await waitFor(() => {
      expect(of(notePath()).find((call) => call.method === 'PATCH')?.body).toEqual({
        summary: 'Jo says the lease ends in June 2027. Call back in March.',
      })
    })
    expect(of(API.confirm)).toHaveLength(0)
  })

  it('Esc in a call’s box leaves it and keeps what was typed (choice 19); the next Esc is Later', async () => {
    const { user, of } = show(typed(callCommand()), { answers: callAnswers() })
    const found = await card()
    const summary = await within(found).findByRole('textbox', { name: 'The note' })
    await user.click(summary)
    await user.type(summary, ' Call back in March.')
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(within(found).getByRole('button', { name: 'Send' })).toHaveFocus()
    // Kept, as the task's and the email's boxes keep theirs, and saved as it was left.
    expect(summary).toHaveValue('Jo says the lease ends in June 2027. Call back in March.')
    await waitFor(() => {
      expect(of(notePath()).find((call) => call.method === 'PATCH')?.body).toEqual({
        summary: 'Jo says the lease ends in June 2027. Call back in March.',
      })
    })
    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    expect(
      await screen.findByText('Kept in Call logs, to send with the others.'),
    ).toBeInTheDocument()
  })

  it('an empty card marks a box still to fill only once Send was tried (PLAN-V23 T4-3)', async () => {
    const { user } = show({ kind: 'empty', action: 'task' })
    const found = await card()
    const what = await within(found).findByRole('textbox', { name: 'What to do' })
    expect(what).not.toHaveAttribute('aria-invalid')
    expect(within(found).getByRole('textbox', { name: 'When' })).not.toHaveAttribute('aria-invalid')
    await user.click(within(found).getByRole('button', { name: 'Send' }))
    // The first box still to fill takes the focus, and the empty ones say so.
    expect(within(found).getByRole('textbox', { name: 'Find a company' })).toHaveFocus()
    expect(what).toHaveAttribute('aria-invalid', 'true')
    expect(within(found).getByRole('textbox', { name: 'When' })).toHaveAttribute(
      'aria-invalid',
      'true',
    )
  })

  it('a task card keeps Cancel', async () => {
    show(typed(taskCommand()))
    const found = await card()
    expect(within(found).getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(within(found).queryByRole('button', { name: 'Later' })).toBeNull()
  })
})

describe('the keys (choices 19 and 20)', () => {
  it('a dialog: the focus starts on Send, and the page behind hears none of its keys', async () => {
    const heard = vi.fn()
    document.addEventListener('keydown', heard)
    const { user } = show(typed(taskCommand()))
    const found = await card()
    await waitFor(() => {
      expect(within(found).getByRole('button', { name: 'Send' })).toHaveFocus()
    })
    await user.keyboard('j')
    await user.keyboard('k')
    expect(heard).not.toHaveBeenCalled()
    document.removeEventListener('keydown', heard)
  })

  it('Enter does nothing for the first half second, then sends', async () => {
    vi.useFakeTimers(CLOCK)
    const { user } = show(typed(taskCommand()), { times: { guard: 500 } })
    const found = await card()
    await waitFor(() => {
      expect(within(found).getByRole('button', { name: 'Send' })).toHaveFocus()
    })
    await user.keyboard('{Enter}')
    notSending()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    await user.keyboard('{Enter}')
    expect(await screen.findByText('Adding the task in HubSpot')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
  })

  it('Enter with an empty required box goes to that box instead of sending', async () => {
    const { user } = show(
      typed(
        taskCommand({
          task: {
            subject: '',
            due: '2099-11-27',
            due_words: 'Friday',
            kind: 'todo',
            owner: null,
            owner_id: null,
          },
        }),
      ),
    )
    const found = await card()
    await waitFor(() => {
      expect(within(found).getByRole('button', { name: 'Send' })).toHaveFocus()
    })
    await user.keyboard('{Enter}')
    expect(within(found).getByRole('textbox', { name: 'What to do' })).toHaveFocus()
    notSending()
  })

  it('a day that can’t be read is a box still to fill', async () => {
    const { user } = show(typed(taskCommand()))
    const found = await card()
    const when = within(found).getByRole('textbox', { name: 'When' })
    await user.clear(when)
    await user.type(when, 'sometime soon')
    expect(
      within(found).getByText("That day can't be read. Try tomorrow, next tue or 24 nov."),
    ).toBeInTheDocument()
    await user.click(within(found).getByRole('button', { name: 'Send' }))
    expect(when).toHaveFocus()
    notSending()
  })

  it('in a box: Enter adds a line, Ctrl+Enter sends', async () => {
    const { user } = show(typed(taskCommand()))
    const found = await card()
    const more = within(found).getByRole('textbox', { name: 'More words' })
    await user.click(more)
    await user.keyboard('First line{Enter}second line')
    expect(more).toHaveValue('First line\nsecond line')
    notSending()
    await user.keyboard('{Control>}{Enter}{/Control}')
    expect(await screen.findByText('Adding the task in HubSpot')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
  })

  it('in a box, the first Esc leaves the box; the next cancels, and the draft is kept', async () => {
    const { user } = show(typed(taskCommand()))
    const found = await card()
    const what = within(found).getByRole('textbox', { name: 'What to do' })
    await user.click(what)
    await user.type(what, ' today')
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(within(found).getByRole('button', { name: 'Send' })).toHaveFocus()
    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    expect(
      await screen.findByText('Not sent. Your draft is kept in this browser.'),
    ).toBeInTheDocument()
    expect(window.localStorage.getItem('assistant.card-drafts')).toContain(
      'Send Sample Logistics the quote today',
    )
    // Open brings the card back with the draft as it was.
    await user.click(screen.getByRole('button', { name: 'Open' }))
    expect(within(await card()).getByRole('textbox', { name: 'What to do' })).toHaveValue(
      'Send Sample Logistics the quote today',
    )
  })

  it('the hint bar shows real keys: on the card, and inside a box', async () => {
    const { user } = show(typed(taskCommand()))
    const found = await card()
    const hints = found.querySelector<HTMLElement>('[data-slot=card-hints]')
    expect(hints).toHaveTextContent('EnterSend')
    expect(hints).toHaveTextContent('EscCancel')
    expect(hints).toHaveTextContent('VSpeak')
    await user.click(within(found).getByRole('textbox', { name: 'What to do' }))
    expect(hints).toHaveTextContent('Ctrl+EnterSend')
    expect(hints).toHaveTextContent('EscLeave the box')
  })

  it('V in a box types a v', async () => {
    const { user, of } = show(typed(taskCommand()))
    const found = await card()
    const more = within(found).getByRole('textbox', { name: 'More words' })
    await user.click(more)
    await user.keyboard('v')
    expect(more).toHaveValue('v')
    expect(found.querySelector('[data-slot=card-voice]')).toBeNull()
    expect(of(API.command)).toHaveLength(0)
  })
})

describe('the choices', () => {
  it('Which James? The arrow keys move, Enter picks, and the call is saved with that person', async () => {
    const { user, of } = show(
      typed(
        callCommand({
          person: { found: null, choices: [JAMES, JAMES_TOO], heard: 'James' },
        }),
      ),
      {
        answers: {
          [API.notes]: note({ person: JAMES_TOO }),
          [notePath()]: note(),
          [API.notePreview]: notePreview(),
        },
      },
    )
    const found = await card()
    const group = within(found).getByRole('group', { name: 'Which James?' })
    expect(
      within(group)
        .getAllByRole('button')
        .map((one) => one.textContent),
    ).toEqual(['James SampleDirector', 'James ExampleFacilities lead', 'No one in particular'])
    // Nothing is saved until the person is picked.
    expect(of(API.notes)).toHaveLength(0)
    // Enter on Send goes to the choice first.
    await waitFor(() => {
      expect(within(found).getByRole('button', { name: 'Send' })).toHaveFocus()
    })
    await user.keyboard('{Enter}')
    expect(within(group).getAllByRole('button')[0]).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(within(group).getAllByRole('button')[1]).toHaveFocus()
    await user.keyboard('{Enter}')
    await waitFor(() => {
      expect(of(API.notes)).toHaveLength(1)
    })
    expect(of(API.notes)[0]?.body).toMatchObject({ contact_id: 'c-3' })
    expect(within(found).getByText('James Example')).toBeInTheDocument()
  })

  it('No one in particular saves the call on the company alone', async () => {
    const { user, of } = show(
      typed(callCommand({ person: { found: null, choices: [JAMES, JAMES_TOO], heard: 'James' } })),
      {
        answers: {
          [API.notes]: note({ person: null }),
          [notePath()]: note(),
          [API.notePreview]: notePreview(),
        },
      },
    )
    const found = await card()
    await user.click(within(found).getByRole('button', { name: 'No one in particular' }))
    await waitFor(() => {
      expect(of(API.notes)).toHaveLength(1)
    })
    expect(of(API.notes)[0]?.body).toMatchObject({ contact_id: null })
  })

  it('Which Sample? picks one of two companies', async () => {
    const { user, of } = show(
      typed(
        taskCommand({
          company: {
            found: null,
            choices: [SAMPLE, OTHER_SAMPLE],
            from_page: false,
            heard: 'Sample',
          },
        }),
      ),
    )
    const found = await card()
    const group = within(found).getByRole('group', { name: 'Which Sample?' })
    await user.click(within(group).getByRole('button', { name: /Sample Freight/ }))
    expect(within(found).getByText('Sample Freight Pty Ltd')).toBeInTheDocument()
    await waitFor(() => {
      expect(of(API.taskPreview).at(-1)?.body).toMatchObject({ company_key: '202' })
    })
  })

  it('no company found: the plan’s words, then a search, and a pick', async () => {
    const { user } = show(
      typed(
        taskCommand({
          company: { found: null, choices: [], from_page: false, heard: 'North Wind' },
        }),
      ),
      { answers: { [API.search]: { companies: [SAMPLE], people: [] } } },
    )
    const found = await card()
    expect(
      within(found).getByText("We couldn't find 'North Wind' in HubSpot. Pick the company."),
    ).toBeInTheDocument()
    const box = within(found).getByRole('textbox', { name: 'Find a company' })
    await user.clear(box)
    await user.type(box, 'Sample')
    await user.click(await within(found).findByRole('button', { name: /Sample Logistics/ }))
    expect(within(found).getByText('Sample Logistics Pty Ltd')).toBeInTheDocument()
    expect(within(found).queryByRole('textbox', { name: 'Find a company' })).toBeNull()
  })

  it('Which Sam? picks the teammate an email goes to', async () => {
    const { user, of } = show(
      typed(
        emailCommand({
          email: {
            to: [
              { heard: 'Sam', found: null, choices: [SAM, SAM_TOO], address: null, problem: null },
            ],
            subject: 'The floor plan',
            body: 'It is ready.',
          },
        }),
      ),
    )
    const found = await card()
    await user.click(within(found).getByRole('button', { name: 'Sam Example' }))
    await waitFor(() => {
      expect(of(API.emailPreview).at(-1)?.body).toMatchObject({ owner_ids: ['o-3'] })
    })
  })

  it('Add someone: a teammate by name, or a Contour address', async () => {
    const { user, of } = show(typed(emailCommand()))
    const found = await card()
    const add = within(found).getByRole('textbox', { name: 'Add someone' })
    await user.type(add, 'pat@contour.example{Enter}')
    expect(within(found).getByText('pat@contour.example')).toBeInTheDocument()
    // Enter in the box adds; it never sends.
    notSending()
    await waitFor(() => {
      expect(of(API.emailPreview).at(-1)?.body).toMatchObject({
        owner_ids: ['o-2'],
        emails: ['pat@contour.example'],
      })
    })
  })
})

describe('a change by voice (choice 19)', () => {
  /** The fake mic hears these words, then V ends the talk. */
  async function speak(
    found: HTMLElement,
    mic: FakeMic,
    words: string,
    user: ReturnType<typeof show>['user'],
  ) {
    await user.keyboard('v')
    await waitFor(() => {
      expect(found.querySelector('[data-slot=card-voice]')).toHaveTextContent('Listening')
    })
    act(() => {
      mic.say(words)
    })
    await user.keyboard('v')
  }

  it('V on the card sends the words with the card’s boxes, and the change is made', async () => {
    const change: Answer = () =>
      Response.json(
        command({
          action: 'change',
          read_back: 'Change what to do.',
          change: { box: 'subject', value: 'Send Sample Logistics the floor plan', day: null },
        }),
      )
    const { mic, user, of } = show(typed(taskCommand()), { answers: { [API.command]: change } })
    const found = await card()
    await waitFor(() => {
      expect(within(found).getByRole('button', { name: 'Send' })).toHaveFocus()
    })
    await speak(found, mic, 'make it send them the floor plan', user)
    await waitFor(() => {
      expect(within(found).getByRole('textbox', { name: 'What to do' })).toHaveValue(
        'Send Sample Logistics the floor plan',
      )
    })
    expect(of(API.command)[0]?.body).toEqual({
      text: 'make it send them the floor plan',
      source: 'mic',
      card: { action: 'task', boxes: ['subject', 'due', 'kind', 'body'] },
    })
    // The read-back follows the boxes once changed.
    expect(found).toHaveAccessibleName(
      'Add a task for you: Send Sample Logistics the floor plan, due Fri 27 Nov 2099.',
    )
    expect(found.querySelector('[data-slot=card-voice]')).toBeNull()
  })

  it('on a call, "make the follow-up Monday" changes the follow-up’s day on the server', async () => {
    const patched: Answer = (call) =>
      call.method === 'PATCH'
        ? Response.json(note({ tasks: [{ ...note().tasks[0], due: '2099-11-30' }] }))
        : Response.json(note())
    const { mic, user, of } = show(typed(callCommand()), {
      answers: {
        [API.notes]: note(),
        [notePath()]: patched,
        [API.notePreview]: notePreview(),
        [API.command]: command({
          action: 'change',
          read_back: 'Make the follow-up Monday.',
          change: { box: 'follow-up', value: 'Monday', day: '2099-11-30' },
        }),
      },
    })
    const found = await card()
    await within(found).findByText('Connected')
    await speak(found, mic, 'make the follow-up Monday', user)
    await waitFor(() => {
      expect(of(notePath()).find((call) => call.method === 'PATCH')?.body).toEqual({
        tasks: [
          {
            id: 't1',
            subject: 'Call Jo about the lease',
            due: '2099-11-30',
            due_words: 'Monday',
            kind: 'call',
          },
        ],
      })
    })
    expect(of(API.command)[0]?.body).toMatchObject({
      card: { action: 'log_call', boxes: ['follow-up', 'outcome', 'summary'] },
    })
    // The read-back follows: the follow-up is on Monday now.
    await waitFor(() => {
      expect(found).toHaveAccessibleName(
        'Log a call with Jo Sample at Sample Logistics Pty Ltd. Follow-up task on Mon 30 Nov 2099.',
      )
    })
  })

  it('a change the card can’t make says what it can do, and V listens again', async () => {
    const { mic, user } = show(typed(taskCommand()), {
      answers: { [API.command]: command({ action: 'unknown', read_back: 'No.' }) },
    })
    const found = await card()
    await speak(found, mic, 'what is the weather', user)
    await waitFor(() => {
      expect(found.querySelector('[data-slot=card-voice]')).toHaveTextContent(
        'On this card you can change a box, send or cancel. Try saying it as one of those.',
      )
    })
    // A screen reader hears it once.
    expect(within(found).getByRole('status')).toHaveTextContent('On this card you can change a box')
    // Esc stops the change; the card stays.
    fireEvent.keyDown(found, { key: 'Escape' })
    await waitFor(() => {
      expect(found.querySelector('[data-slot=card-voice]')).toBeNull()
    })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
