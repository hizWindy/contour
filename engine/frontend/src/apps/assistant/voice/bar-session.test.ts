/**
 * One opening of the voice bar (PLAN-V22 T3-1 and T3-2), with a fake mic, a fake voice tool, a fake
 * command step and an exact clock: the mic opens and listens, about 1.5 seconds of silence ends the
 * talk, V keeps the words, Esc throws them away, typing always works, and the answer goes to the
 * seam. Then each state of T3-2: nothing heard, the name fix, too many commands, Claude slow or
 * down, and the mic's own problems. Made-up names only: Sample Logistics Pty Ltd, Vitera Pty Ltd,
 * Jo Sample. No sound is ever kept.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProblem } from '@/api/client'
import type { AssistantCommand, AssistantCommandIn, AssistantOnPage } from '@/api/types'
import { FakeMic, type FakeMicOptions } from '@/apps/companies/call-notes/mic/fake-mic'
import { BarSession, TIMES, type BarSnapshot } from './bar-session'
import type { AfterAnswer, Heard } from './hand-over'

const TASK: AssistantCommand = {
  action: 'task',
  read_back: 'Add a task for you: send Sample Logistics the quote, due Mon 24 Nov.',
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

const SAID = 'Add a task to send Sample Logistics the quote on Monday'

interface SetUp {
  mic?: FakeMicOptions
  onPage?: AssistantOnPage | null
  /** The names on screen, for the name fix. */
  names?: readonly string[]
  /** The command step's answer. Default: the task above. */
  answer?: (body: AssistantCommandIn, signal: AbortSignal) => Promise<AssistantCommand>
  /** What the seam does with an answer. Default: shows its read-back. */
  after?: (heard: Heard) => AfterAnswer
}

