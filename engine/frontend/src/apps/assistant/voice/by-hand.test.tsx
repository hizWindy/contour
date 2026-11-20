/**
 * Voice is the fast way, never the only way (PLAN-V24 T5-2, "Decided in chat" 5): every voice step
 * has a button or a key. Two tests do a conversation's work with the mic off, never a word said:
 * one by the keyboard only, at 1440 px, and one by clicks only, at 390 px. Each covers a command
 * typed, a choice picked, a company picked for a call that needs one, Send, Later, Try again,
 * Type instead and Stop, and the model's lines on the device (T4-3): its download, with Type
 * instead, and a download that failed, with Try again.
 *
 * Where the model on the device is the engine (Firefox on a laptop, an iPhone), it downloads first;
 * then another app holds the mic, as in a Teams meeting, until the rep mutes it there. A fake mic,
 * a fake model, a fake clock and a fake server that keeps the call between requests, as T3-1's
 * contract has it. Nothing real is sent. Made-up names only: Sample Logistics Pty Ltd, Sample
 * Freight Pty Ltd, Northwind Pty Ltd, North Wind as heard, Jo Sample.
 */
import { act, screen, waitFor, within } from '@testing-library/react'
import { toast } from 'sonner'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { queryKeys } from '@/api/query'
import type {
  AssistantCommand,
  AssistantCommandIn,
  CallNoteIn,
  CallNoteOut,
  CallNotePatch,
  CompanyHit,
} from '@/api/types'
import {
  FakeMic,
  FIREFOX_LAPTOP,
  IPHONE,
  type FakeMicOptions,
} from '@/apps/companies/call-notes/mic/fake-mic'
import { PROBLEMS } from '@/apps/companies/call-notes/mic/words'
import { mockApi, type Answer, type Call } from '@/test/mock-api'
import { createTestQueryClient, renderWithProviders } from '@/test/render'
import { asLaptop, asPhone } from '@/test/screen'
import {
  API,
  callCommand,
  CLOCK,
  command,
  companyPreview,
  FOLLOW_UP,
  LEASE,
  note,
  notePath,
  notePreview,
  NORTHWIND,
  options,
  OTHER_SAMPLE,
  SAM,
  SAMPLE,
  taskCommand,
  teamEmail,
  write,
} from '../card/fixtures'
import { closeCard } from '../card/store'
import { SpeakButton } from '../links'
import VoiceBar from './bar'
import type { Times } from './bar-session'
import { setKeepListening } from './keep-listening'
import { isPlainV } from './keys'
import { closeVoiceBar, isVoiceBarOpen, letGoV, openVoiceBarByKey, useVoiceBarOpen } from './store'

const BAR = 'Speak to the Assistant'
const HOLD = 5000
/** The card's Enter does nothing for its first half second (PLAN-V22 choice 19). */
const GUARD = 600
/** Nothing ends a turn or a conversation by itself here: the rep does it all by hand. */
const TALK: Partial<Times> = {
  silence: 600_000,
  firstWords: 600_000,
  limit: 600_000,
  pause: 600_000,
  quiet: 600_000,
  turn: 600_000,
}
const BYTES = 83_000_000
/** Another app holds the mic, as Teams does in a meeting. */
const BUSY = { name: 'NotReadableError', message: 'Could not start audio source' }

const UNCLEAR_WORDS = 'the quote thing'
const TASK_WORDS = 'Add a task to send Sample the quote on Friday'
const CALL_WORDS = 'Log a call with Jo from North Wind, the lease ends June 2027'
const TASK_CARD = 'Add a task for you: send Sample Logistics the quote, due Fri 27 Nov.'
const CALL_CARD = 'Log a call with North Wind.'
const CAN_DO =
  'The Assistant can make a pre-read, log a call, add a task, email teammates or open a page.'
const NOTHING_HEARD = /We didn't hear anything/
const CALL_KEPT = 'Kept in Call logs, to send with the others.'

// --- A fake server --------------------------------------------------------------------------------

const COMPANIES: readonly CompanyHit[] = [SAMPLE, OTHER_SAMPLE, NORTHWIND]

