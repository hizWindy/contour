/**
 * Smart choices on the review card (PLAN-V25 T1-2 and T2-2, choices 1, 4 to 7 and 11), with a fake
 * server, at a laptop's width (1440px) and a phone's (390px):
 *
 * - a likely pick shows one suggestion with its reason, said once; Enter, "yes" or a tap takes it;
 * - "Not this one" shows up to 3 choices and Search; the keys 1 to 3 pick;
 * - a sure pick is used at once, with Change and Undo (a saved call is saved again);
 * - the same part serves a company, a person, a teammate and a meeting;
 * - a person found before their company: "Jo Sample at Northwind Sample Pty Ltd?", and taking
 *   them fills both; found nowhere, the search for people and companies opens; a company heard
 *   with them still gives "Needs a company".
 *
 * Made-up names only: Sample Logistics Pty Ltd, Northwind Sample Pty Ltd, Jo Sample, Lee Client,
 * Mia Sample.
 */
import { act, screen, waitFor, within } from '@testing-library/react'
import { toast } from 'sonner'
import { useLocation } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import type {
  AssistantChoice,
  AssistantCommand,
  AssistantPersonHit,
  CallNoteIn,
  CallNoteOut,
  CallNotePatch,
} from '@/api/types'
import { FakeMic } from '@/apps/companies/call-notes/mic/fake-mic'
import { mockApi, type Answer } from '@/test/mock-api'
import { createTestQueryClient, renderWithProviders } from '@/test/render'
import { asLaptop, asPhone } from '@/test/screen'
import { queryKeys } from '@/api/query'
import { pickByVoice } from './choose'
import { draftOf, type CallDraft, type TaskDraft } from './draft'
import {
  API,
  callCommand,
  command,
  JO,
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
import { cardLinesOf, unsureLeft } from './lines'
import { closeCard, openCard } from './store'

type Opening = Parameters<typeof openCard>[0]

// --- Made-up data --------------------------------------------------------------------------------

const AT_TWO = 'You meet them at 2 pm.'
const LIKELY_LINE = `Sample Logistics Pty Ltd? ${AT_TWO}`
const NEW_ID = '7d0c5b8e-0000-4000-8000-000000000009'

const NORTHWIND_SAMPLE = {
  key: '501',
  name: 'Northwind Sample Pty Ltd',
  city: 'Sydney',
  industry: 'Freight',
  source: 'hubspot' as const,
}
const LEE: AssistantPersonHit = {
  id: 'c-7',
  name: 'Lee Client',
  title: 'Director',
  company_key: SAMPLE.key,
  company_name: SAMPLE.name,
}
const MIA = { id: 'c-8', name: 'Mia Sample', title: 'Office manager' }

function choice(hit: typeof SAMPLE, change: Partial<AssistantChoice> = {}): AssistantChoice {
  return { ...hit, ...change }
}

/** "Sample" said: three match, and the rep meets Sample Logistics at 2 pm, so it is likely. */
const LIKELY_CHOICES: AssistantChoice[] = [
  choice(SAMPLE, { reason: AT_TWO, detail: 'Perth' }),
  choice(OTHER_SAMPLE, { reason: 'Open deal.', detail: 'Melbourne' }),
  choice(NORTHWIND_SAMPLE, { detail: 'Owner: Sam Sample' }),
]

function likelyTask(change: Partial<AssistantCommand> = {}): AssistantCommand {
  return taskCommand({
    read_back: 'Add a task for you: send Sample the quote, due Fri 27 Nov.',
    company: {
      found: null,
      choices: LIKELY_CHOICES,
      from_page: false,
      heard: 'Sample',
      level: 'likely',
      reason: AT_TWO,
    },
    unsure: LIKELY_LINE,
    ...change,
  })
}

/** Jo Sample named with no company (T2-1): she is at Northwind Sample, and the rep called her. */
const JO_AT_NORTHWIND: AssistantPersonHit = {
  ...JO,
  company_key: NORTHWIND_SAMPLE.key,
  company_name: NORTHWIND_SAMPLE.name,
  reason: 'You called them on Monday.',
}
const JO_AT_SAMPLE: AssistantPersonHit = {
  ...JO,
  id: 'c-9',
  company_key: SAMPLE.key,
  company_name: SAMPLE.name,
}

function personFirst(change: Partial<AssistantCommand> = {}): AssistantCommand {
  return callCommand({
    read_back: 'Log a call with Jo Sample.',
    company: { found: null, choices: [], from_page: false, heard: '' },
    person: {
      found: null,
      choices: [JO_AT_NORTHWIND, JO_AT_SAMPLE],
      heard: 'Jo Sample',
      level: 'likely',
      reason: 'You called them on Monday.',
    },
    unsure: 'Jo Sample at Northwind Sample Pty Ltd? You called them on Monday.',
    ...change,
  })
}

// --- A fake server -----------------------------------------------------------------------------

/** Each call saved gets the next id; the newest is read back, sorted. */
function callServer() {
  const saved: CallNoteOut[] = []
  const notes: Answer = (call) => {
    if (call.method !== 'POST') return undefined
    const body = call.body as CallNoteIn
    const company = [SAMPLE, OTHER_SAMPLE, NORTHWIND_SAMPLE].find(
      (one) => one.key === body.company_key,
    )
    const made = note({
      id: saved.length === 0 ? NOTE_ID : NEW_ID,
      status: company ? 'to_confirm' : 'needs_company',
      company_key: company?.key ?? null,
      company_name: company?.name ?? null,
      company_heard: body.company_heard ?? null,
      person: body.contact_id === JO_AT_NORTHWIND.id ? JO : null,
    })
    saved.push(made)
    return Response.json(made, { status: 201 })
  }
  const one =
    (id: string): Answer =>
    (call) => {
      const found = saved.find((each) => each.id === id)
      if (!found) return undefined
      if (call.method === 'DELETE') return new Response(null, { status: 204 })
      if (call.method === 'PATCH') {
        const patch = call.body as CallNotePatch
        const company = [SAMPLE, OTHER_SAMPLE].find((each) => each.key === patch.company_key)
        const next = note({
          id,
          company_key: company?.key ?? found.company_key,
          company_name: company?.name ?? found.company_name,
        })
        saved[saved.indexOf(found)] = next
        return Response.json(next)
      }
      return Response.json(found)
    }
  return {
    saved,
    answers: {
      [API.notes]: notes,
      [notePath()]: one(NOTE_ID),
      [notePath(NEW_ID)]: one(NEW_ID),
      [API.notePreview]: notePreview(),
    },
  }
}

/** Our copy's search: the people and companies whose name holds the words. */
const search: Answer = (call) => {
  const q = (new URLSearchParams(call.search).get('q') ?? '').trim().toLowerCase()
  const people = [JO_AT_NORTHWIND, LEE].map(({ reason: _reason, ...person }) => ({
    ...person,
    company_key: person.company_key ?? null,
    company_name: person.company_name ?? null,
  }))
  return Response.json({
    people: people.filter((one) => one.name.toLowerCase().includes(q)),
    companies: [SAMPLE, NORTHWIND_SAMPLE].filter((one) => one.name.toLowerCase().includes(q)),
  })
}

function Where() {
  const location = useLocation()
  return <p data-testid="where">{location.pathname}</p>
}

function show(opening: Opening, answers: Record<string, unknown> = {}) {
  const mic = new FakeMic()
  const calls = mockApi({
    [API.options]: options(),
    [API.summary]: { to_confirm: 0, needs_look: 0, logged_today: 0 },
    [API.taskPreview]: write(),
    [API.emailPreview]: teamEmail(),
    [API.team]: [SAM, SAM_TOO],
    [API.search]: search,
    ...answers,
  })
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(queryKeys.auth.me(), { state: 'off' })
  const view = renderWithProviders(
    <>
      <CardHost env={mic.env()} makeTool={mic.tool} times={{ guard: 0, preview: 0, sort: 20 }} />
      <Where />
    </>,
    { queryClient },
  )
  act(() => {
    openCard(opening)
  })
  const of = (path: string, method?: string) =>
    calls.filter((call) => call.path === path && (method === undefined || call.method === method))
  return { calls, of, ...view }
}

function typed(made: AssistantCommand): Opening {
  return { kind: 'command', command: made, words: 'typed words', source: 'typed' }
}

async function card() {
  return screen.findByRole('dialog')
}

function suggestionLine(root: HTMLElement): HTMLElement {
  const line = root.querySelector<HTMLElement>('[data-slot=suggestion]')
  if (!line) throw new Error('no suggestion on the card')
  return line
}

afterEach(() => {
  act(() => {
    closeCard()
    toast.dismiss()
  })
  window.localStorage.clear()
})

// --- On screen ---------------------------------------------------------------------------------------

describe.each([
  ['a laptop (1440px)', asLaptop],
  ['a phone (390px)', asPhone],
])('smart choices, on %s', (_width, size) => {
  it('a likely company shows one suggestion with its reason, heard once, and Enter takes it', async () => {
    size()
    const { user } = show(typed(likelyTask()))
    const found = await card()
    expect(suggestionLine(found)).toHaveTextContent(LIKELY_LINE)
    // Said once: the server's own line for it is left out of the card's paragraph.
    expect(within(found).getAllByText(/You meet them at 2 pm/)).toHaveLength(1)
    const use = within(found).getByRole('button', { name: 'Use it' })
    // Heard as Use it's description. (The test's accessibility library drops the space at the
    // quieter span's edge; a browser keeps it.)
    expect(use).toHaveAccessibleDescription(/^Sample Logistics Pty Ltd\? ?You meet them at 2 pm\.$/)
    expect(within(found).getByRole('button', { name: 'Not this one' })).toBeInTheDocument()
    // Send stays the card's one main button; the choices aren't shown yet.
    expect(within(found).queryByRole('button', { name: /Sample Freight/ })).toBeNull()

    // Enter on Send, with the company still to pick, takes the suggestion.
    await waitFor(() => {
      expect(within(found).getByRole('button', { name: 'Send' })).toHaveFocus()
    })
    await user.keyboard('{Enter}')
    expect(within(found).getByText('Sample Logistics Pty Ltd')).toBeInTheDocument()
    expect(found.querySelector('[data-slot=suggestion]')).toBeNull()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('a tap on Use it takes it, and a pick from the command’s own choices teaches nothing', async () => {
    size()
    const server = callServer()
    const { user, of } = show(
      typed(
        callCommand({
          read_back: 'Log a call with Sample.',
          company: likelyTask().company,
          person: { found: null, choices: [], heard: '' },
          unsure: LIKELY_LINE,
        }),
      ),
      server.answers,
    )
    const found = await card()
    // Saved at once with the name as heard, as "Needs a company" (PLAN-V24).
    await waitFor(() => {
      expect(of(API.notes, 'POST')).toHaveLength(1)
    })
    await user.click(within(found).getByRole('button', { name: 'Use it' }))
    await waitFor(() => {
      expect(of(notePath(), 'PATCH')).toHaveLength(1)
    })
    expect(of(notePath(), 'PATCH')[0]?.body).toEqual({ company_key: SAMPLE.key, teach: false })
  })

  it('"Not this one" shows the other choices and Search, and the keys 1 to 3 pick', async () => {
    size()
    const { user } = show(typed(likelyTask()))
    const found = await card()
    await user.click(within(found).getByRole('button', { name: 'Not this one' }))
    const which = within(found).getByRole('group', { name: 'Which Sample?' })
    const buttons = within(which).getAllByRole('button')
    expect(buttons.map((one) => one.textContent)).toEqual([
      '1Sample Freight Pty LtdMelbourne',
      '2Northwind Sample Pty LtdOwner: Sam Sample',
    ])
    // The focus goes on to the first choice left.
    expect(buttons[0]).toHaveFocus()
    expect(within(found).getByRole('button', { name: 'Search' })).toBeInTheDocument()
    // Each choice shows its one detail.
    expect(within(which).getByText('Owner: Sam Sample')).toBeInTheDocument()

    await user.keyboard('2')
    expect(within(found).getByText('Northwind Sample Pty Ltd')).toBeInTheDocument()
    expect(within(found).queryByRole('group', { name: 'Which Sample?' })).toBeNull()
  })

  it('unsure shows at most 3 choices and Search, which opens the search list in their place', async () => {
    size()
    const fourth = choice({ ...SAMPLE, key: '599', name: 'Sample Fourth Pty Ltd' })
    const { user } = show(
      typed(
        likelyTask({
          company: {
            found: null,
            choices: [...LIKELY_CHOICES, fourth],
            from_page: false,
            heard: 'Sample',
            level: 'unsure',
          },
          unsure: 'Which Sample?',
        }),
      ),
    )
    const found = await card()
    const which = within(found).getByRole('group', { name: 'Which Sample?' })
    expect(within(which).getAllByRole('button')).toHaveLength(3)
    // "Which Sample?" shows once: the part's, not the server's paragraph too.
    expect(within(found).getAllByText('Which Sample?')).toHaveLength(1)
    await user.click(within(found).getByRole('button', { name: 'Search' }))
    const box = within(found).getByRole('textbox', { name: 'Find a company' })
    expect(box).toHaveValue('Sample')
    expect(box).toHaveFocus()
  })

  it('a sure company is used at once, with Change and Undo', async () => {
    size()
    const { user } = show(
      typed(
        taskCommand({
          company: {
            found: SAMPLE,
            choices: [
              choice(SAMPLE, { detail: 'Perth' }),
              choice(OTHER_SAMPLE, { detail: 'Melbourne' }),
            ],
            from_page: true,
            heard: 'Sample',
            level: 'sure',
            reason: 'On screen.',
          },
        }),
      ),
    )
    const found = await card()
    const line = found.querySelector('[data-slot=sure-line]')
    expect(line).toHaveTextContent('Sample Logistics Pty Ltd. On screen.')

    // Change: the choices, the one in use lit; another picked is used at once.
    await user.click(within(found).getByRole('button', { name: 'Change: Company' }))
    const which = within(found).getByRole('group', { name: 'Which Sample?' })
    expect(within(which).getByRole('button', { name: /Sample Logistics/ })).toHaveAttribute(
      'aria-current',
      'true',
    )
    await user.keyboard('2')
    expect(found.querySelector('[data-slot=sure-line]')).toHaveTextContent('Sample Freight Pty Ltd')
    expect(within(found).getByRole('button', { name: 'Change: Company' })).toHaveFocus()

    // Undo: the card asks again, and Send waits for a pick.
    await user.click(within(found).getByRole('button', { name: /^Undo/ }))
    const again = within(found).getByRole('group', { name: 'Which Sample?' })
    await user.click(within(found).getByRole('button', { name: 'Send' }))
    expect(within(again).getAllByRole('button')[0]).toHaveFocus()
    expect(screen.queryByText(/^Adding the task/)).toBeNull()
  })

  it('a sure company changed on a call: the call saved with it goes, and is saved again', async () => {
    size()
    const server = callServer()
    const { user, of } = show(
      typed(
        callCommand({
          company: {
            found: SAMPLE,
            choices: [choice(SAMPLE), choice(OTHER_SAMPLE)],
            from_page: false,
            heard: 'Sample',
            level: 'sure',
            reason: 'Yours.',
          },
        }),
      ),
      server.answers,
    )
    const found = await card()
    await waitFor(() => {
      expect(of(API.notes, 'POST')).toHaveLength(1)
    })
    await user.click(within(found).getByRole('button', { name: 'Change: Company' }))
    await user.click(within(found).getByRole('button', { name: /Sample Freight/ }))
    await waitFor(() => {
      expect(of(notePath(), 'DELETE')).toHaveLength(1)
      expect(of(API.notes, 'POST')).toHaveLength(2)
    })
    const [first, second] = of(API.notes, 'POST')
    expect((second?.body as CallNoteIn).company_key).toBe(OTHER_SAMPLE.key)
    // A new call, with its own key.
    expect(second?.headers?.get('Idempotency-Key')).not.toBe(first?.headers?.get('Idempotency-Key'))
  })

  it('a sure company undone on a call: the call is saved again as "Needs a company"', async () => {
    size()
    const server = callServer()
    const { user, of } = show(
      typed(
        callCommand({
          company: {
            found: SAMPLE,
            choices: [choice(SAMPLE), choice(OTHER_SAMPLE)],
            from_page: false,
            heard: 'Sample',
            level: 'sure',
            reason: 'Yours.',
          },
        }),
      ),
      server.answers,
    )
    const found = await card()
    await waitFor(() => {
      expect(of(API.notes, 'POST')).toHaveLength(1)
    })
    await user.click(within(found).getByRole('button', { name: /^Undo/ }))
    await waitFor(() => {
      expect(of(notePath(), 'DELETE')).toHaveLength(1)
      expect(of(API.notes, 'POST')).toHaveLength(2)
    })
    // No call lost (PLAN-V24): saved at once with the name as heard.
    expect(of(API.notes, 'POST')[1]?.body).toMatchObject({ company_heard: 'Sample' })
    // The one picked then goes as the call's company, from the command's choices: nothing taught.
    const which = within(found).getByRole('group', { name: 'Which Sample?' })
    await user.click(within(which).getByRole('button', { name: /Sample Freight/ }))
    await waitFor(() => {
      expect(of(notePath(NEW_ID), 'PATCH')).toHaveLength(1)
    })
    expect(of(notePath(NEW_ID), 'PATCH')[0]?.body).toEqual({
      company_key: OTHER_SAMPLE.key,
      teach: false,
    })
  })

  it('the same part serves a person, a teammate and a meeting', async () => {
    size()
    // A person at the company: suggested, with their reason.
    const { user, unmount } = show(
      typed(
        callCommand({
          person: {
            found: null,
            choices: [{ ...JO, reason: 'You called them on Monday.' }, MIA],
            heard: 'Jo',
            level: 'likely',
            reason: 'You called them on Monday.',
          },
          unsure: 'Jo Sample? You called them on Monday.',
        }),
      ),
      callServer().answers,
    )
    let found = await card()
    expect(suggestionLine(found)).toHaveTextContent('Jo Sample? You called them on Monday.')
    await user.click(within(found).getByRole('button', { name: 'Use it' }))
    expect(within(found).getByText('Jo Sample')).toBeInTheDocument()
    act(() => {
      closeCard()
    })
    unmount()

    // A teammate: two Sams, so it asks, and the key 2 picks.
    const task = show(
      typed(
        taskCommand({
          task: {
            ...taskCommand().task!,
            owner: {
              heard: 'Sam',
              found: null,
              choices: [SAM, SAM_TOO],
              address: null,
              problem: null,
              level: 'unsure',
            },
          },
        }),
      ),
    )
    found = await card()
    const which = within(found).getByRole('group', { name: 'Which Sam?' })
    expect(which.closest('[data-slot=suggest]')).not.toBeNull()
    await task.user.keyboard('2')
    expect(within(found).getByText('Sam Example')).toBeInTheDocument()
    act(() => {
      closeCard()
    })
    task.unmount()

    // A meeting: the key 1 picks, and its pre-read opens.
    const meeting = show(
      typed(
        command({
          action: 'pre_read',
          read_back: 'Make a pre-read for a Sample Logistics meeting.',
          meeting: {
            found: null,
            choices: [
              {
                id: 'm-1',
                title: 'Fit-out walkthrough',
                starts_at: '2099-11-26T23:00:00Z',
                company_key: SAMPLE.key,
                company_name: SAMPLE.name,
                form: {
                  id: 'form-1',
                  sent_at: null,
                  sent_count: 0,
                  sent_names: [],
                  status: 'draft',
                },
              },
            ],
            from_page: false,
            heard: '',
            level: 'unsure',
          },
        }),
      ),
    )
    found = await card()
    expect(found.querySelector('[data-slot=suggest]')).not.toBeNull()
    await meeting.user.keyboard('1')
    await waitFor(() => {
      expect(screen.getByTestId('where')).toHaveTextContent('/assistant/meetings/form-1')
    })
  })

  // --- Start from the person (T2-2) ---------------------------------------------------------------

  it('a person found first reads "Jo Sample at Northwind Sample Pty Ltd?", and taking her fills both', async () => {
    size()
    const server = callServer()
    const { user, of } = show(typed(personFirst()), server.answers)
    const found = await card()
    expect(suggestionLine(found)).toHaveTextContent(
      'Jo Sample at Northwind Sample Pty Ltd? You called them on Monday.',
    )
    expect(within(found).getAllByText(/You called them on Monday/)).toHaveLength(1)
    // No company to find: the person comes first.
    expect(within(found).queryByRole('textbox', { name: 'Find a company' })).toBeNull()
    await user.click(within(found).getByRole('button', { name: 'Use it' }))
    expect(within(found).getByText('Northwind Sample Pty Ltd')).toBeInTheDocument()
    expect(within(found).getByText('Jo Sample')).toBeInTheDocument()
    await waitFor(() => {
      expect(of(API.notes, 'POST')).toHaveLength(1)
    })
    expect(of(API.notes, 'POST')[0]?.body).toMatchObject({
      company_key: NORTHWIND_SAMPLE.key,
      contact_id: JO_AT_NORTHWIND.id,
    })
  })

  it('two Jo Samples: each with her company, and the key 2 picks the second', async () => {
    size()
    const server = callServer()
    const { user, of } = show(
      typed(
        personFirst({
          person: {
            found: null,
            choices: [JO_AT_NORTHWIND, JO_AT_SAMPLE],
            heard: 'Jo Sample',
            level: 'unsure',
          },
          unsure: 'Which Jo Sample?',
        }),
      ),
      server.answers,
    )
    const found = await card()
    const which = within(found).getByRole('group', { name: 'Which Jo Sample?' })
    expect(within(which).getByText('Northwind Sample Pty Ltd')).toBeInTheDocument()
    expect(within(which).getByText('Sample Logistics Pty Ltd')).toBeInTheDocument()
    await user.keyboard('2')
    await waitFor(() => {
      expect(of(API.notes, 'POST')).toHaveLength(1)
    })
    expect(of(API.notes, 'POST')[0]?.body).toMatchObject({
      company_key: SAMPLE.key,
      contact_id: JO_AT_SAMPLE.id,
    })
  })

  it('a person found nowhere opens the search for people and companies', async () => {
    size()
    const server = callServer()
    const nowhere = "There's no 'Jo Sample' in HubSpot. Say the company, or pick the person."
    const { user, of } = show(
      typed(
        personFirst({
          person: { found: null, choices: [], heard: 'Jo Sample' },
          unsure: nowhere,
        }),
      ),
      server.answers,
    )
    const found = await card()
    expect(within(found).getAllByText(nowhere)).toHaveLength(1)
    const box = within(found).getByRole('textbox', { name: 'Find the person or company' })
    expect(box).toHaveValue('Jo Sample')
    // A person found there brings her company.
    await user.click(await within(found).findByRole('button', { name: /^Jo Sample/ }))
    await waitFor(() => {
      expect(of(API.notes, 'POST')).toHaveLength(1)
    })
    expect(of(API.notes, 'POST')[0]?.body).toMatchObject({
      company_key: NORTHWIND_SAMPLE.key,
      contact_id: JO_AT_NORTHWIND.id,
    })
  })

  it('a company heard with the person still gives "Needs a company", as before', async () => {
    size()
    const server = callServer()
    const { of } = show(
      typed(
        callCommand({
          read_back: 'Log a call with Jo at North Wind.',
          company: { found: null, choices: [], from_page: false, heard: 'North Wind' },
          person: { found: null, choices: [], heard: 'Jo' },
          unsure: "We couldn't find 'North Wind' in HubSpot. Pick the company.",
        }),
      ),
      server.answers,
    )
    const found = await card()
    await waitFor(() => {
      expect(of(API.notes, 'POST')).toHaveLength(1)
    })
    expect(of(API.notes, 'POST')[0]?.body).toMatchObject({ company_heard: 'North Wind' })
    expect(
      await within(found).findByText(
        "We couldn't find 'North Wind'. The call is saved. Say the company again, or pick it.",
      ),
    ).toBeInTheDocument()
    expect(within(found).getByRole('textbox', { name: 'Find a company' })).toHaveValue('North Wind')
  })
})

// --- By voice, with no AI (choice 6) --------------------------------------------------------------

describe('a suggestion by voice', () => {
  const task = (): TaskDraft =>
    draftOf({ command: likelyTask(), words: '', source: 'mic' }, null) as TaskDraft
  const call = (): CallDraft =>
    draftOf({ command: personFirst(), words: '', source: 'mic' }, null) as CallDraft

  it.each(['yes', 'Yes please.', 'use it', 'yeah, take it'])('"%s" takes it', (said) => {
    const pick = pickByVoice(task(), said)
    expect(pick?.kind).toBe('picked')
    if (pick?.kind !== 'picked' || pick.draft.action !== 'task') throw new Error('no pick')
    expect(pick.draft.company.found).toEqual({ key: SAMPLE.key, name: SAMPLE.name })
    // From the command's own choices: nothing to teach.
    expect(pick.draft.company.byHand).toBe(false)
  })

  it.each(['no', 'not this one', 'nope, not that one'])('"%s" turns it down', (said) => {
    const pick = pickByVoice(task(), said)
    if (pick?.kind !== 'picked' || pick.draft.action !== 'task') throw new Error('no pick')
    expect(pick.draft.company.found).toBeNull()
    expect(pick.draft.company.level).toBe('unsure')
    expect(pick.draft.company.choices.map((one) => one.name)).toEqual([
      'Sample Freight Pty Ltd',
      'Northwind Sample Pty Ltd',
    ])
  })

  it('"the second one" and a name still pick, and "yes" picks nothing once it asks', () => {
    const second = pickByVoice(task(), 'the second one')
    if (second?.kind !== 'picked' || second.draft.action !== 'task') throw new Error('no pick')
    expect(second.draft.company.found?.name).toBe('Sample Freight Pty Ltd')
    const asked = pickByVoice(task(), 'no')
    if (asked?.kind !== 'picked') throw new Error('no pick')
    expect(pickByVoice(asked.draft, 'yes')).toBeNull()
  })

  it('a person found first: "yes" fills the person and her company', () => {
    const pick = pickByVoice(call(), 'yes')
    if (pick?.kind !== 'picked' || pick.draft.action !== 'log_call') throw new Error('no pick')
    expect(pick.draft.person.found).toEqual(JO)
    expect(pick.draft.company.found).toEqual({
      key: NORTHWIND_SAMPLE.key,
      name: NORTHWIND_SAMPLE.name,
    })
    const named = pickByVoice(call(), 'Jo at Sample Logistics')
    if (named?.kind !== 'picked' || named.draft.action !== 'log_call') throw new Error('no pick')
    expect(named.draft.company.found?.key).toBe(SAMPLE.key)
  })

  it('the server’s line for the suggestion is said once, by the part', () => {
    expect(unsureLeft(LIKELY_LINE, cardLinesOf(task()))).toBeNull()
    expect(
      unsureLeft(
        'Jo Sample at Northwind Sample Pty Ltd? You called them on Monday.',
        cardLinesOf(call()),
      ),
    ).toBeNull()
  })
})
