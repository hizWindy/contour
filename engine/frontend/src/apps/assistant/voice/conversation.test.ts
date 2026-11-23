/**
 * A long conversation (PLAN-V24 Part 2, T2-1), with a fake mic, a fake voice tool, a fake command
 * step and an exact clock: one V, many commands, each reaching the command step once and in order;
 * the quiet stop; "stop listening"; "um" alone; a long turn; hold V as one turn; and words over the
 * server's limit. T2-2: smart pauses. T2-5: the wake lock, and a hidden page on a phone or a
 * laptop. Today's one command per V ("Keep listening" off) is `bar-session.test.ts`, unchanged. Made-up names only: Sample Logistics Pty Ltd, Jo Sample. No
 * sound is ever kept.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProblem } from '@/api/client'
import type { AssistantCommand, AssistantCommandIn, AssistantOnPage } from '@/api/types'
import { FakeMic, type FakeMicOptions } from '@/apps/companies/call-notes/mic/fake-mic'
import { BarSession, TIMES, type BarSnapshot, type CardShown } from './bar-session'
import type { AfterAnswer, Heard } from './hand-over'
import type { ScreenEnv } from './screen'

function command(change: Partial<AssistantCommand> = {}): AssistantCommand {
  return {
    action: 'unknown',
    read_back: 'The Assistant can open a page.',
    company: null,
    person: null,
    meeting: null,
    note_text: null,
    task: null,
    email: null,
    open: null,
    change: null,
    unsure: null,
    ...change,
  }
}

const OPEN_TODAY = 'Open today'
const ADD_TASK = 'Add a task to send Sample Logistics the quote on Monday'
const LOG_CALL = 'Log a call with Jo Sample at Sample Logistics, they move in March'

interface SetUp {
  mic?: FakeMicOptions
  /** The command step answers each call when the test says (`answer`), not at once. */
  slow?: boolean
  /** What the seam does with an answer. Default: shows its read-back. */
  after?: (heard: Heard) => AfterAnswer
  /** What is on screen at each command. */
  where?: () => AssistantOnPage | null
  cardOpen?: () => CardShown
  /** One command per V: "Keep listening" off. */
  oneCommand?: boolean
  /** The screen: the wake lock, a hidden page, a phone (T2-5). */
  screen?: ScreenEnv
}

function setUp({
  mic: micOptions,
  slow = false,
  after,
  where,
  cardOpen,
  oneCommand,
  screen,
}: SetUp = {}) {
  const mic = new FakeMic(micOptions)
  const sent: AssistantCommandIn[] = []
  const handed: Heard[] = []
  const waiting: ((answer: AssistantCommand) => void)[] = []
  const refusing: ((error: unknown) => void)[] = []
  const onClose = vi.fn<() => void>()
  const session = new BarSession({
    env: mic.env(),
    makeTool: mic.tool,
    conversation: !oneCommand,
    ...(where ? { where } : {}),
    ...(cardOpen ? { cardOpen } : {}),
    ...(screen ? { screen } : {}),
    read: (body) => {
      sent.push(body)
      if (!slow) return Promise.resolve(command({ read_back: `Read: ${body.text}` }))
      return new Promise((resolve, reject) => {
        waiting.push(resolve)
        refusing.push(reject)
      })
    },
    hand: (heard) => {
      handed.push(heard)
      if (after) return after(heard)
      return heard.kind === 'command'
        ? { kind: 'show', line: heard.command.read_back, unsure: null, again: false }
        : { kind: 'show', line: 'Dictation', unsure: null, again: false }
    },
    onClose,
  })
  const now = (): BarSnapshot => session.getSnapshot()
  /** The command step answers the oldest call still waiting. */
  const answer = async (made: AssistantCommand = command()) => {
    refusing.shift()
    waiting.shift()?.(made)
    await tick(0)
  }
  /** The command step refuses the oldest call still waiting. */
  const refuse = async (error: unknown) => {
    waiting.shift()
    refusing.shift()?.(error)
    await tick(0)
  }
  const texts = () => sent.map((body) => body.text)
  return { mic, session, sent, texts, handed, onClose, now, answer, refuse, waiting }
}