/** The command step reads typed words: each one its answer. */
const ANSWERS: Record<string, AssistantCommand> = {
  [UNCLEAR_WORDS]: command({ action: 'unknown', read_back: CAN_DO }),
  [TASK_WORDS]: taskCommand({
    company: { found: null, choices: [SAMPLE, OTHER_SAMPLE], from_page: false, heard: 'Sample' },
  }),
  [CALL_WORDS]: callCommand({
    read_back: CALL_CARD,
    company: { found: null, choices: [], from_page: false, heard: 'North Wind', can_add: true },
    person: { found: null, choices: [], heard: 'Jo' },
    unsure: "North Wind isn't in HubSpot. Add it, or pick another company.",
  }),
}

const read: Answer = (call) => {
  const said = (call.body as AssistantCommandIn).text
  return Response.json(ANSWERS[said] ?? command({ action: 'unknown', read_back: 'No.' }))
}

/** Our copy's search: each company whose name holds the words typed. */
const search: Answer = (call) => {
  const q = (new URLSearchParams(call.search).get('q') ?? '').trim().toLowerCase()
  return Response.json({
    people: [],
    companies: COMPANIES.filter((one) => one.name.toLowerCase().includes(q)),
  })
}

/**
 * The call on a fake server: saved with only the name as heard it needs a company, its company is
 * taken once, and the next read finds it sorted.
 */
function callServer(): Record<string, Answer> {
  let saved: CallNoteOut | null = null
  const save: Answer = (call) => {
    if (call.method !== 'POST') return undefined
    const body = call.body as CallNoteIn
    saved ??= note({
      status: 'needs_company',
      company_key: null,
      company_name: null,
      company_heard: body.company_heard ?? null,
      person: null,
      call: { in_hubspot: false, outcome: null, summary: '' },
      changes: [],
      tasks: [],
      text: body.text,
      source: body.source,
      sorted_by: 'person',
    })
    return Response.json(saved, { status: 201 })
  }
  const one: Answer = (call) => {
    if (saved === null) return undefined
    if (call.method === 'PATCH') {
      const patch = call.body as CallNotePatch
      const company = COMPANIES.find((hit) => hit.key === patch.company_key)
      if (company) {
        saved = {
          ...saved,
          status: 'sorting',
          company_key: company.key,
          company_name: company.name,
        }
      }
      return Response.json(saved)
    }
    if (saved.status === 'sorting') {
      saved = {
        ...saved,
        status: 'to_confirm',
        sorted_by: 'ai',
        call: { in_hubspot: false, outcome: 'Connected', summary: 'Jo says the lease ends.' },
        changes: [LEASE],
        tasks: [FOLLOW_UP],
      }
    }
    return Response.json(saved)
  }
  return {
    [API.notes]: save,
    [notePath()]: one,
    [API.notePreview]: () => (saved === null ? undefined : Response.json(notePreview(saved))),
  }
}

// --- The page -------------------------------------------------------------------------------------

/** V opens the bar, as the first visit's key listener does (`key.tsx`). */
function vKey(): void {
  const onKey = (event: KeyboardEvent): void => {
    if (isVoiceBarOpen() || !isPlainV(event)) return
    event.preventDefault()
    openVoiceBarByKey()
  }
  const onUp = (event: KeyboardEvent): void => {
    if (event.key === 'v' || event.key === 'V') letGoV()
  }
  document.addEventListener('keydown', onKey)
  document.addEventListener('keyup', onUp)
  onTestFinished(() => {
    document.removeEventListener('keydown', onKey)
    document.removeEventListener('keyup', onUp)
  })
}

/** The top bar's Speak, stepped aside while the bar is open, as Today's is. */
function Top() {
  return useVoiceBarOpen() ? null : <SpeakButton />
}

function page(micOptions: FakeMicOptions) {
  setKeepListening(true)
  const mic = new FakeMic(micOptions)
  const calls = mockApi({
    [API.options]: options(),
    [API.summary]: { to_confirm: 0, needs_look: 0, logged_today: 0, needs_company: 0 },
    [API.command]: read,
    [API.search]: search,
    [API.taskPreview]: write(),
    [API.tasks]: write({ status: 'done' }),
    [API.emailPreview]: teamEmail(),
    [API.team]: [SAM],
    [API.companyPreview]: companyPreview(),
    [API.learned]: () => new Response(null, { status: 204 }),
    ...callServer(),
  })
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(queryKeys.auth.me(), { state: 'off' })
  const view = renderWithProviders(
    <>
      <Top />
      <VoiceBar env={mic.env()} makeTool={mic.tool} times={TALK} tone={() => undefined} />
    </>,
    { queryClient, route: '/assistant' },
  )
  const of = (path: string, method = 'POST'): Call[] =>
    calls.filter((call) => call.path === path && call.method === method)
  return { mic, of, ...view }
}

