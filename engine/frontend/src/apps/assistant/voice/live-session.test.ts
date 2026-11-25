/**
 * The voice bar's session with live voice (PLAN-V28 T2-3), with a fake talk, the fake mic and a fake
 * clock: live voice is picked at the start where it may start and the browser can run it, else the
 * free mic as before; a live talk is always a conversation and opens no `MicSession`; hold V is a
 * tap; a start refused or a socket that never reached `ready` falls back to the free mic at once;
 * the relay's end shows its line; the quiet stop counts words either way; and every end stops the
 * talk. Made-up names only: Sample Logistics, Jo Sample.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProblem } from '@/api/client'
import type { AssistantCommand } from '@/api/types'
import {
  CHROME_LAPTOP,
  FakeMic,
  type FakeMicOptions,
} from '@/apps/companies/call-notes/mic/fake-mic'
import { BarSession, TIMES, type BarSnapshot } from './bar-session'
import { FakeTalks } from './live/fake-talk'
import { letLiveBack } from './live/limit'
import { LIVE_DROPPED, LIVE_LIMIT, LIVE_UNREACHABLE } from './live/words'
import type { ScreenEnv } from './screen'

const TASK: AssistantCommand = {
  action: 'task',
  read_back: 'Add a task for you: send Sample Logistics the quote, due Mon 30 Nov.',
  company: null,
  person: null,
  meeting: null,
  note_text: null,
  task: null,
  email: null,
  open: null,
  change: null,
  unsure: null,
}

/** A laptop whose browser can run live voice. */
const LIVE_LAPTOP: FakeMicOptions = { browser: { ...CHROME_LAPTOP, live: true } }

function fakeScreen({ phone = false } = {}) {
  const listeners = new Set<() => void>()
  const state = { hidden: false, taken: 0, released: 0 }
  const screen: ScreenEnv = {
    keepOn: () => {
      state.taken += 1
      return Promise.resolve({
        release: () => {
          state.released += 1
          return Promise.resolve()
        },
      })
    },
    hidden: () => state.hidden,
    onVisibility: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    phone: () => phone,
  }
  const hide = (hidden: boolean): void => {
    state.hidden = hidden
    for (const listener of [...listeners]) listener()
  }
  return { screen, state, hide }
}

interface SetUp {
  /** Live voice may start for this person. Default: yes. */
  liveOn?: boolean
  mic?: FakeMicOptions
  /** "Keep listening". Default: off, so a live talk alone makes the conversation. */
  keep?: boolean
  phone?: boolean
}

function setUp({ liveOn = true, mic: micOptions = LIVE_LAPTOP, keep = false, phone }: SetUp = {}) {
  const mic = new FakeMic(micOptions)
  const talks = new FakeTalks()
  const onClose = vi.fn<() => void>()
  const fake = fakeScreen(phone === undefined ? {} : { phone })
  const session = new BarSession({
    env: mic.env(),
    makeTool: mic.tool,
    onPage: { company_key: '201' },
    read: () => Promise.resolve(TASK),
    hand: (heard) =>
      heard.kind === 'command'
        ? { kind: 'show', line: heard.command.read_back, unsure: null, again: false }
        : { kind: 'close' },
    onClose,
    conversation: keep,
    screen: fake.screen,
    live: { on: () => liveOn, talk: talks.make },
  })
  const now = (): BarSnapshot => session.getSnapshot()
  return { mic, talks, session, onClose, now, fake }
}

async function tick(ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms)
}

/** Opens the bar with live voice, and Google is ready. */
async function live(options: SetUp = {}) {
  const set = setUp(options)
  set.session.start('browser_service')
  set.talks.last().ready()
  await tick()
  return set
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  // The month's limit holds live voice off for the page: each test starts afresh.
  letLiveBack()
})

describe('the voice source (T2-3)', () => {
  it('starts a live talk, with the company on screen, and opens no mic session', async () => {
    const { session, talks, mic, now } = setUp()
    session.start('browser_service')

    expect(talks.made).toHaveLength(1)
    expect(talks.last().started).toBe(true)
    expect(talks.last().options.companyKey).toBe('201')
    expect(now()).toMatchObject({ phase: 'starting', mic: null })
    expect(now().live?.phase).toBe('connecting')
    await tick(100)
    // One mic: the talk's. No mic session, no voice tool.
    expect(mic.asked).toEqual([])
    expect(mic.tools).toEqual([])
  })

  it('listens once Google is ready, as a conversation, whatever "Keep listening" says', async () => {
    const { session, now } = await live({ keep: false })

    expect(now().phase).toBe('listening')
    expect(now().conversation).not.toBeNull()
    expect(session.isLive()).toBe(true)
    expect(session.keepsListening).toBe(true)
  })

  it('uses the free mic, as before, without live voice', async () => {
    const { session, talks, mic, now } = setUp({ liveOn: false })
    session.start('browser_service')
    await tick(100)

    expect(talks.made).toEqual([])
    expect(mic.tools).toHaveLength(1)
    expect(now().phase).toBe('listening')
    expect(session.keepsListening).toBe(false)
  })

  it("uses the free mic where the browser can't run live voice", async () => {
    const { session, talks, mic } = setUp({ mic: {} })
    session.start('browser_service')
    await tick(100)

    expect(talks.made).toEqual([])
    expect(mic.tools).toHaveLength(1)
  })

  it('opens no mic at all with typing, live voice or not', () => {
    const { session, talks, now } = setUp()
    session.start('typing')

    expect(talks.made).toEqual([])
    expect(now().phase).toBe('typing')
  })
})