function setUp({ mic: micOptions, onPage, names, answer, after }: SetUp = {}) {
  const mic = new FakeMic(micOptions)
  const sent: AssistantCommandIn[] = []
  const handed: Heard[] = []
  const onClose = vi.fn<() => void>()
  const session = new BarSession({
    env: mic.env(),
    makeTool: mic.tool,
    onPage: onPage ?? null,
    names: names ?? [],
    read: (body, signal) => {
      sent.push(body)
      return answer ? answer(body, signal) : Promise.resolve(TASK)
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
  return { mic, session, sent, handed, onClose, now }
}

/** Moves the clock, and lets every promise the move freed settle. */
async function tick(ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms)
}

/** Opens the bar and waits until the mic listens. */
async function listening(options: SetUp = {}) {
  const set = setUp(options)
  set.session.start('browser_service')
  await tick(100)
  expect(set.now().phase).toBe('listening')
  return set
}

beforeEach(() => {
  vi.useFakeTimers()
})

describe('listening', () => {
  it('opens the mic, then listens: the words count from the moment the mic is allowed', async () => {
    const { session, mic, now } = setUp()
    session.start('browser_service')
    // While the mic opens, the bar says so ("Looking for a mic", "Asking to use the mic").
    expect(now().phase).toBe('starting')
    await tick(100)
    expect(now().phase).toBe('listening')
    expect(mic.tools).toHaveLength(1)
    expect(mic.tools[0]?.started).toBe(true)
    expect(mic.live()).toBe(1)
  })

  it('shows the words as they come, through the mic session', async () => {
    const { mic, now } = await listening()
    mic.hear('add a task')
    expect(now().mic?.hearing).toBe('add a task')
    mic.say('Add a task to send the quote.')
    expect(now().mic?.chunks).toEqual(['Add a task to send the quote.'])
  })
})

describe('the talk ends', () => {
  it('after about 1.5 seconds with no new words, and the words go to the command step', async () => {
    const { mic, sent, now } = await listening()
    mic.say(SAID)
    await tick(TIMES.silence - 1)
    expect(sent).toEqual([])
    expect(now().phase).toBe('listening')
    await tick(1)
    expect(sent).toEqual([{ text: SAID, source: 'mic' }])
    // The mic is let go as soon as the last words are written out.
    expect(mic.live()).toBe(0)
    expect(mic.tools[0]?.stopped).toBe(true)
  })

  it('later while words are still coming', async () => {
    const { mic, sent } = await listening()
    mic.hear('add a task')
    await tick(1000)
    mic.hear('add a task to send')
    await tick(1000)
    expect(sent).toEqual([])
    await tick(500)
    expect(sent).toHaveLength(1)
  })

  it('not later when the same words are only written out', async () => {
    const { mic, sent } = await listening()
    mic.hear('add a task to send the quote')
    await tick(1000)
    // The service makes the words it heard final, and clears them from what it still hears, in
    // one go: no new words, so the silence goes on.
    mic.say('Add a task to send the quote.')
    mic.hear('')
    await tick(TIMES.silence - 1000)
    expect(sent).toEqual([{ text: 'Add a task to send the quote.', source: 'mic' }])
  })

  it('on V, at once, keeping the words', async () => {
    const { mic, session, sent, now } = await listening()
    mic.say(SAID)
    expect(session.pressV()).toBe(true)
    // "Working it out" while the last words come.
    expect(now().phase).toBe('working')
    await tick(0)
    expect(sent).toEqual([{ text: SAID, source: 'mic' }])
  })

  it('at 60 seconds at most, however long the words go on', async () => {
    const { mic, sent } = await listening()
    const words: string[] = []
    for (let second = 1; second < TIMES.limit / 1000; second += 1) {
      words.push(`word${String(second)}`)
      mic.hear(words.join(' '))
      await tick(1000)
    }
    expect(sent).toEqual([])
    await tick(1000)
    expect(sent).toHaveLength(1)
    expect(sent[0]?.source).toBe('mic')
  })
})

describe('Esc', () => {
  it('throws the words away, lets the mic go at once, and closes the bar', async () => {
    const { mic, session, sent, onClose } = await listening()
    mic.say(SAID)
    session.cancel()
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(mic.live()).toBe(0)
    expect(mic.tools[0]?.aborted).toBe(true)
    await tick(TIMES.limit)
    expect(sent).toEqual([])
  })

  it('stops a command on its way: its answer is never handed on', async () => {
    let resolve: (command: AssistantCommand) => void = () => undefined
    const { mic, session, handed, onClose } = await listening({
      answer: () =>
        new Promise((done) => {
          resolve = done
        }),
    })
    mic.say(SAID)
    session.pressV()
    await tick(0)
    expect(session.getSnapshot().phase).toBe('working')
    session.cancel()
    resolve(TASK)
    await tick(0)
    expect(handed).toEqual([])
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('typing', () => {
  it('Type instead stops the mic, and the words so far go in the text line', async () => {
    const { mic, session, now } = await listening()
    mic.say('Log a call with Jo Sample')
    session.typeInstead()
    expect(now().phase).toBe('typing')
    expect(now().draft).toBe('Log a call with Jo Sample')
    expect(mic.live()).toBe(0)
  })

  it('a typed command goes to the command step as typed', async () => {
    const { session, sent, now } = await listening()
    session.typeInstead()
    session.setDraft('  open today  ')
    session.sendTyped()
    expect(sent).toEqual([{ text: 'open today', source: 'typed' }])
    expect(now().phase).toBe('working')
    expect(now().words).toBe('open today')
  })

  it('an empty text line sends nothing', async () => {
    const { session, sent, now } = await listening()
    session.typeInstead()
    session.setDraft('   ')
    session.sendTyped()
    expect(sent).toEqual([])
    expect(now().phase).toBe('typing')
  })

  it('keeps the text line to the longest command the server takes', async () => {
    const { session, now } = await listening()
    session.typeInstead()
    session.setDraft('a'.repeat(2500))
    expect(now().draft).toHaveLength(2000)
  })

  it('with no mic, the bar opens on the text line, and it still sends', async () => {
    const { session, mic, sent, now } = setUp({ mic: { devices: [] } })
    session.start('browser_service')
    await tick(0)
    expect(now().phase).toBe('typing')
    expect(now().problem).toEqual({ kind: 'mic', problem: 'no_mic' })
    expect(mic.live()).toBe(0)
    session.setDraft('add a task to call Jo Sample on Friday')
    session.sendTyped()
    expect(sent).toEqual([{ text: 'add a task to call Jo Sample on Friday', source: 'typed' }])
  })

  it('in a browser with no speech service, the text line, and the mic is never opened', () => {
    const { session, mic, now } = setUp({ mic: { speech: false } })
    session.start('browser_service')
    expect(now()).toMatchObject({
      phase: 'typing',
      voice: false,
      problem: { kind: 'mic', problem: 'no_speech_tool' },
    })
    expect(mic.asked).toEqual([])
  })

  it('while Whisper isn’t built, the text line, and says so', () => {
    const { session, mic, now } = setUp()
    session.start('browser_model')
    expect(now()).toMatchObject({ phase: 'typing', voice: false, problem: { kind: 'no_voice' } })
    expect(mic.asked).toEqual([])
  })

  it('with typing chosen in Settings, the text line, with nothing to explain', () => {
    const { session, now } = setUp()
    session.start('typing')
    expect(now()).toMatchObject({ phase: 'typing', voice: false, problem: null })
  })
})

describe('what is on screen', () => {
  it('goes with the words, for a command that names no company', async () => {
    const { mic, session, sent } = await listening({ onPage: { company_key: '201' } })
    mic.say('Log a call with Jo, follow up Friday')
    session.pressV()
    await tick(0)
    expect(sent[0]?.on_page).toEqual({ company_key: '201' })
  })
})

describe('the answer', () => {
  it('goes to the seam, and the bar shows the line it gives back', async () => {
    const { mic, session, handed, now } = await listening()
    mic.say(SAID)
    session.pressV()
    await tick(0)
    expect(handed).toEqual([{ kind: 'command', command: TASK, words: SAID, source: 'mic' }])
    expect(now().phase).toBe('answer')
    expect(now().answer?.line).toBe(TASK.read_back)
  })

  it('closes the bar when the seam took it somewhere (a page)', async () => {
    const { mic, session, onClose } = await listening({ after: () => ({ kind: 'close' }) })
    mic.say('Open today')
    session.pressV()
    await tick(0)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('with the AI that reads commands off, hands the words on as dictation', async () => {
    const { mic, session, handed } = await listening({
      answer: () =>
        Promise.reject(
          new ApiProblem({
            title: "The Assistant can't read commands",
            status: 409,
            code: 'assistant_off',
          }),
        ),
    })
    mic.say('Spoke to Jo Sample, they move in March')
    session.pressV()
    await tick(0)
    expect(handed).toEqual([
      { kind: 'dictation', words: 'Spoke to Jo Sample, they move in March', source: 'mic' },
    ])
  })

  it('any other failure shows the server’s words, and Try again sends the same words', async () => {
    let fail = true
    const { mic, session, sent, now } = await listening({
      answer: () =>
        fail
          ? Promise.reject(
              new ApiProblem({
                title: 'Something went wrong on our side',
                detail: 'Try again.',
                status: 500,
              }),
            )
          : Promise.resolve(TASK),
    })
    mic.say(SAID)
    session.pressV()
    await tick(0)
    expect(now().phase).toBe('problem')
    expect(now().problem).toMatchObject({
      kind: 'other',
      title: 'Something went wrong on our side',
    })
    fail = false
    session.tryAgain()
    await tick(0)
    expect(sent).toHaveLength(2)
    expect(sent[1]).toEqual(sent[0])
    expect(now().phase).toBe('answer')
  })
})

describe('V while the bar shows a line or a problem', () => {
  it('listens again, from the start', async () => {
    const { mic, session, now } = await listening()
    mic.say(SAID)
    session.pressV()
    await tick(0)
    expect(now().phase).toBe('answer')
    expect(session.pressV()).toBe(true)
    await tick(100)
    expect(now().phase).toBe('listening')
    expect(mic.tools).toHaveLength(2)
  })

  it('does nothing while the words are worked out, or in the text line', async () => {
    const { mic, session } = await listening({ answer: () => new Promise(() => undefined) })
    mic.say(SAID)
    session.pressV()
    await tick(0)
    expect(session.getSnapshot().phase).toBe('working')
    expect(session.pressV()).toBe(false)
    session.typeInstead()
    expect(session.pressV()).toBe(false)
  })
})

/** The command step said no, as the server says it. */
function refused(status: number, code: string): Promise<never> {
  return Promise.reject(new ApiProblem({ title: "That didn't work", status, code }))
}

describe('each state (T3-2)', () => {
  it('nothing heard: no word 6 seconds after the mic opened, and the mic is let go', async () => {
    const { mic, session, sent, now } = setUp()
    session.start('browser_service')
    // The mic opens at once here, so the 6 seconds count from now.
    await tick(0)
    expect(now().phase).toBe('listening')
    await tick(TIMES.firstWords - 1)
    expect(now().phase).toBe('listening')
    await tick(1)
    expect(now()).toMatchObject({ phase: 'problem', problem: { kind: 'nothing_heard' } })
    expect(mic.live()).toBe(0)
    expect(sent).toEqual([])
  })

  it('nothing heard: V before any word says so at once, and V again listens again', async () => {
    const { mic, session, now } = await listening()
    session.pressV()
    expect(now().problem).toEqual({ kind: 'nothing_heard' })
    session.pressV()
    await tick(100)
    expect(now().phase).toBe('listening')
    expect(mic.tools).toHaveLength(2)
  })

  it('nothing heard: Try again listens again, and Type instead opens the text line', async () => {
    const { session, now } = await listening()
    session.pressV()
    session.tryAgain()
    await tick(100)
    expect(now().phase).toBe('listening')
    session.pressV()
    session.typeInstead()
    expect(now()).toMatchObject({ phase: 'typing', draft: '' })
  })

  it('the name fix: a name heard nearly right is put right, and the bar keeps saying so', async () => {
    const { mic, session, sent, now } = await listening({
      names: ['Vitera Pty Ltd', 'Jo Sample'],
    })
    mic.say('Log a call with Jo at Vitara')
    expect(now().mic?.chunks).toEqual(['Log a call with Jo at Vitera'])
    session.pressV()
    await tick(0)
    expect(sent[0]?.text).toBe('Log a call with Jo at Vitera')
    expect(now().fixes).toEqual([{ from: 'Vitara', to: 'Vitera' }])
  })

  it('too many commands: the words stay, and nothing more is sent', async () => {
    const { mic, session, sent, now } = await listening({
      answer: () => refused(429, 'too_many_commands'),
    })
    mic.say(SAID)
    session.pressV()
    await tick(0)
    expect(now()).toMatchObject({ phase: 'problem', problem: { kind: 'too_many' }, words: SAID })
    expect(sent).toHaveLength(1)
  })

  it('Claude slow or down: the words stay, and Try again sends the same words again', async () => {
    let down = true
    const { mic, session, sent, now } = await listening({
      answer: () => (down ? refused(503, 'claude_unavailable') : Promise.resolve(TASK)),
    })
    mic.say(SAID)
    session.pressV()
    await tick(0)
    expect(now()).toMatchObject({ phase: 'problem', problem: { kind: 'too_slow' }, words: SAID })
    down = false
    session.tryAgain()
    await tick(0)
    expect(sent.map((body) => body.text)).toEqual([SAID, SAID])
    expect(now().phase).toBe('answer')
  })

  it('an answer that doesn’t come in time is Claude slow too, and Type instead keeps the words', async () => {
    const { mic, session, now } = await listening({ answer: () => refused(0, 'timeout') })
    mic.say(SAID)
    session.pressV()
    await tick(0)
    expect(now().problem).toEqual({ kind: 'too_slow' })
    session.typeInstead()
    expect(now()).toMatchObject({ phase: 'typing', draft: SAID })
  })

  it('words the server finds empty read as nothing heard', async () => {
    const { mic, session, now } = await listening({
      answer: () => refused(422, 'command_empty'),
    })
    mic.say('...')
    session.pressV()
    await tick(0)
    expect(now().problem).toEqual({ kind: 'nothing_heard' })
  })

  it('the mic stops mid-talk: the words so far stay, and Carry on puts them in the text line', async () => {
    const { mic, session, sent, now } = await listening()
    mic.say('Spoke to Jo Sample about the lease')
    mic.unplug()
    expect(now()).toMatchObject({
      phase: 'problem',
      words: 'Spoke to Jo Sample about the lease',
      problem: { kind: 'mic', problem: 'cut_off' },
    })
    expect(mic.live()).toBe(0)
    session.typeInstead()
    expect(now()).toMatchObject({ phase: 'typing', draft: 'Spoke to Jo Sample about the lease' })
    expect(sent).toEqual([])
  })

  it('the mic goes before its own check heard a voice: still "the mic stopped", with the words', async () => {
    const { mic, session, now } = setUp({ mic: { level: 0 } })
    session.start('browser_service')
    await tick(0)
    expect(now().phase).toBe('listening')
    mic.say('Spoke to Jo Sample')
    mic.unplug()
    expect(now()).toMatchObject({
      phase: 'problem',
      words: 'Spoke to Jo Sample',
      problem: { kind: 'mic', problem: 'cut_off' },
    })
  })

  it('writing the last words out takes too long: the words so far stay, with the mic’s words', async () => {
    const { mic, session, now } = await listening({ mic: { toolNeverFinishes: true } })
    mic.say('The lease ends in June')
    session.pressV()
    expect(now().phase).toBe('working')
    await tick(5000)
    expect(now()).toMatchObject({
      phase: 'problem',
      words: 'The lease ends in June',
      problem: { kind: 'mic', problem: 'too_slow' },
    })
  })

  it('the voice tool fails before any word: the text line, and Try again listens again', async () => {
    const { mic, session, now } = await listening()
    mic.fail('tool_failed')
    expect(now()).toMatchObject({
      phase: 'typing',
      problem: { kind: 'mic', problem: 'tool_failed' },
    })
    session.tryAgain()
    await tick(100)
    expect(now().phase).toBe('listening')
  })

  it('the browser blocks the mic: the text line, with the words to fix it', async () => {
    const { session, now } = setUp({ mic: { refuse: { name: 'NotAllowedError' } } })
    session.start('browser_service')
    await tick(0)
    expect(now()).toMatchObject({
      phase: 'typing',
      problem: { kind: 'mic', problem: 'blocked_browser' },
    })
  })

  it('never keeps the sound: nothing records, and only the words go to the server', async () => {
    const recorder = vi.fn()
    vi.stubGlobal('MediaRecorder', recorder)
    const { mic, session, sent } = await listening({ onPage: { company_key: '201' } })
    mic.say(SAID)
    session.pressV()
    await tick(0)
    expect(recorder).not.toHaveBeenCalled()
    expect(sent).toEqual([{ text: SAID, source: 'mic', on_page: { company_key: '201' } }])
    expect(mic.live()).toBe(0)
  })
})
