/**
 * The review card for someone with no HubSpot user (PLAN-V23 T3-4, choice 15), with a fake server:
 *
 * - a call's follow-up needs a teammate in its "For" box before Send ("Who should do this
 *   follow-up? Pick a teammate.", with the team list), and keeps them through later edits;
 * - a task for yourself asks for a teammate ("You don't have a HubSpot user, so this task can't go
 *   to HubSpot. Give it to a teammate."), also when only the server's 409 `no_hubspot_user` says so.
 *
 * At a laptop's width (1440px) and a phone's (390px). Made-up names only: Sample Logistics Pty Ltd,
 * Jo Sample, Sam Sample.
 */
import { act, screen, waitFor, within } from '@testing-library/react'
import { toast } from 'sonner'
import { afterEach, describe, expect, it } from 'vitest'
import type { SignIn } from '@/api/hooks/auth'
import { queryKeys } from '@/api/query'
import type { AssistantTaskIn, CallNoteOut, CallNotePatch, TeamMember } from '@/api/types'
import { FakeMic } from '@/apps/companies/call-notes/mic/fake-mic'
import { mockApi, type Answer } from '@/test/mock-api'
import { createTestQueryClient, renderWithProviders } from '@/test/render'
import { asLaptop, asPhone } from '@/test/screen'
import {
  API,
  callCommand,
  FOLLOW_UP,
  note,
  notePath,
  notePreview,
  options,
  SAM,
  SAM_TOO,
  taskCommand,
  teamEmail,
  write,
} from './fixtures'
import { CardHost } from './host'
import { closeCard, openCard } from './store'
import { ownerIdOf, teammatesFor } from './teammate-rules'

const GIVE_IT =
  "You don't have a HubSpot user, so this task can't go to HubSpot. Give it to a teammate."
const WHO = 'Who should do this follow-up? Pick a teammate.'

