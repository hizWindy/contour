/**
 * The review card when a name goes wrong (PLAN-V23 T1-6, each Part 1 row of "Words for when things
 * go wrong"), the name it teaches the mic once sent (T1-5), and hold V on the card (choice 6). With
 * a fake server, a fake mic and a fake clock. Made-up names only: Sample Logistics Pty Ltd,
 * Northwind Pty Ltd, North Wind (as misheard), Jo Sample.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { queryKeys } from '@/api/query'
import type { AssistantCommand } from '@/api/types'
import { FakeMic } from '@/apps/companies/call-notes/mic/fake-mic'
import { mockApi, type Answer } from '@/test/mock-api'
import { createTestQueryClient, renderWithProviders } from '@/test/render'
import {
  API,
  CLOCK,
  command,
  companyAdded,
  companyPreview,
  note,
  notePath,
  notePreview,
  NORTHWIND,
  options,
  SAM,
  SAMPLE,
  taskCommand,
  teamEmail,
  write,
} from './fixtures'
import { CardHost } from './host'
import { closeCard, openCard } from './store'

const NOT_THERE = "North Wind isn't in HubSpot. Add it, or pick another company."
const NEW_THERE = "Northwind Pty Ltd is new in HubSpot. We'll use it."
const LIKE_IT = 'HubSpot already has Northwind Pty Ltd. Use it, or add North Wind anyway.'
const OFF = "Adding companies to HubSpot is off for now. Pick a company that's there."

/** "Add a task to send North Wind the quote", where North Wind is nowhere. */
function nowhere(change: Partial<AssistantCommand> = {}): AssistantCommand {
  return taskCommand({
    company: { found: null, choices: [], from_page: false, heard: 'North Wind', can_add: true },
    unsure: NOT_THERE,
    ...change,
  })
}

function show(made: AssistantCommand, answers: Record<string, unknown> = {}) {
  const mic = new FakeMic()
  const calls = mockApi({
    [API.options]: options(),
    [API.summary]: { to_confirm: 1, needs_look: 0, logged_today: 0 },
    [API.taskPreview]: write(),
    [API.tasks]: write({ status: 'done' }),
    [API.emailPreview]: teamEmail(),
    [API.team]: [SAM],
    [API.search]: { companies: [SAMPLE], people: [] },
    [API.notes]: note(),
    [notePath()]: note(),
    [API.notePreview]: notePreview(),
    [API.confirm]: { already_sending: false, sending: 1, notes: [note({ status: 'sending' })] },
    [API.companyPreview]: companyPreview(),
    [API.companies]: () => Response.json(companyAdded(), { status: 201 }),
    [API.learned]: () => new Response(null, { status: 204 }),
    ...answers,
  })
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(queryKeys.auth.me(), { state: 'off' })
  const view = renderWithProviders(
    <CardHost env={mic.env()} makeTool={mic.tool} times={{ guard: 0, preview: 0 }} />,
    { queryClient },
  )
  act(() => {
    openCard({ kind: 'command', command: made, words: 'the words', source: 'typed' })
  })
  const of = (path: string) => calls.filter((call) => call.path === path && call.method === 'POST')
  return { mic, of, ...view }
}

async function card() {
  return screen.findByRole('dialog')
}

