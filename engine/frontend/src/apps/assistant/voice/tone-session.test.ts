/**
 * The soft tone through the voice bar's session (PLAN-V24 T5-1, choice 30), with a fake tone that
 * notes each one: it plays once as listening starts and once as it stops, however it stops, and
 * not at each turn of a conversation. While the model on the device gets ready, nothing listens
 * yet, so nothing plays. A fake mic and a fake clock: nothing real is heard or sent.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssistantCommand } from '@/api/types'
import { FakeMic, IPHONE, type FakeMicOptions } from '@/apps/companies/call-notes/mic/fake-mic'
import { BarSession, type BarSnapshot, type Times } from './bar-session'
import type { ToneKind } from './tone'

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

/** No wait ends a talk or a conversation by itself here, but the pause after a turn. */
const QUIET: Partial<Times> = {
  silence: 600_000,
  firstWords: 600_000,
  limit: 600_000,
  pause: 50,
  quiet: 600_000,
  turn: 600_000,
}

function setUp({
  mic: micOptions,
  conversation = false,
  times = QUIET,
}: { mic?: FakeMicOptions; conversation?: boolean; times?: Partial<Times> } = {}) {
  const mic = new FakeMic(micOptions)
  const tones: ToneKind[] = []
  const session = new BarSession({
    env: mic.env(),
    makeTool: mic.tool,
    read: () => Promise.resolve(TASK),
    hand: (heard) =>
      heard.kind === 'command'
        ? { kind: 'show', line: heard.command.read_back, unsure: null, again: false }
        : { kind: 'show', line: 'Dictation', unsure: null, again: false },
    onClose: () => undefined,
    conversation,
    times,
    tone: (kind) => {
      tones.push(kind)
    },
  })
  const now = (): BarSnapshot => session.getSnapshot()
  return { mic, session, tones, now }
}

async function tick(ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms)
}

beforeEach(() => {
  vi.useFakeTimers()
})

describe('the tone through the session (choice 30)', () => {
  it('one command: once as it listens, once as the talk ends, and nothing as it is worked out', async () => {
    const { mic, session, tones, now } = setUp()
    session.start('browser_service')
    expect(tones).toEqual([])
    await tick(100)
    expect(now().phase).toBe('listening')
    expect(tones).toEqual(['start'])
    mic.say(SAID)
    await tick()
    session.done()
    await tick(100)
    expect(now().phase).toBe('answer')
    expect(tones).toEqual(['start', 'stop'])
  })

  it('a conversation: once as it starts, not at each turn, and once as it stops', async () => {
    const { mic, session, tones, now } = setUp({ conversation: true })
    session.start('browser_service')
    await tick(100)
    for (const turn of [SAID, 'Open call logs', 'Email Sam that the floor plan is ready']) {
      mic.say(turn)
      await tick(100)
    }
    expect(now().phase).toBe('listening')
    expect(tones).toEqual(['start'])
    session.done()
    await tick(100)
    expect(tones).toEqual(['start', 'stop'])
  })

  it('stops once at the quiet stop, and starts again with Start again', async () => {
    const { session, tones, now } = setUp({ conversation: true, times: { ...QUIET, quiet: 2_000 } })
    session.start('browser_service')
    await tick(100)
    await tick(2_000)
    expect(now().problem).toEqual({ kind: 'quiet' })
    expect(tones).toEqual(['start', 'stop'])
    session.tryAgain()
    await tick(100)
    expect(tones).toEqual(['start', 'stop', 'start'])
  })

  it('stops once at Esc, and the closed bar plays nothing more', async () => {
    const { session, tones } = setUp({ conversation: true })
    session.start('browser_service')
    await tick(100)
    session.cancel()
    session.dispose()
    expect(tones).toEqual(['start', 'stop'])
  })

  it('stops once when the mic fails, and Type instead plays nothing', async () => {
    const { mic, session, tones, now } = setUp({ conversation: true })
    session.start('browser_service')
    await tick(100)
    mic.unplug()
    await tick(100)
    expect(now().phase).not.toBe('listening')
    expect(tones).toEqual(['start', 'stop'])
    session.typeInstead()
    expect(tones).toEqual(['start', 'stop'])
  })

  it('plays nothing while the model on the device gets ready, then once as it listens', async () => {
    const { mic, session, tones, now } = setUp({
      mic: { browser: IPHONE, modelBytes: 83_000_000 },
    })
    session.start('browser_service')
    await tick(100)
    mic.model.progress(41_000_000)
    await tick(100)
    expect(now().phase).toBe('starting')
    expect(tones).toEqual([])
    mic.model.done()
    await tick(100)
    expect(now().phase).toBe('listening')
    expect(tones).toEqual(['start'])
  })

  it('with no mic at all (typing), plays nothing', async () => {
    const { session, tones, now } = setUp()
    session.start('typing')
    await tick(100)
    expect(now().phase).toBe('typing')
    expect(tones).toEqual([])
  })
})