/** Jo Sample, a designer: no HubSpot login. */
function signedIn(hubspot: 'none' | 'linked'): SignIn {
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

/**
 * A note on the server that takes edits, as the real one does: a follow-up's teammate is its
 * owner's name from the team list, and one sent without an owner is the rep's own (no name).
 */
function noteServer(team: readonly TeamMember[]): Answer {
  let now: CallNoteOut = note()
  return (call) => {
    if (call.method === 'PATCH') {
      const patch = call.body as CallNotePatch
      if (patch.tasks) {
        now = {
          ...now,
          tasks: patch.tasks.map((task, index) => ({
            ...(now.tasks[index] ?? FOLLOW_UP),
            id: task.id ?? `t-new-${String(index)}`,
            subject: task.subject,
            due: task.due,
            due_words: task.due_words ?? '',
            kind: task.kind ?? 'todo',
            owner: team.find((member) => member.owner_id === task.owner_id)?.name ?? null,
          })),
        }
      }
    }
    return Response.json(now)
  }
}

interface Show {
  signIn: SignIn
  answers?: Record<string, unknown>
}

function show(opening: Parameters<typeof openCard>[0], { signIn, answers = {} }: Show) {
  const mic = new FakeMic()
  const calls = mockApi({
    [API.options]: options(),
    [API.summary]: { to_confirm: 0, needs_look: 0, logged_today: 0 },
    [API.taskPreview]: write(),
    [API.emailPreview]: teamEmail(),
    [API.team]: [SAM, SAM_TOO],
    [API.notes]: note(),
    [notePath()]: noteServer([SAM, SAM_TOO]),
    [API.notePreview]: notePreview(),
    [API.confirm]: { sending: 1, already_sending: false, batch_id: 'b1', notes: [], skipped: [] },
    ...answers,
  })
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(queryKeys.auth.me(), signIn)
  const view = renderWithProviders(
    <CardHost env={mic.env()} makeTool={mic.tool} times={{ guard: 0, preview: 0, sort: 20 }} />,
    { queryClient },
  )
  act(() => {
    openCard(opening)
  })
  const of = (path: string) => calls.filter((call) => call.path === path)
  return { calls, of, ...view }
}

const callCard = {
  kind: 'command',
  command: callCommand(),
  words: 'log a call',
  source: 'typed',
} as const
const taskCard = {
  kind: 'command',
  command: taskCommand(),
  words: 'add a task',
  source: 'typed',
} as const

function patches(of: (path: string) => { method: string; body: unknown }[]): CallNotePatch[] {
  return of(notePath())
    .filter((call) => call.method === 'PATCH')
    .map((call) => call.body as CallNotePatch)
}

afterEach(() => {
  act(() => {
    closeCard()
    toast.dismiss()
  })
  window.localStorage.clear()
})

describe.each([
  ['a laptop (1440px)', asLaptop],
  ['a phone (390px)', asPhone],
])('no HubSpot user, on %s', (_width, size) => {
  it('a call’s follow-up needs a teammate in its "For" box before Send', async () => {
    size()
    const { user, of } = show(callCard, { signIn: signedIn('none') })
    const found = await screen.findByRole('dialog')
    const forBox = await within(found).findByRole('group', { name: WHO })
    // In place of "For you": the team list, as the card's choices.
    expect(within(found).queryByText('For you')).toBeNull()
    expect(within(forBox).getByRole('button', { name: 'Sam Sample' })).toBeInTheDocument()
    expect(within(forBox).getByRole('button', { name: 'Sam Example' })).toBeInTheDocument()

    // Send goes to the "For" box first, and nothing is sent.
    await waitFor(() => {
      expect(within(found).getByRole('button', { name: 'Send' })).not.toHaveAttribute(
        'aria-disabled',
      )
    })
    await user.click(within(found).getByRole('button', { name: 'Send' }))
    expect(within(forBox).getByRole('button', { name: 'Sam Sample' })).toHaveFocus()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(of(API.confirm)).toHaveLength(0)

    // Picked: the follow-up goes to Sam, and the box says so.
    await user.click(within(forBox).getByRole('button', { name: 'Sam Sample' }))
    await waitFor(() => {
      expect(patches(of).at(-1)?.tasks?.[0]).toMatchObject({ id: 't1', owner_id: 'o-2' })
    })
    expect(await within(found).findByText('For Sam Sample')).toBeInTheDocument()
    expect(within(found).queryByRole('group', { name: WHO })).toBeNull()

    // Now Send sends.
    await user.click(within(found).getByRole('button', { name: 'Send' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
  })

  it('a task for yourself asks for a teammate, and the task goes to them', async () => {
    size()
    const { user, of } = show(taskCard, { signIn: signedIn('none') })
    const found = await screen.findByRole('dialog')
    const forWhom = await within(found).findByRole('group', { name: GIVE_IT })
    // Not "You": a task for yourself can't go to HubSpot.
    expect(within(found).queryByText('You')).toBeNull()

    await user.click(within(found).getByRole('button', { name: 'Send' }))
    expect(within(forWhom).getByRole('button', { name: 'Sam Sample' })).toHaveFocus()
    expect(of(API.tasks)).toHaveLength(0)

    await user.click(within(forWhom).getByRole('button', { name: 'Sam Sample' }))
    expect(within(found).queryByRole('group', { name: GIVE_IT })).toBeNull()
    expect(within(found).getByText('Sam Sample')).toBeInTheDocument()
    await waitFor(() => {
      const asked = of(API.taskPreview).map((call) => call.body as AssistantTaskIn)
      expect(asked.at(-1)?.owner_id).toBe('o-2')
    })
  })
})

describe('no HubSpot user, the details', () => {
  it('a follow-up keeps its teammate when another part of it changes', async () => {
    const { user, of } = show(callCard, { signIn: signedIn('none') })
    const found = await screen.findByRole('dialog')
    const forBox = await within(found).findByRole('group', { name: WHO })
    await user.click(within(forBox).getByRole('button', { name: 'Sam Example' }))
    expect(await within(found).findByText('For Sam Example')).toBeInTheDocument()

    const what = within(found).getByRole('textbox', { name: 'Follow-up 1: what to do' })
    await user.clear(what)
    await user.type(what, 'Send Jo three options{Enter}')
    await waitFor(() => {
      expect(patches(of).at(-1)?.tasks?.[0]).toMatchObject({
        subject: 'Send Jo three options',
        owner_id: 'o-3',
      })
    })

    // Change picks someone else.
    await user.click(within(found).getByRole('button', { name: /^Change/ }))
    await user.click(
      within(await within(found).findByRole('group', { name: WHO })).getByRole('button', {
        name: 'Sam Sample',
      }),
    )
    await waitFor(() => {
      expect(patches(of).at(-1)?.tasks?.[0]).toMatchObject({ owner_id: 'o-2' })
    })
  })

  it('the server’s 409 on a task says the plan’s words once, with the team list', async () => {
    // This page didn't know yet (the account was changed since it read who is signed in).
    const refused = (call: { body: unknown }) =>
      (call.body as AssistantTaskIn).owner_id
        ? Response.json(write())
        : Response.json(
            {
              title: "You don't have a HubSpot user",
              status: 409,
              detail: GIVE_IT,
              code: 'no_hubspot_user',
            },
            { status: 409 },
          )
    show(taskCard, { signIn: signedIn('linked'), answers: { [API.taskPreview]: refused } })
    const found = await screen.findByRole('dialog')
    const forWhom = await within(found).findByRole('group', { name: GIVE_IT })
    expect(await within(forWhom).findByRole('button', { name: 'Sam Sample' })).toBeInTheDocument()
    expect(within(found).getAllByText(GIVE_IT)).toHaveLength(1)
    expect(within(found).queryByText(/^You don't have a HubSpot user\. /)).toBeNull()
  })

  it('the team list refused: its words say who to ask, and Send still waits', async () => {
    const { user, of } = show(callCard, {
      signIn: signedIn('none'),
      answers: {
        [API.team]: () =>
          Response.json(
            {
              title: 'No access',
              status: 403,
              detail: "You don't have access to Meetings. Ask Sam Sample to turn it on.",
              code: 'feature_not_allowed',
            },
            { status: 403 },
          ),
      },
    })
    const found = await screen.findByRole('dialog')
    expect(
      await within(found).findByText(
        "You don't have access to Meetings. Ask Sam Sample to turn it on.",
      ),
    ).toBeInTheDocument()
    await user.click(within(found).getByRole('button', { name: 'Send' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(of(API.confirm)).toHaveLength(0)
  })

  it('a linked account keeps "For you", with no team list', async () => {
    show(callCard, { signIn: signedIn('linked') })
    const found = await screen.findByRole('dialog')
    expect(await within(found).findByText('For you')).toBeInTheDocument()
    expect(within(found).queryByRole('group', { name: WHO })).toBeNull()
  })
})

describe('the teammate rules', () => {
  const team: TeamMember[] = [
    { owner_id: 'o-1', name: 'Jo Sample', has_account: true, is_me: true },
    SAM,
    SAM_TOO,
  ]

  it('offer everyone but you, by any word of the name', () => {
    expect(teammatesFor(team, '', 6).map((one) => one.name)).toEqual(['Sam Sample', 'Sam Example'])
    expect(teammatesFor(team, 'exa', 6).map((one) => one.name)).toEqual(['Sam Example'])
    expect(teammatesFor(team, 'sam s', 6).map((one) => one.name)).toEqual(['Sam Sample'])
    expect(teammatesFor(team, '', 1)).toHaveLength(1)
  })

  it('find a follow-up’s teammate by name', () => {
    expect(ownerIdOf({ owner: 'Sam Example' }, team)).toBe('o-3')
    expect(ownerIdOf({ owner: null }, team)).toBeNull()
    expect(ownerIdOf({ owner: 'Sam Example' }, undefined)).toBeNull()
  })
})
