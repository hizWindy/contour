/**
 * The gaps the card fills (PLAN-V25 T3-1 and T3-2), with a fake server and a fake mic: the call
 * type on a call, preset and changed by a tap or by voice; a day not said ("Due Monday?", In a
 * week, Pick a day); a subject not said (Use it, Type it); and the follow-up nudge on a Connected
 * call, by a tap or "yes", never on a No answer. The quick log is in `quick.test.tsx`. Made-up
 * names only: Sample Logistics Pty Ltd, Jo Sample.
 */
import { act, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { toast } from 'sonner'
import { queryKeys } from '@/api/query'
import type { AssistantCommand, CallNoteOut, CallNotePatch } from '@/api/types'
import { FakeMic } from '@/apps/companies/call-notes/mic/fake-mic'
import { mockApi, type Answer } from '@/test/mock-api'
import { createTestQueryClient, renderWithProviders } from '@/test/render'
import {
  API,
  callCommand,
  command,
  note,
  notePath,
  notePreview,
  options,
  SAM,
  taskCommand,
  write,
} from './fixtures'
import { CardHost } from './host'
import { closeCard, openCard } from './store'

/** A note on the server that answers a PATCH with the note as it is then. */
function noteServer(start: CallNoteOut): Answer {
  let now = start
  return (call) => {
    if (call.method === 'PATCH') {
      const patch = call.body as CallNotePatch
      now = {
        ...now,
        call: {
          ...now.call,
          ...(patch.call_type ? { call_type: patch.call_type } : {}),
        },
        tasks: patch.tasks
          ? patch.tasks.map((task, index) => ({
              ...task,
              id: task.id ?? `t-new-${String(index)}`,
              due_words: task.due_words ?? '',
              kind: task.kind ?? 'call',
              owner: null,
              in_hubspot: false,
            }))
          : now.tasks,
      }
    }
    return Response.json(now)
  }
}

function show(made: AssistantCommand, answers: Record<string, unknown> = {}) {
  const mic = new FakeMic()
  const calls = mockApi({
    [API.options]: options(),
    [API.summary]: { to_confirm: 0, needs_look: 0, logged_today: 0 },
    [API.taskPreview]: write(),
    [API.team]: [SAM],
    ...answers,
  })
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(queryKeys.auth.me(), { state: 'off' })
  const view = renderWithProviders(
    <CardHost env={mic.env()} makeTool={mic.tool} times={{ guard: 0, preview: 0, sort: 20 }} />,
    { queryClient },
  )
  act(() => {
    openCard({ kind: 'command', command: made, words: 'the words', source: 'typed' })
  })
  const of = (path: string, method = 'POST') =>
    calls.filter((call) => call.path === path && call.method === method)
  return { mic, of, ...view }
}

/** The fake mic hears these words, said to the card with V. */
async function speak(
  found: HTMLElement,
  mic: FakeMic,
  words: string,
  user: ReturnType<typeof show>['user'],
) {
  await waitFor(() => {
    expect(within(found).getByRole('button', { name: 'Send' })).toHaveFocus()
  })
  await user.keyboard('v')
  await waitFor(() => {
    expect(found.querySelector('[data-slot=card-voice]')).toHaveTextContent('Listening')
  })
  act(() => {
    mic.say(words)
  })
  await user.keyboard('v')
}

afterEach(() => {
  act(() => {
    closeCard()
    toast.dismiss()
  })
  window.localStorage.clear()
})

describe('the call type (T3-1)', () => {
  it('shows the type heard, goes with the save, and a tap changes it on the server', async () => {
    const start = note({ call: { in_hubspot: false, outcome: 'Connected', summary: 'Fine.' } })
    const { of, user } = show(callCommand({ call_type: 'Follow Up Call' }), {
      [API.notes]: start,
      [notePath()]: noteServer(start),
      [API.notePreview]: notePreview(start),
    })
    const found = await screen.findByRole('dialog')
    const group = await within(found).findByRole('radiogroup', { name: 'Call type' })
    expect(within(group).getByRole('radio', { name: 'Follow-up' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await waitFor(() => {
      expect(of(API.notes)[0]?.body).toMatchObject({ call_type: 'Follow Up Call' })
    })

    await within(found).findByRole('textbox', { name: 'The note' })
    await user.click(within(group).getByRole('radio', { name: 'Prospecting' }))
    expect(within(group).getByRole('radio', { name: 'Prospecting' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await waitFor(() => {
      expect(of(notePath(), 'PATCH').map((call) => call.body)).toEqual([
        { call_type: 'Prospecting Call' },
      ])
    })
    // One save only: the tap never saves the call again.
    expect(of(API.notes)).toHaveLength(1)
  })

  it('Prospecting Call by default; "make it a follow-up call" changes it by voice', async () => {
    const start = note()
    const change: Answer = () =>
      Response.json(
        command({
          action: 'change',
          read_back: 'Change the call type to Follow Up Call.',
          change: { box: 'call_type', value: 'Follow Up Call', day: null },
        }),
      )
    const { of, user, mic } = show(callCommand(), {
      [API.notes]: start,
      [notePath()]: noteServer(start),
      [API.notePreview]: notePreview(start),
      [API.command]: change,
    })
    const found = await screen.findByRole('dialog')
    const group = await within(found).findByRole('radiogroup', { name: 'Call type' })
    expect(within(group).getByRole('radio', { name: 'Prospecting' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await waitFor(() => {
      expect(of(API.notes)[0]?.body).toMatchObject({ call_type: 'Prospecting Call' })
    })
    await within(found).findByRole('textbox', { name: 'The note' })
    await speak(found, mic, 'make it a follow-up call', user)
    // The card names the box, so the command step can change it.
    expect(of(API.command)[0]?.body).toMatchObject({
      card: { action: 'log_call', boxes: ['follow-up', 'outcome', 'summary', 'call_type'] },
    })
    await waitFor(() => {
      expect(of(notePath(), 'PATCH').map((call) => call.body)).toEqual([
        { call_type: 'Follow Up Call' },
      ])
    })
    expect(within(group).getByRole('radio', { name: 'Follow-up' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })
})

/** "Add a task for Sample Logistics", with no day and no subject said. */
function vagueTask(): AssistantCommand {
  return taskCommand({
    read_back: 'Add a task for you: Follow up with Sample Logistics Pty Ltd, due Mon 30 Nov.',
    task: {
      subject: 'Follow up with Sample Logistics Pty Ltd',
      subject_suggested: true,
      due: '2099-11-30',
      due_words: '',
      due_level: 'likely',
      due_choices: ['2099-11-30', '2099-12-07'],
      kind: 'todo',
      owner: null,
      owner_id: null,
    },
  })
}

describe('a task with no day or subject said (T3-2)', () => {
  it('asks "Due Monday?" with In a week and Pick a day; In a week takes the week after', async () => {
    const { of, user } = show(vagueTask())
    const found = await screen.findByRole('dialog')
    expect(await within(found).findByText('Due Monday?')).toBeInTheDocument()
    expect(within(found).getByRole('button', { name: 'Pick a day' })).toBeInTheDocument()
    await user.click(within(found).getByRole('button', { name: 'In a week' }))
    expect(within(found).queryByText('Due Monday?')).toBeNull()
    expect(within(found).queryByRole('button', { name: 'In a week' })).toBeNull()
    expect(within(found).getByText('Due Mon 7 Dec 2099')).toBeInTheDocument()
    await waitFor(() => {
      expect(of(API.taskPreview).at(-1)?.body).toMatchObject({ due: '2099-12-07' })
    })
  })

  it('Pick a day opens the calendar', async () => {
    const { user } = show(vagueTask())
    const found = await screen.findByRole('dialog')
    await user.click(await within(found).findByRole('button', { name: 'Pick a day' }))
    expect(await screen.findByRole('grid')).toBeInTheDocument()
  })

  it('a day said shows as today: no question', async () => {
    show(taskCommand())
    const found = await screen.findByRole('dialog')
    expect(await within(found).findByText('Due Fri 27 Nov 2099')).toBeInTheDocument()
    expect(within(found).queryByRole('button', { name: 'In a week' })).toBeNull()
  })

  it('suggests a subject: Use it keeps it, and it goes as the subject', async () => {
    const { of, user } = show(vagueTask())
    const found = await screen.findByRole('dialog')
    expect(
      await within(found).findByText('Follow up with Sample Logistics Pty Ltd?'),
    ).toBeInTheDocument()
    expect(within(found).queryByRole('textbox', { name: 'What to do' })).toBeNull()
    await user.click(within(found).getByRole('button', { name: 'Use it' }))
    expect(within(found).getByRole('textbox', { name: 'What to do' })).toHaveValue(
      'Follow up with Sample Logistics Pty Ltd',
    )
    await waitFor(() => {
      expect(of(API.taskPreview).at(-1)?.body).toMatchObject({
        subject: 'Follow up with Sample Logistics Pty Ltd',
      })
    })
  })

  it('Type it puts the focus in the subject box, its words selected to type over', async () => {
    const { user } = show(vagueTask())
    const found = await screen.findByRole('dialog')
    await user.click(await within(found).findByRole('button', { name: 'Type it' }))
    const box = within(found).getByRole('textbox', { name: 'What to do' })
    await waitFor(() => {
      expect(box).toHaveFocus()
    })
    const input = box as HTMLInputElement
    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe(input.value.length)
    await user.keyboard('Send the quote')
    expect(box).toHaveValue('Send the quote')
  })
})

describe('the follow-up nudge (T3-2, choice 14)', () => {
  function connected(change: Partial<CallNoteOut> = {}): CallNoteOut {
    return note({ tasks: [], ...change })
  }

  it('a Connected call with no follow-up asks; Add it adds one on that day', async () => {
    const start = connected()
    const { of, user } = show(callCommand({ follow_up_day: '2099-11-27' }), {
      [API.notes]: start,
      [notePath()]: noteServer(start),
      [API.notePreview]: notePreview(start),
    })
    const found = await screen.findByRole('dialog')
    expect(
      await within(found).findByText('No follow-up yet. Add one for Friday?'),
    ).toBeInTheDocument()
    await user.click(within(found).getByRole('button', { name: 'Add it' }))
    await waitFor(() => {
      expect(of(notePath(), 'PATCH').map((call) => call.body)).toEqual([
        {
          tasks: [
            { subject: 'Follow up with Jo Sample', due: '2099-11-27', due_words: '', kind: 'call' },
          ],
        },
      ])
    })
    await waitFor(() => {
      expect(within(found).queryByText('No follow-up yet. Add one for Friday?')).toBeNull()
    })
  })

  it('"yes" said to the card adds it', async () => {
    const start = connected()
    const { of, user, mic } = show(callCommand({ follow_up_day: '2099-11-27' }), {
      [API.notes]: start,
      [notePath()]: noteServer(start),
      [API.notePreview]: notePreview(start),
      [API.command]: command({ action: 'unknown', read_back: '' }),
    })
    const found = await screen.findByRole('dialog')
    await within(found).findByText('No follow-up yet. Add one for Friday?')
    await speak(found, mic, 'yes', user)
    await waitFor(() => {
      expect(of(notePath(), 'PATCH')).toHaveLength(1)
    })
  })

  it('No puts it away, and nothing is added', async () => {
    const start = connected()
    const { of, user } = show(callCommand({ follow_up_day: '2099-11-27' }), {
      [API.notes]: start,
      [notePath()]: noteServer(start),
      [API.notePreview]: notePreview(start),
    })
    const found = await screen.findByRole('dialog')
    await within(found).findByText('No follow-up yet. Add one for Friday?')
    await user.click(within(found).getByRole('button', { name: 'No' }))
    expect(within(found).queryByText('No follow-up yet. Add one for Friday?')).toBeNull()
    expect(of(notePath(), 'PATCH')).toHaveLength(0)
  })

  it('never for No answer', async () => {
    const noAnswer = connected({
      call: { in_hubspot: false, outcome: 'No answer', summary: '' },
    })
    show(callCommand({ follow_up_day: '2099-11-27' }), {
      [API.notes]: noAnswer,
      [notePath()]: noteServer(noAnswer),
      [API.notePreview]: notePreview(noAnswer),
    })
    const found = await screen.findByRole('dialog')
    await within(found).findByRole('textbox', { name: 'The note' })
    expect(within(found).queryByText(/No follow-up yet/)).toBeNull()
  })

  it('never for a call that has a follow-up', async () => {
    const withOne = note()
    show(callCommand({ follow_up_day: '2099-11-27' }), {
      [API.notes]: withOne,
      [notePath()]: noteServer(withOne),
      [API.notePreview]: notePreview(withOne),
    })
    const again = await screen.findByRole('dialog')
    await within(again).findByRole('textbox', { name: 'The note' })
    expect(within(again).queryByText(/No follow-up yet/)).toBeNull()
  })
})