async function wait(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

afterEach(() => {
  act(() => {
    closeCard()
    toast.dismiss()
  })
  window.localStorage.clear()
})

describe('the company, when a name goes wrong (T1-6)', () => {
  it('found by HubSpot’s own search: "is new in HubSpot. We’ll use it.", said once', async () => {
    show(
      taskCommand({
        company: {
          found: NORTHWIND,
          choices: [],
          from_page: false,
          heard: 'Northwind',
          from_hubspot: true,
        },
        unsure: `${NEW_THERE} Two people named Jo work there.`,
      }),
    )
    const found = await card()
    expect(within(found).getByText('Northwind Pty Ltd')).toBeInTheDocument()
    expect(within(found).getAllByText(NEW_THERE)).toHaveLength(1)
    // The rest of the server's paragraph still shows.
    expect(within(found).getByText('Two people named Jo work there.')).toBeInTheDocument()
  })

  it('nowhere: the plan’s line once, "Add to HubSpot", and the search list', async () => {
    const { user } = show(nowhere())
    const found = await card()
    expect(within(found).getAllByText(NOT_THERE)).toHaveLength(1)
    expect(within(found).getByRole('button', { name: 'Add to HubSpot' })).toBeInTheDocument()
    // Pick another company: the search list.
    const box = within(found).getByRole('textbox', { name: 'Find a company' })
    await user.clear(box)
    await user.type(box, 'Sample')
    await user.click(await within(found).findByRole('button', { name: /Sample Logistics/ }))
    expect(within(found).getByText('Sample Logistics Pty Ltd')).toBeInTheDocument()
  })

  it('not searched in HubSpot: the old words, and no add', async () => {
    show(
      taskCommand({
        company: { found: null, choices: [], from_page: false, heard: 'North Wind' },
      }),
    )
    const found = await card()
    expect(
      within(found).getByText("We couldn't find 'North Wind' in HubSpot. Pick the company."),
    ).toBeInTheDocument()
    expect(within(found).queryByRole('button', { name: 'Add to HubSpot' })).toBeNull()
  })

  it('Add checks HubSpot first: a company like it gives "Use it" and "Add anyway"', async () => {
    const { user, of } = show(nowhere(), {
      [API.companyPreview]: companyPreview({
        similar: [NORTHWIND],
        sentence: LIKE_IT,
      }),
    })
    const found = await card()
    await user.click(within(found).getByRole('button', { name: 'Add to HubSpot' }))
    // The name as heard, to fix, and a city.
    expect(within(found).getByRole('textbox', { name: 'Name' })).toHaveValue('North Wind')
    expect(within(found).getByRole('textbox', { name: 'Name' })).toHaveFocus()
    expect(within(found).getByRole('textbox', { name: 'City' })).toHaveValue('')
    expect(await within(found).findByText(LIKE_IT)).toBeInTheDocument()
    expect(of(API.companyPreview)[0]?.body).toEqual({ name: 'North Wind', city: null })
    expect(within(found).getByRole('button', { name: 'Add anyway' })).toBeInTheDocument()
    await user.click(within(found).getByRole('button', { name: 'Use Northwind Pty Ltd' }))
    expect(within(found).getByText('Northwind Pty Ltd')).toBeInTheDocument()
    await waitFor(() => {
      expect(of(API.taskPreview).at(-1)?.body).toMatchObject({ company_key: '301' })
    })
    // Nothing was added to HubSpot.
    expect(of(API.companies)).toHaveLength(0)
  })

  it('Add anyway adds it, with a key, and the card uses the new company', async () => {
    const { user, of } = show(nowhere(), {
      [API.companyPreview]: companyPreview({ similar: [NORTHWIND], sentence: LIKE_IT }),
    })
    const found = await card()
    await user.click(within(found).getByRole('button', { name: 'Add to HubSpot' }))
    await user.click(await within(found).findByRole('button', { name: 'Add anyway' }))
    await waitFor(() => {
      expect(of(API.companies)).toHaveLength(1)
    })
    expect(of(API.companies)[0]?.body).toEqual({ name: 'North Wind', city: null })
    expect(of(API.companies)[0]?.headers?.get('idempotency-key')).toBeTruthy()
    expect(await within(found).findByText('Added to HubSpot.')).toBeInTheDocument()
    await waitFor(() => {
      expect(of(API.taskPreview).at(-1)?.body).toMatchObject({ company_key: '401' })
    })
  })

  it('nothing like it: Add to HubSpot adds the name and city typed, once', async () => {
    const { user, of } = show(nowhere())
    const found = await card()
    await user.click(within(found).getByRole('button', { name: 'Add to HubSpot' }))
    const name = within(found).getByRole('textbox', { name: 'Name' })
    await user.clear(name)
    await user.type(name, 'Northwind Freight')
    await user.type(within(found).getByRole('textbox', { name: 'City' }), 'Perth')
    await waitFor(() => {
      expect(of(API.companyPreview).at(-1)?.body).toEqual({
        name: 'Northwind Freight',
        city: 'Perth',
      })
    })
    const add = within(found).getByRole('button', { name: 'Add to HubSpot' })
    await waitFor(() => {
      expect(add).toBeEnabled()
    })
    await user.dblClick(add)
    expect(await within(found).findByText('Added to HubSpot.')).toBeInTheDocument()
    expect(of(API.companies)).toHaveLength(1)
    expect(of(API.companies)[0]?.body).toEqual({ name: 'Northwind Freight', city: 'Perth' })
  })

  it('adding switched off: the plan’s words, and the search list', async () => {
    const { user, of } = show(nowhere(), {
      [API.companyPreview]: companyPreview({
        can_write: false,
        waiting_for: OFF,
        sentence: OFF,
      }),
    })
    const found = await card()
    await user.click(within(found).getByRole('button', { name: 'Add to HubSpot' }))
    expect(await within(found).findByText(OFF)).toBeInTheDocument()
    expect(within(found).getByRole('textbox', { name: 'Find a company' })).toBeInTheDocument()
    expect(within(found).queryByRole('button', { name: /^Add/ })).toBeNull()
    expect(of(API.companies)).toHaveLength(0)
  })

  it('the same name in HubSpot already: the server’s words, and that company to use', async () => {
    const there =
      "HubSpot already has Northwind Pty Ltd in Perth, so it isn't added again. Use it from the list."
    const { user } = show(nowhere(), {
      [API.companyPreview]: companyPreview({ exists: NORTHWIND, sentence: there }),
    })
    const found = await card()
    await user.click(within(found).getByRole('button', { name: 'Add to HubSpot' }))
    expect(await within(found).findByText(there)).toBeInTheDocument()
    expect(within(found).queryByRole('button', { name: /^Add/ })).toBeNull()
    await user.click(within(found).getByRole('button', { name: 'Use Northwind Pty Ltd' }))
    expect(within(found).getByText('Northwind Pty Ltd')).toBeInTheDocument()
  })

  it.each([
    ['hubspot_writing_off', 409, 'Adding companies is off', OFF],
    [
      'company_exists',
      409,
      "It's already in HubSpot",
      "HubSpot already has North Wind, so it isn't added again. Use it from the list.",
    ],
  ])('the add refused (%s): the words, and the search list', async (code, status, title, words) => {
    const detail = code === 'company_exists' ? words : 'Adding companies to HubSpot is off for now.'
    const { user } = show(nowhere(), {
      [API.companies]: () => Response.json({ title, status, detail, code }, { status }),
    })
    const found = await card()
    await user.click(within(found).getByRole('button', { name: 'Add to HubSpot' }))
    const add = await within(found).findByRole('button', { name: 'Add to HubSpot' })
    await waitFor(() => {
      expect(add).toBeEnabled()
    })
    await user.click(add)
    expect(await within(found).findByText(words)).toBeInTheDocument()
    expect(within(found).getByRole('textbox', { name: 'Find a company' })).toBeInTheDocument()
  })

  it('HubSpot didn’t answer: the server’s words, and a retry goes with the same key', async () => {
    let tries = 0
    const { user, of } = show(nowhere(), {
      [API.companies]: () => {
        tries += 1
        return tries === 1
          ? Response.json(
              {
                title: "HubSpot didn't answer in time",
                status: 502,
                detail:
                  "We can't tell yet if the company was added. Try again: it won't be added twice.",
                code: 'company_not_added',
              },
              { status: 502 },
            )
          : Response.json(companyAdded(), { status: 201 })
      },
    })
    const found = await card()
    await user.click(within(found).getByRole('button', { name: 'Add to HubSpot' }))
    const add = await within(found).findByRole('button', { name: 'Add to HubSpot' })
    await waitFor(() => {
      expect(add).toBeEnabled()
    })
    await user.click(add)
    expect(
      await within(found).findByText(
        "HubSpot didn't answer in time. We can't tell yet if the company was added. Try again: it won't be added twice.",
      ),
    ).toBeInTheDocument()
    await user.click(within(found).getByRole('button', { name: 'Add to HubSpot' }))
    expect(await within(found).findByText('Added to HubSpot.')).toBeInTheDocument()
    const keys = of(API.companies).map((call) => call.headers?.get('idempotency-key'))
    expect(keys).toHaveLength(2)
    expect(keys[0]).toBe(keys[1])
  })

  it('HubSpot didn’t answer the check: the server’s words, and Try again asks again', async () => {
    let tries = 0
    const { user, of } = show(nowhere(), {
      [API.companyPreview]: () => {
        tries += 1
        return tries === 1
          ? Response.json(
              {
                title: "HubSpot didn't answer",
                status: 503,
                detail: 'Nothing was checked. Try again in a minute.',
                code: 'hubspot_unavailable',
              },
              { status: 503 },
            )
          : Response.json(companyPreview())
      },
    })
    const found = await card()
    await user.click(within(found).getByRole('button', { name: 'Add to HubSpot' }))
    expect(
      await within(found).findByText(
        "HubSpot didn't answer. Nothing was checked. Try again in a minute.",
      ),
    ).toBeInTheDocument()
    await user.click(within(found).getByRole('button', { name: 'Try again' }))
    await waitFor(() => {
      expect(within(found).getByRole('button', { name: 'Add to HubSpot' })).toBeEnabled()
    })
    expect(of(API.companyPreview)).toHaveLength(2)
  })

  it('Back from the add returns to the line, the button and the search list', async () => {
    const { user } = show(nowhere())
    const found = await card()
    await user.click(within(found).getByRole('button', { name: 'Add to HubSpot' }))
    await user.click(within(found).getByRole('button', { name: 'Back' }))
    expect(within(found).getByText(NOT_THERE)).toBeInTheDocument()
    expect(within(found).getByRole('button', { name: 'Add to HubSpot' })).toHaveFocus()
  })
})

describe('V on the card (choice 6, T1-6)', () => {
  it('held: the change ends as V comes up; a tap leaves it listening', async () => {
    vi.useFakeTimers(CLOCK)
    const said: Answer = () => Response.json(command({ action: 'unknown', read_back: 'No.' }))
    const { mic, of } = show(taskCommand(), { [API.command]: said })
    const found = await card()
    const strip = () => found.querySelector('[data-slot=card-voice]')
    // A tap: down and up at once. It listens on.
    fireEvent.keyDown(found, { key: 'v' })
    fireEvent.keyUp(document.body, { key: 'v' })
    await waitFor(() => {
      expect(strip()).toHaveTextContent('Listening')
    })
    await wait(500)
    expect(strip()).toHaveTextContent('Listening')
    // V again ends it (Done), as before, and the words go.
    act(() => {
      mic.say('make it Friday')
    })
    fireEvent.keyDown(found, { key: 'v' })
    fireEvent.keyUp(document.body, { key: 'v' })
    await waitFor(() => {
      expect(strip()).toHaveTextContent('On this card you can change a box')
    })
    expect(of(API.command)).toHaveLength(1)
    // Held: V listens again, the words come, and letting go after the hold ends it.
    fireEvent.keyDown(found, { key: 'v' })
    await waitFor(() => {
      expect(strip()).toHaveTextContent('Listening')
    })
    act(() => {
      mic.say('make it Monday')
    })
    await wait(500)
    // Its repeats type nothing.
    expect(fireEvent.keyDown(found, { key: 'v', repeat: true })).toBe(false)
    expect(strip()).toHaveTextContent('Listening')
    fireEvent.keyUp(document.body, { key: 'v' })
    await waitFor(() => {
      expect(of(API.command)).toHaveLength(2)
    })
    expect(of(API.command)[1]?.body).toMatchObject({ text: 'make it Monday', source: 'mic' })
  })

  it('unclear words wait in the strip’s text line, with the line and Say it again', async () => {
    const line = "We didn't catch that clearly. You said: 'um'. Say it again, or fix the words."
    const { mic, user } = show(taskCommand(), {
      [API.command]: command({ action: 'unclear', read_back: 'um', unsure: line }),
    })
    const found = await card()
    await waitFor(() => {
      expect(within(found).getByRole('button', { name: 'Send' })).toHaveFocus()
    })
    await user.keyboard('v')
    await waitFor(() => {
      expect(found.querySelector('[data-slot=card-voice]')).toHaveTextContent('Listening')
    })
    act(() => {
      mic.say('um')
    })
    await user.keyboard('v')
    expect(await within(found).findByRole('alert')).toHaveTextContent(line)
    expect(within(found).getByRole('textbox', { name: 'Type a change' })).toHaveValue('um')
    await user.click(within(found).getByRole('button', { name: 'Say it again' }))
    await waitFor(() => {
      expect(found.querySelector('[data-slot=card-voice]')).toHaveTextContent('Listening')
    })
    expect(mic.tools.length).toBeGreaterThanOrEqual(2)
  })
})