/** Moves the clock, and lets every promise the move freed settle. */
async function tick(ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms)
}

/** Opens the bar and waits until the conversation listens. */
async function listening(options: SetUp = {}) {
  const set = setUp(options)
  set.session.start('browser_service')
  await tick(100)
  expect(set.now().phase).toBe('listening')
  return set
}

/** Says a turn, then the pause that ends it. */
async function sayTurn(mic: FakeMic, words: string) {
  mic.say(words)
  await tick(TIMES.pause)
}

beforeEach(() => {
  vi.useFakeTimers()
})

describe('a conversation (PLAN-V24 T2-1)', () => {
  it('three commands in one V each reach the command step once, in order, with one mic', async () => {
    const { mic, texts, now, onClose } = await listening()
    expect(now().conversation).toMatchObject({ working: null, waiting: 0, turns: 0 })
    await sayTurn(mic, OPEN_TODAY)
    await sayTurn(mic, ADD_TASK)
    await sayTurn(mic, LOG_CALL)
    expect(texts()).toEqual([OPEN_TODAY, ADD_TASK, LOG_CALL])
    // One mic and one voice tool for the whole conversation, still listening.
    expect(mic.tools).toHaveLength(1)
    expect(mic.asked).toHaveLength(1)
    expect(mic.live()).toBe(1)
    expect(now().phase).toBe('listening')
    expect(now().conversation?.line).toBe(`Read: ${LOG_CALL}`)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('turns said while one is worked out wait for it, in order (choice 12)', async () => {
    const { mic, texts, now, answer } = await listening({ slow: true })
    await sayTurn(mic, OPEN_TODAY)
    expect(now().conversation?.working).toBe(OPEN_TODAY)
    await sayTurn(mic, ADD_TASK)
    await sayTurn(mic, LOG_CALL)
    // Only the first is with the command step; the other two wait.
    expect(texts()).toEqual([OPEN_TODAY])
    expect(now().conversation?.waiting).toBe(2)
    await answer()
    expect(texts()).toEqual([OPEN_TODAY, ADD_TASK])
    await answer()
    expect(texts()).toEqual([OPEN_TODAY, ADD_TASK, LOG_CALL])
    await answer()
    expect(now().conversation).toMatchObject({ working: null, waiting: 0 })
    expect(texts()).toHaveLength(3)
  })

  it('a turn ends after the pause, and words still coming keep it going', async () => {
    const { mic, texts } = await listening()
    mic.hear('add a task to send')
    await tick(TIMES.pause - 100)
    mic.hear('add a task to send the quote')
    await tick(TIMES.pause - 100)
    expect(texts()).toEqual([])
    await tick(100)
    expect(texts()).toEqual(['add a task to send the quote'])
  })

  it('a line shows until the next answer: a page a command opens says nothing (T2-6)', async () => {
    let answers = 0
    const { mic, now } = await listening({
      after: () => {
        answers += 1
        return answers === 1
          ? { kind: 'show', line: 'The Assistant can open a page.', unsure: null, again: true }
          : { kind: 'close' }
      },
    })
    await sayTurn(mic, 'what is the weather today')
    expect(now().conversation?.line).toBe('The Assistant can open a page.')
    await sayTurn(mic, OPEN_TODAY)
    expect(now().conversation?.line).toBeNull()
  })

  it('reads what is on screen at each command, as the conversation crosses pages', async () => {
    let page: AssistantOnPage | null = null
    const { mic, sent } = await listening({ where: () => page })
    await sayTurn(mic, OPEN_TODAY)
    page = { company_key: '201' }
    await sayTurn(mic, 'Log a call with Jo, they move in March')
    expect(sent[0]).toEqual({ text: OPEN_TODAY, source: 'mic' })
    expect(sent[1]).toEqual({
      text: 'Log a call with Jo, they move in March',
      source: 'mic',
      on_page: { company_key: '201' },
    })
  })

  it('a page a command opens goes on listening; a card it can’t hear yet ends it, as one command did', async () => {
    let card: CardShown = null
    const { mic, onClose, now } = await listening({
      after: () => ({ kind: 'close' }),
      cardOpen: () => card,
    })
    await sayTurn(mic, OPEN_TODAY)
    expect(now().phase).toBe('listening')
    expect(onClose).not.toHaveBeenCalled()
    card = 'other'
    await sayTurn(mic, ADD_TASK)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(mic.live()).toBe(0)
  })
})

describe('the quiet stop (choice 10)', () => {
  it('2 minutes with no words ends it with the quiet line, and the mic is let go', async () => {
    const { mic, now, sent } = await listening()
    mic.level = 0 // a quiet room: a voice with no words would move a deaf service to the model
    // The 2 minutes count from the moment it listened, a moment after the bar opened.
    await tick(TIMES.quiet - 200)
    expect(now().phase).toBe('listening')
    await tick(200)
    expect(now()).toMatchObject({
      phase: 'problem',
      problem: { kind: 'quiet' },
      conversation: null,
    })
    expect(mic.live()).toBe(0)
    expect(sent).toEqual([])
  })

  it('counts from the last words, not from the start', async () => {
    const { mic, now } = await listening()
    await tick(TIMES.quiet - 10_000)
    await sayTurn(mic, OPEN_TODAY)
    await tick(TIMES.quiet - TIMES.pause - 1)
    expect(now().phase).toBe('listening')
    await tick(1)
    expect(now().problem).toEqual({ kind: 'quiet' })
  })

  it('Start again (or V) listens again, as a new conversation', async () => {
    const { mic, session, now } = await listening()
    mic.level = 0 // a quiet room
    await tick(TIMES.quiet)
    expect(session.pressV()).toBe(true)
    await tick(100)
    expect(now().phase).toBe('listening')
    expect(now().conversation).toMatchObject({ turns: 0 })
    expect(mic.live()).toBe(1)
  })
})

describe('the end words (choice 10)', () => {
  it.each(['Stop listening.', "That's all.", 'Okay, that’s all, thanks'])(
    '"%s" ends it and sends nothing',
    async (said) => {
      const { mic, sent, onClose } = await listening()
      await sayTurn(mic, said)
      expect(sent).toEqual([])
      expect(mic.live()).toBe(0)
      expect(onClose).toHaveBeenCalledTimes(1)
    },
  )

  it('"stop listening" stops the mic at once, and a command said before it is still worked out', async () => {
    const { mic, texts, now, answer, onClose } = await listening({ slow: true })
    await sayTurn(mic, ADD_TASK)
    await sayTurn(mic, 'stop listening')
    expect(mic.live()).toBe(0)
    expect(now()).toMatchObject({ phase: 'working', words: ADD_TASK })
    await answer()
    expect(texts()).toEqual([ADD_TASK])
    // The last answer shows as one command's would.
    expect(now()).toMatchObject({ phase: 'answer' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('words that only contain them are a command, not an end', async () => {
    const { mic, texts, now } = await listening()
    await sayTurn(mic, "Don't stop listening yet, add a task for Jo Sample")
    expect(texts()).toEqual(["Don't stop listening yet, add a task for Jo Sample"])
    expect(now().phase).toBe('listening')
  })
})

describe('short turns (choice 11)', () => {
  it.each(['um', 'Hmm.', 'Um, uh', 'Monday'])(
    '"%s" alone sends nothing, and it listens on',
    async (said) => {
      const { mic, sent, now } = await listening()
      // Sounds alone wait the long pause: more may be coming (T2-2).
      mic.say(said)
      await tick(TIMES.longPause)
      expect(sent).toEqual([])
      expect(now().phase).toBe('listening')
      // The next real command still goes.
      await sayTurn(mic, OPEN_TODAY)
      expect(sent.map((body) => body.text)).toEqual([OPEN_TODAY])
    },
  )
})

describe('a long turn (choice 9)', () => {
  it('a 90-second turn isn’t cut, and goes as one command', async () => {
    const { mic, texts } = await listening()
    const words: string[] = []
    for (let second = 1; second <= 90; second += 1) {
      words.push(`word${String(second)}`)
      mic.hear(words.join(' '))
      await tick(1000)
    }
    expect(texts()).toEqual([])
    await tick(TIMES.pause)
    expect(texts()).toEqual([words.join(' ')])
  })

  it('a turn is cut at 2 minutes, even with words still coming, and it listens on', async () => {
    const { mic, texts, now } = await listening()
    const words: string[] = []
    // A word every second, from the turn's first word to 1 second before its 2 minutes.
    for (let second = 0; second < TIMES.turn / 1000; second += 1) {
      words.push(`word${String(second)}`)
      mic.hear(words.join(' '))
      if (second < TIMES.turn / 1000 - 1) await tick(1000)
    }
    expect(texts()).toEqual([])
    await tick(1000)
    expect(texts()).toEqual([words.join(' ')])
    expect(now().phase).toBe('listening')
  })

  it('words over the server’s 2,000 characters wait in the text line, whole, with the plan’s line', async () => {
    const { mic, session, sent, now } = await listening()
    const long = `Log a call with Jo Sample. ${'They want three floors. '.repeat(90)}`.trim()
    expect(long.length).toBeGreaterThan(2000)
    await sayTurn(mic, long)
    expect(sent).toEqual([])
    expect(now()).toMatchObject({ phase: 'typing', problem: { kind: 'too_long' }, draft: long })
    expect(mic.live()).toBe(0)
    // Enter can't send them until they are shortened; then it can.
    session.sendTyped()
    expect(sent).toEqual([])
    session.setDraft('Log a call with Jo Sample, they want three floors')
    session.sendTyped()
    expect(sent).toEqual([
      { text: 'Log a call with Jo Sample, they want three floors', source: 'typed' },
    ])
  })
})

describe('V and Stop (choice 10)', () => {
  it('V sends the turn in progress first, then it stops listening, and the bar shows the answer', async () => {
    const { mic, session, texts, now } = await listening()
    await sayTurn(mic, OPEN_TODAY)
    mic.say(ADD_TASK)
    expect(session.pressV()).toBe(true)
    await tick(0)
    expect(texts()).toEqual([OPEN_TODAY, ADD_TASK])
    expect(mic.live()).toBe(0)
    expect(now()).toMatchObject({ phase: 'answer', answer: { line: `Read: ${ADD_TASK}` } })
  })

  it('V with nothing in progress, after a command, closes the bar', async () => {
    const { mic, session, onClose } = await listening()
    await sayTurn(mic, OPEN_TODAY)
    session.pressV()
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(mic.live()).toBe(0)
  })

  it('V before any word says nothing was heard, as one command did', async () => {
    const { session, now } = await listening()
    session.pressV()
    expect(now().problem).toEqual({ kind: 'nothing_heard' })
  })

  it('Esc throws the turn and everything on its way away, and closes the bar', async () => {
    const { mic, session, sent, handed, answer, onClose } = await listening({ slow: true })
    await sayTurn(mic, OPEN_TODAY)
    await sayTurn(mic, ADD_TASK)
    mic.say(LOG_CALL)
    session.cancel()
    await answer()
    await tick(TIMES.quiet)
    expect(sent.map((body) => body.text)).toEqual([OPEN_TODAY])
    expect(handed).toEqual([])
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(mic.live()).toBe(0)
  })

  it('Type instead puts the turn in progress in the text line, and stops listening', async () => {
    const { mic, session, now } = await listening()
    mic.say('Log a call with Jo')
    session.typeInstead()
    expect(now()).toMatchObject({
      phase: 'typing',
      draft: 'Log a call with Jo',
      conversation: null,
    })
    expect(mic.live()).toBe(0)
  })
})

describe('a turn that fails (PLAN-V24 review)', () => {
  /** Claude slow or down: the command step's 503. */
  const SLOW = new ApiProblem({
    title: "That didn't work",
    status: 503,
    code: 'claude_unavailable',
  })

  it('keeps the words of the turns said after it: they join its words, and Type instead puts them all in the text line', async () => {
    const { mic, session, texts, now, refuse } = await listening({ slow: true })
    await sayTurn(mic, LOG_CALL)
    await sayTurn(mic, ADD_TASK)
    // Too short to send, so it would never have gone anywhere: left out. It ends on the long pause.
    mic.say('um')
    await tick(TIMES.longPause)
    await sayTurn(mic, OPEN_TODAY)
    expect(now().conversation?.waiting).toBe(3)
    await refuse(SLOW)
    const all = `${LOG_CALL}. ${ADD_TASK}. ${OPEN_TODAY}.`
    expect(now()).toMatchObject({
      phase: 'problem',
      problem: { kind: 'too_slow' },
      words: all,
      conversation: null,
    })
    // The turns after it went no further, and the mic is let go.
    expect(texts()).toEqual([LOG_CALL])
    expect(mic.live()).toBe(0)
    session.typeInstead()
    expect(now()).toMatchObject({ phase: 'typing', draft: all })
  })

  it('Try again sends them as one command', async () => {
    const { mic, session, texts, refuse } = await listening({ slow: true })
    await sayTurn(mic, LOG_CALL)
    await sayTurn(mic, OPEN_TODAY)
    await refuse(SLOW)
    session.tryAgain()
    expect(texts()).toEqual([LOG_CALL, `${LOG_CALL}. ${OPEN_TODAY}.`])
  })

  it('with nothing said after it, its words are as they were', async () => {
    const { mic, session, now, refuse } = await listening({ slow: true })
    await sayTurn(mic, LOG_CALL)
    await refuse(SLOW)
    expect(now()).toMatchObject({ phase: 'problem', words: LOG_CALL })
    session.typeInstead()
    expect(now().draft).toBe(LOG_CALL)
  })

  it('words that grow over the server’s 2,000 characters wait in the text line, whole', async () => {
    const { mic, now, refuse } = await listening({ slow: true })
    const long = `${'Spoke to Jo Sample about the lease and the move '.repeat(25)}in March`
    expect(long.length).toBeLessThan(2000)
    await sayTurn(mic, long)
    await sayTurn(mic, long)
    await refuse(SLOW)
    expect(now()).toMatchObject({
      phase: 'typing',
      draft: `${long}. ${long}.`,
      problem: { kind: 'too_long' },
    })
  })
})

describe('hold V is one turn (choice 7)', () => {
  it('held as it starts: no pause ends it, letting go sends it once, and the mic is let go', async () => {
    const { mic, session, texts, now } = setUp()
    session.start('browser_service')
    session.vDown()
    await tick(TIMES.hold)
    expect(now().conversation).toBeNull()
    mic.say('Log a call with')
    await tick(TIMES.pause * 3)
    mic.say('Jo Sample at Sample Logistics')
    await tick(TIMES.pause * 3)
    expect(texts()).toEqual([])
    session.vUp()
    await tick(0)
    expect(texts()).toEqual(['Log a call with Jo Sample at Sample Logistics'])
    expect(mic.live()).toBe(0)
    expect(now().phase).toBe('answer')
  })

  it('a tap starts the conversation, and it listens on after the first command', async () => {
    const { mic, session, texts, now } = setUp()
    session.start('browser_service')
    session.vDown()
    await tick(TIMES.hold - 100)
    session.vUp()
    await tick(100)
    await sayTurn(mic, OPEN_TODAY)
    expect(texts()).toEqual([OPEN_TODAY])
    expect(now().phase).toBe('listening')
    expect(mic.live()).toBe(1)
  })
})

describe('with "Keep listening" off', () => {
  it('a V is one command, as before: the silence ends it and the mic is let go', async () => {
    const { mic, session, texts, now } = setUp({ oneCommand: true })
    session.start('browser_service')
    await tick(100)
    expect(now().conversation).toBeNull()
    mic.say(OPEN_TODAY)
    await tick(TIMES.silence)
    expect(texts()).toEqual([OPEN_TODAY])
    expect(mic.live()).toBe(0)
    expect(now().phase).toBe('answer')
  })
})

describe('smart pauses (PLAN-V24 T2-2, choice 8)', () => {
  it('the waits are in TIMES: 1.2 seconds, and 3 for words that sound unfinished (TBC at S1)', () => {
    expect(TIMES.pause).toBe(1200)
    expect(TIMES.longPause).toBe(3000)
  })

  it('"log a call with" waits the long pause', async () => {
    const { mic, texts } = await listening()
    mic.say('Log a call with')
    await tick(TIMES.longPause - 1)
    expect(texts()).toEqual([])
    await tick(1)
    expect(texts()).toEqual(['Log a call with'])
  })

  it('"log a call with Northwind" ends after the short one', async () => {
    const { mic, texts } = await listening()
    mic.say('Log a call with Northwind')
    await tick(TIMES.pause - 1)
    expect(texts()).toEqual([])
    await tick(1)
    expect(texts()).toEqual(['Log a call with Northwind'])
  })

  it('a half command waits the long pause too', async () => {
    const { mic, texts } = await listening()
    mic.say('Log a call')
    await tick(TIMES.longPause - 1)
    expect(texts()).toEqual([])
    await tick(1)
    expect(texts()).toEqual(['Log a call'])
  })

  it('a joining word and more words inside the long pause make one turn', async () => {
    const { mic, texts } = await listening()
    mic.say('Log a call with')
    await tick(TIMES.longPause - 500)
    mic.say('Jo Sample at Northwind')
    await tick(TIMES.pause)
    expect(texts()).toEqual(['Log a call with Jo Sample at Northwind'])
  })

  it('words still being heard count too: the pause follows the newest words', async () => {
    const { mic, texts } = await listening()
    mic.hear('log a call with')
    await tick(TIMES.pause + 100)
    expect(texts()).toEqual([])
    mic.hear('log a call with Northwind')
    await tick(TIMES.pause)
    expect(texts()).toEqual(['log a call with Northwind'])
  })

  it('while V is held, no pause ends a turn, short or long', async () => {
    const { mic, session, texts } = setUp()
    session.start('browser_service')
    session.vDown()
    await tick(TIMES.hold)
    mic.say('Log a call with')
    await tick(TIMES.longPause * 2)
    mic.say('Jo Sample at Northwind, they move in March')
    await tick(TIMES.pause * 3)
    expect(texts()).toEqual([])
    session.vUp()
    await tick(0)
    expect(texts()).toEqual(['Log a call with Jo Sample at Northwind, they move in March'])
  })
})

/** A fake screen (T2-5): the wake lock, a page that can be hidden, and a phone or a laptop. */
function fakeScreen({ phone = true, refuse = false } = {}) {
  const listeners = new Set<() => void>()
  const state = { hidden: false, taken: 0, released: 0 }
  const screen: ScreenEnv = {
    keepOn: () => {
      if (refuse) return Promise.reject(new DOMException('Battery saver', 'NotAllowedError'))
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
  /** The page is hidden (the phone locked, or another app in front), or shown again. */
  const hide = (hidden: boolean): void => {
    state.hidden = hidden
    for (const listener of [...listeners]) listener()
  }
  return { screen, state, hide, listeners }
}

describe('phones and windows (PLAN-V24 T2-5)', () => {
  it.each<
    [
      string,
      (set: Awaited<ReturnType<typeof listening>>, hide: (on: boolean) => void) => Promise<void>,
    ]
  >([
    [
      'Stop (V)',
      async ({ session }) => {
        session.pressV()
        await tick(0)
      },
    ],
    [
      'the quiet stop',
      async ({ mic }) => {
        mic.level = 0 // a quiet room
        await tick(TIMES.quiet)
      },
    ],
    [
      'Esc',
      async ({ session }) => {
        session.cancel()
        await tick(0)
      },
    ],
    [
      'a problem (the mic unplugged mid-turn)',
      async ({ mic }) => {
        mic.say('Log a call with Jo')
        mic.unplug()
        await tick(0)
      },
    ],
    [
      'a hidden page on a phone',
      async ({ mic }, hide) => {
        mic.say('Log a call with Jo')
        hide(true)
        await tick(0)
      },
    ],
  ])('the wake lock is taken as it starts, and let go at %s', async (_, end) => {
    const fake = fakeScreen()
    const set = await listening({ screen: fake.screen })
    expect(fake.state).toMatchObject({ taken: 1, released: 0 })
    await end(set, fake.hide)
    expect(fake.state).toMatchObject({ taken: 1, released: 1 })
    expect(set.mic.live()).toBe(0)
    // Nothing is left listening for the page.
    expect(fake.listeners.size).toBe(0)
  })

  it('a refused wake lock changes nothing else', async () => {
    const fake = fakeScreen({ refuse: true })
    const { mic, texts, now } = await listening({ screen: fake.screen })
    await sayTurn(mic, OPEN_TODAY)
    await sayTurn(mic, ADD_TASK)
    expect(texts()).toEqual([OPEN_TODAY, ADD_TASK])
    expect(now().phase).toBe('listening')
    expect(mic.live()).toBe(1)
  })

  it('a hidden page on a phone ends it with the words kept, and Carry on puts them in the text line', async () => {
    const fake = fakeScreen({ phone: true })
    const { mic, session, sent, now } = await listening({ screen: fake.screen })
    mic.say('Log a call with Jo Sample, they move in')
    fake.hide(true)
    expect(now()).toMatchObject({
      phase: 'problem',
      problem: { kind: 'left' },
      words: 'Log a call with Jo Sample, they move in',
      conversation: null,
    })
    expect(mic.live()).toBe(0)
    await tick(TIMES.longPause)
    expect(sent).toEqual([])
    // Carry on: the words go in the text line, to finish and send.
    session.typeInstead()
    expect(now()).toMatchObject({
      phase: 'typing',
      draft: 'Log a call with Jo Sample, they move in',
    })
  })

  it('a hidden page on a phone with no words in progress just stops listening', async () => {
    const fake = fakeScreen({ phone: true })
    const { mic, onClose } = await listening({ screen: fake.screen })
    await sayTurn(mic, OPEN_TODAY)
    fake.hide(true)
    expect(mic.live()).toBe(0)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('on a laptop, another window in front doesn’t end it, and the screen is kept on again as it comes back', async () => {
    const fake = fakeScreen({ phone: false })
    const { mic, texts, now } = await listening({ screen: fake.screen })
    fake.hide(true)
    await tick(0)
    expect(now().phase).toBe('listening')
    expect(mic.live()).toBe(1)
    fake.hide(false)
    await tick(0)
    expect(fake.state).toMatchObject({ taken: 2, released: 1 })
    await sayTurn(mic, OPEN_TODAY)
    expect(texts()).toEqual([OPEN_TODAY])
  })

  it('one command per V ("Keep listening" off) keeps no screen on', async () => {
    const fake = fakeScreen()
    const { session, mic } = setUp({ oneCommand: true, screen: fake.screen })
    session.start('browser_service')
    await tick(100)
    mic.say(OPEN_TODAY)
    fake.hide(true)
    await tick(0)
    expect(fake.state.taken).toBe(0)
    expect(session.getSnapshot().phase).toBe('listening')
  })

  it('a held V is one turn: the screen is let go as it becomes one', async () => {
    const fake = fakeScreen()
    const { session } = setUp({ screen: fake.screen })
    session.start('browser_service')
    session.vDown()
    await tick(TIMES.hold)
    expect(fake.state).toMatchObject({ taken: 1, released: 1 })
  })
})

describe('the last turn (PLAN-V25 T5-1)', () => {
  it('goes with the next command, and a turn that found nobody keeps the one before', async () => {
    const { mic, sent, answer } = await listening({ slow: true })
    await sayTurn(mic, LOG_CALL)
    await answer(
      command({
        action: 'log_call',
        company: {
          heard: 'Sample Logistics',
          from_page: false,
          found: {
            key: '201',
            name: 'Sample Logistics Pty Ltd',
            city: 'Perth',
            industry: null,
            source: 'hubspot',
          },
          choices: [],
        },
        person: {
          heard: 'Jo Sample',
          found: { id: 'c1', name: 'Jo Sample', title: null },
          choices: [],
        },
      }),
    )
    await sayTurn(mic, OPEN_TODAY)
    await answer(command({ action: 'open' }))
    await sayTurn(mic, ADD_TASK)
    expect(sent).toHaveLength(3)
    expect(sent[0]?.last_turn).toBeUndefined()
    const kept = {
      action: 'log_call',
      company_key: '201',
      company_heard: 'Sample Logistics',
      person_id: 'c1',
      person_heard: 'Jo Sample',
    }
    expect(sent[1]?.last_turn).toEqual(kept)
    expect(sent[2]?.last_turn).toEqual(kept)
  })
})