describe('a start that fails falls back to the free mic at once (T2-3), saying why (T4-1)', () => {
  it.each([
    [
      'a refused start at the limit',
      {
        kind: 'refused' as const,
        problem: new ApiProblem({ title: 'No', status: 429, code: 'live_voice_limit' }),
      },
      LIVE_LIMIT,
    ],
    ['a socket that never reached ready', { kind: 'failed' as const }, LIVE_UNREACHABLE],
  ])('%s', async (_, end, line) => {
    const { session, talks, mic, now } = setUp()
    session.start('browser_service')
    talks.last().finish(end)
    await tick(100)

    expect(mic.tools).toHaveLength(1)
    expect(now().phase).toBe('listening')
    expect(now().live).toBeNull()
    expect(now().notice).toEqual({ line })
    expect(session.keepsListening).toBe(false)
  })

  it('a mic the browser refuses says so, as the free mic does', () => {
    const { session, talks, now } = setUp()
    session.start('browser_service')
    talks.last().finish({ kind: 'mic', problem: 'blocked_browser' })

    expect(now().phase).toBe('typing')
    expect(now().problem).toEqual({ kind: 'mic', problem: 'blocked_browser' })
  })
})

describe('how a live talk ends', () => {
  it('V or Stop stops the talk, and the bar closes once something was said', async () => {
    const { session, talks, onClose } = await live()
    talks.last().hear('Log a call with Jo')
    session.pressV()

    expect(talks.last().stopped).toBe(true)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('V with nothing said either way says nothing was heard', async () => {
    const { session, talks, now } = await live()
    session.done()

    expect(talks.last().stopped).toBe(true)
    expect(now().problem).toEqual({ kind: 'nothing_heard' })
  })

  it('V while it connects closes the bar: nothing was said', () => {
    const { session, talks, onClose } = setUp()
    session.start('browser_service')
    session.pressV()

    expect(talks.last().stopped).toBe(true)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Esc stops the talk and closes the bar', async () => {
    const { session, talks, onClose } = await live()
    session.cancel()

    expect(talks.last().stopped).toBe(true)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a held V is a tap: letting go ends nothing', async () => {
    const { session, talks, now } = await live()
    session.vDown()
    await tick(TIMES.hold + 100)
    session.vUp()

    expect(talks.last().stopped).toBe(false)
    expect(now().phase).toBe('listening')
    expect(now().conversation).not.toBeNull()
  })

  it('2 minutes with no words either way stops it, and each word counts from then', async () => {
    const { talks, now } = await live()
    await tick(TIMES.quiet - 1000)
    talks.last().say('Jo Sample or Jo Northwind?')
    await tick(TIMES.quiet - 1000)
    expect(now().phase).toBe('listening')

    await tick(1000)
    expect(now().problem).toEqual({ kind: 'quiet' })
    expect(talks.last().stopped).toBe(true)
  })

  it("the relay's end shows its line, with Start again, which tries live voice again", async () => {
    const { session, talks, now } = await live()
    talks.last().hear('Log a call with Jo')
    const line = 'Live voice stopped: nothing was heard for a while. Press V to start again.'
    talks.last().finish({ kind: 'ended', reason: 'idle', line })

    expect(now()).toMatchObject({
      phase: 'problem',
      problem: { kind: 'live', line },
      words: 'Log a call with Jo',
    })
    // Start again (or V, from the line) starts a new talk.
    session.tryAgain()
    expect(talks.made).toHaveLength(2)
    expect(talks.last().started).toBe(true)
    expect(now().phase).toBe('starting')
  })

  it('our backend not back within 30 seconds: the free mic takes over, saying the line dropped', async () => {
    const { talks, mic, now } = await live()
    talks.last().finish({ kind: 'lost' })
    await tick(100)

    expect(now().notice).toEqual({ line: LIVE_DROPPED })
    expect(now().phase).toBe('listening')
    expect(mic.tools).toHaveLength(1)
  })

  it("Type instead stops the talk, and puts the rep's words in the text line", async () => {
    const { session, talks, now } = await live()
    talks.last().hear('Log a call with Jo at', 'Sample Logist')
    session.typeInstead()

    expect(talks.last().stopped).toBe(true)
    expect(now()).toMatchObject({ phase: 'typing', draft: 'Log a call with Jo at Sample Logist' })
  })

  it('a phone leaving the page stops the talk, with the words kept', async () => {
    const { talks, fake, now } = await live({ phone: true })
    talks.last().hear('Log a call with Jo')
    fake.hide(true)

    expect(talks.last().stopped).toBe(true)
    expect(now()).toMatchObject({ problem: { kind: 'left' }, words: 'Log a call with Jo' })
  })

  it('keeps the screen on while it talks, and lets it go at the end', async () => {
    const { session, fake } = await live()
    await tick()
    expect(fake.state.taken).toBe(1)

    session.cancel()
    await tick()
    expect(fake.state.released).toBe(1)
  })
})

describe('Mute (T2-4)', () => {
  it('goes to the talk, which keeps going', async () => {
    const { session, talks, now } = await live()
    session.mute(true)

    expect(talks.last().mutes).toEqual([true])
    expect(now().live?.muted).toBe(true)
    expect(now().phase).toBe('listening')
  })
})