async function wait(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

/** The bar has closed, and gone from the page. */
async function gone(): Promise<void> {
  await waitFor(() => {
    expect(isVoiceBarOpen()).toBe(false)
    expect(document.querySelector('[data-slot=voice-bar]')).toBeNull()
  })
}

async function bar(): Promise<HTMLElement> {
  return screen.findByRole('dialog', { name: BAR })
}

/** The bar's title, once it says this. */
async function barSays(title: string | RegExp): Promise<HTMLElement> {
  const found = await bar()
  await waitFor(() => {
    expect(found.querySelector('[data-slot=voice-title]')).toHaveTextContent(title)
  })
  return found
}

/** The keyboard alone: Tab until the button named so has the focus. */
async function tabTo(user: ReturnType<typeof page>['user'], name: RegExp): Promise<void> {
  for (let presses = 0; presses < 12; presses += 1) {
    const at = document.activeElement
    if (at instanceof HTMLButtonElement && name.test(at.textContent)) return
    await user.tab()
  }
  throw new Error(`No button ${String(name)} by Tab`)
}

/** Every key pressed, and every click: so a test can prove it used only one of the two. */
function inputs() {
  const seen = { keys: 0, clicks: 0 }
  const onKey = (): void => {
    seen.keys += 1
  }
  const onClick = (event: MouseEvent): void => {
    // A click the keyboard made (Enter on a button) has no pointer.
    if (event.detail > 0) seen.clicks += 1
  }
  document.addEventListener('keydown', onKey, true)
  document.addEventListener('click', onClick, true)
  onTestFinished(() => {
    document.removeEventListener('keydown', onKey, true)
    document.removeEventListener('click', onClick, true)
  })
  return seen
}

afterEach(() => {
  act(() => {
    closeVoiceBar()
    closeCard()
    toast.dismiss()
  })
  window.localStorage.clear()
  setKeepListening(true)
})

describe('a button or a key for every voice step (T5-2)', () => {
  it('by the keyboard only, at 1440 px, with the mic off: a whole conversation’s work', async () => {
    asLaptop()
    vi.useFakeTimers(CLOCK)
    vKey()
    const { mic, of, user } = page({
      browser: FIREFOX_LAPTOP,
      speech: false,
      modelBytes: BYTES,
      refuse: BUSY,
    })
    const used = inputs()

    // V: the model gets ready on this computer first. Type instead skips it; Esc closes.
    await user.keyboard('v')
    let found = await barSays('Getting voice ready on this computer')
    expect(within(found).getByText('Only this once.')).toBeInTheDocument()
    await tabTo(user, /^Type instead/)
    await user.keyboard('{Enter}')
    expect(within(found).getByRole('textbox', { name: 'Type what to do' })).toHaveFocus()
    await user.keyboard('{Escape}')
    await gone()

    // V again: the download fails, and Try again gets it ready.
    await user.keyboard('v')
    found = await barSays('Getting voice ready on this computer')
    act(() => {
      mic.model.fail('download')
    })
    expect(await within(found).findByRole('alert')).toHaveTextContent(
      PROBLEMS.download_failed.words,
    )
    await tabTo(user, /^Try again/)
    await user.keyboard('{Enter}')
    await within(found).findByText('Only this once.')
    act(() => {
      mic.model.done()
    })
    // Another app holds the mic: muted there, Try again listens.
    expect(await within(found).findByRole('alert')).toHaveTextContent(PROBLEMS.busy.words)
    mic.refuse = null
    await tabTo(user, /^Try again/)
    await user.keyboard('{Enter}')
    found = await barSays('Listening')

    // Stop, by V: nothing was said, and Type instead opens the text line.
    await user.keyboard('v')
    expect(await within(found).findByRole('alert')).toHaveTextContent(NOTHING_HEARD)
    expect(mic.live()).toBe(0)
    await tabTo(user, /^Type instead/)
    await user.keyboard('{Enter}')
    const line = within(found).getByRole('textbox', { name: 'Type what to do' })
    expect(line).toHaveFocus()

    // A command typed that makes no command: Type instead keeps the words to fix.
    await user.keyboard(`${UNCLEAR_WORDS}{Enter}`)
    await waitFor(() => {
      expect(found.querySelector('[data-slot=voice-answer]')).toHaveTextContent(CAN_DO)
    })
    await tabTo(user, /^Type instead/)
    await user.keyboard('{Enter}')
    const again = within(found).getByRole('textbox', { name: 'Type what to do' })
    expect(again).toHaveValue(UNCLEAR_WORDS)
    expect(again).toHaveFocus()
    await user.keyboard(`{Control>}a{/Control}${TASK_WORDS}{Enter}`)

    // The card: Enter goes to its choice, the arrows move, and Enter picks.
    const task = await screen.findByRole('dialog', { name: TASK_CARD })
    await wait(GUARD)
    expect(within(task).getByRole('button', { name: 'Send' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(within(task).getByRole('group', { name: 'Which Sample?' })).toBeInTheDocument()
    await user.keyboard('{ArrowDown}{Enter}')
    await waitFor(() => {
      expect(within(task).queryByRole('group', { name: 'Which Sample?' })).toBeNull()
    })
    expect(within(task).getByText(OTHER_SAMPLE.name)).toBeInTheDocument()

    // V on the card listens, beside it; its Stop, reached by Tab, stops it.
    within(task).getByRole('button', { name: 'Send' }).focus()
    await user.keyboard('v')
    const pill = await waitFor(() => {
      const shown = task.querySelector<HTMLElement>('[data-slot=listening-pill]')
      expect(shown).not.toBeNull()
      return shown as HTMLElement
    })
    await waitFor(() => {
      expect(pill.querySelector('[data-slot=pill-title]')).toHaveTextContent('Listening')
    })
    await tabTo(user, /^Stop/)
    expect(pill.contains(document.activeElement)).toBe(true)
    await user.keyboard('{Enter}')
    await waitFor(() => {
      expect(task.querySelector('[data-slot=listening-pill]')).toBeNull()
    })
    expect(mic.live()).toBe(0)

    // Send, by Enter.
    expect(within(task).getByRole('button', { name: 'Send' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(await screen.findByText('Adding the task in HubSpot')).toBeInTheDocument()
    await wait(HOLD)
    await waitFor(() => {
      expect(of(API.tasks)).toHaveLength(1)
    })

    // A call whose company isn't found: typed, saved at once, its company picked by keys.
    await user.keyboard('v')
    found = await barSays('Listening')
    await tabTo(user, /^Type instead/)
    await user.keyboard(`{Enter}${CALL_WORDS}{Enter}`)
    const call = await screen.findByRole('dialog', { name: CALL_CARD })
    await waitFor(() => {
      expect(of(API.notes)).toHaveLength(1)
    })
    await wait(GUARD)
    await user.keyboard('{Enter}')
    const box = within(call).getByRole('textbox', { name: 'Find a company' })
    expect(box).toHaveFocus()
    await user.keyboard('{Control>}a{/Control}Northwind')
    await wait(300)
    await within(call).findByRole('group', { name: 'Which company?' })
    await user.keyboard('{ArrowDown}{Enter}')
    await waitFor(() => {
      expect(of(notePath(), 'PATCH').map((one) => one.body)).toEqual([
        { company_key: NORTHWIND.key },
      ])
    })

    // Later, by Esc: the call waits in Call logs, and nothing went to HubSpot.
    await user.keyboard('{Escape}')
    expect(await screen.findByText(CALL_KEPT)).toBeInTheDocument()
    expect(of(API.confirm)).toHaveLength(0)

    // The keyboard did it all, and no word was said.
    expect(used.clicks).toBe(0)
    expect(of(API.command).map((one) => (one.body as AssistantCommandIn).source)).toEqual([
      'typed',
      'typed',
      'typed',
    ])
  }, 30_000)

  it('by clicks only, at 390 px, with the mic off: a whole conversation’s work', async () => {
    asPhone()
    vi.useFakeTimers(CLOCK)
    const { mic, of, user } = page({ browser: IPHONE, modelBytes: BYTES, refuse: BUSY })
    const used = inputs()
    /** Typed words go in with the keyboard: every press here is a letter, never a key's job. */
    const type = async (box: HTMLElement, words: string): Promise<void> => {
      await user.tripleClick(box)
      await user.keyboard(words)
    }

    // Speak: the model gets ready on this phone first. Type instead skips it; Cancel closes.
    await user.click(screen.getByRole('button', { name: /^Speak/ }))
    let found = await barSays('Getting voice ready on this phone')
    await user.click(within(found).getByRole('button', { name: 'Type instead' }))
    expect(within(found).getByRole('textbox', { name: 'Type what to do' })).toBeInTheDocument()
    await user.click(within(found).getByRole('button', { name: /^Cancel/ }))
    await gone()

    // Speak again: the download fails, and Try again gets it ready.
    await user.click(await screen.findByRole('button', { name: /^Speak/ }))
    found = await barSays('Getting voice ready on this phone')
    act(() => {
      mic.model.fail('download')
    })
    expect(await within(found).findByRole('alert')).toHaveTextContent(
      PROBLEMS.download_failed.words,
    )
    await user.click(within(found).getByRole('button', { name: /^Try again/ }))
    await within(found).findByText('Only this once.')
    act(() => {
      mic.model.done()
    })
    // Another app holds the mic: muted there, Try again listens.
    expect(await within(found).findByRole('alert')).toHaveTextContent(PROBLEMS.busy.words)
    mic.refuse = null
    await user.click(within(found).getByRole('button', { name: /^Try again/ }))
    found = await barSays('Listening')

    // Stop: nothing was said, and Type instead opens the text line.
    await user.click(within(found).getByRole('button', { name: /^Stop/ }))
    expect(await within(found).findByRole('alert')).toHaveTextContent(NOTHING_HEARD)
    expect(mic.live()).toBe(0)
    await user.click(within(found).getByRole('button', { name: 'Type instead' }))

    // A command typed that makes no command: Type instead keeps the words to fix.
    await type(within(found).getByRole('textbox', { name: 'Type what to do' }), UNCLEAR_WORDS)
    await user.click(within(found).getByRole('button', { name: /^Send/ }))
    await waitFor(() => {
      expect(found.querySelector('[data-slot=voice-answer]')).toHaveTextContent(CAN_DO)
    })
    await user.click(within(found).getByRole('button', { name: 'Type instead' }))
    const line = within(found).getByRole('textbox', { name: 'Type what to do' })
    expect(line).toHaveValue(UNCLEAR_WORDS)
    await type(line, TASK_WORDS)
    await user.click(within(found).getByRole('button', { name: /^Send/ }))

    // The card: a choice picked by a click, and Send.
    const task = await screen.findByRole('dialog', { name: TASK_CARD })
    await user.click(within(task).getByRole('button', { name: new RegExp(OTHER_SAMPLE.name) }))
    await waitFor(() => {
      expect(within(task).queryByRole('group', { name: 'Which Sample?' })).toBeNull()
    })
    await user.click(within(task).getByRole('button', { name: 'Send' }))
    expect(await screen.findByText('Adding the task in HubSpot')).toBeInTheDocument()
    await wait(HOLD)
    await waitFor(() => {
      expect(of(API.tasks)).toHaveLength(1)
    })

    // A call whose company isn't found: typed, saved at once, its company picked by a click.
    await user.click(await screen.findByRole('button', { name: /^Speak/ }))
    found = await barSays('Listening')
    await user.click(within(found).getByRole('button', { name: 'Type instead' }))
    await type(within(found).getByRole('textbox', { name: 'Type what to do' }), CALL_WORDS)
    await user.click(within(found).getByRole('button', { name: /^Send/ }))
    const call = await screen.findByRole('dialog', { name: CALL_CARD })
    await waitFor(() => {
      expect(of(API.notes)).toHaveLength(1)
    })
    await type(within(call).getByRole('textbox', { name: 'Find a company' }), 'Northwind')
    await wait(300)
    await user.click(await within(call).findByRole('button', { name: new RegExp(NORTHWIND.name) }))
    await waitFor(() => {
      expect(of(notePath(), 'PATCH').map((one) => one.body)).toEqual([
        { company_key: NORTHWIND.key },
      ])
    })

    // Later: the call waits in Call logs, and nothing went to HubSpot.
    await user.click(within(call).getByRole('button', { name: 'Later' }))
    expect(await screen.findByText(CALL_KEPT)).toBeInTheDocument()
    expect(of(API.confirm)).toHaveLength(0)

    // Clicks did every step; the keyboard only typed words. No word was said.
    expect(used.clicks).toBeGreaterThan(10)
    expect(of(API.command).map((one) => (one.body as AssistantCommandIn).source)).toEqual([
      'typed',
      'typed',
      'typed',
    ])
  }, 30_000)
})
