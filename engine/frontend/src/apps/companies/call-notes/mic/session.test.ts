/**
 * The mic session on its own (PLAN-V24 Part 1), with the fake mic, the fake voice tool and an
 * exact clock: the clean sound and one check a conversation (T1-1). Made-up names only: Vitera Pty
 * Ltd, Jo Sample, North Wind. No sound is ever kept.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MIC_KEY } from './devices'
import { FakeMic, HEADSET, LAPTOP_MIC, type FakeMicOptions } from './fake-mic'
import { afterHanded, lettersOf, MicSession, SOUND, type MicSessionOptions } from './session'

function open(options: FakeMicOptions = {}, more: Partial<MicSessionOptions> = {}) {
  const mic = new FakeMic(options)
  const session = new MicSession({
    mode: 'note',
    tool: 'browser_service',
    env: mic.env(),
    makeTool: mic.tool,
    ...more,
  })
  return { mic, session, now: () => session.getSnapshot() }
}

/** Moves the clock, and lets every promise the move freed settle. */
async function tick(ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms)
}

/** Opens the mic and waits until it listens. */
async function listening(options: FakeMicOptions = {}, more: Partial<MicSessionOptions> = {}) {
  const set = open(options, more)
  set.session.start()
  await tick(100)
  expect(set.now().phase).toBe('listening')
  return set
}

beforeEach(() => {
  vi.useFakeTimers()
})

describe('clean sound (T1-1, choice 1)', () => {
  it('asks for echo cancellation, noise suppression and auto gain, in one channel', async () => {
    const { mic } = await listening()
    expect(mic.asked).toEqual([
      {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      },
    ])
  })

  it('a mic picked by hand keeps its exact id, with the same clean sound', async () => {
    const mic = new FakeMic({ devices: [HEADSET, LAPTOP_MIC] })
    mic.storage.set(MIC_KEY, LAPTOP_MIC.id)
    const session = new MicSession({
      mode: 'note',
      tool: 'browser_service',
      env: mic.env(),
      makeTool: mic.tool,
    })
    session.start()
    await tick(100)
    expect(mic.asked).toEqual([{ audio: { deviceId: { exact: 'mic-laptop' }, ...SOUND } }])
    expect(session.getSnapshot().device).toEqual({
      id: 'mic-laptop',
      name: 'Microphone Array (Realtek)',
    })
  })

  it('asks for voice isolation too, only where the browser has it', async () => {
    const { mic } = await listening({ voiceIsolation: true })
    expect(mic.asked).toEqual([{ audio: { ...SOUND, voiceIsolation: true } }])
  })

  it('a check only asks for the same clean sound', async () => {
    const { mic, session, now } = open({}, { mode: 'check' })
    session.start()
    await tick(100)
    expect(now().phase).toBe('checked')
    expect(mic.asked).toEqual([{ audio: SOUND }])
  })
})

describe('the voice tool hears the mic’s own track (T1-1, choice 2)', () => {
  it('is handed the track the mic opened, the one the bars follow', async () => {
    const { mic } = await listening()
    expect(mic.tracks).toHaveLength(1)
    expect(mic.tools[0]?.track).toBe(mic.tracks[0])
  })
})

describe('one check a conversation (T1-1, choice 5)', () => {
  it('hands over the words, and the mic, the bars and the tool keep running', async () => {
    const { mic, session, now } = await listening()
    mic.say('Log a call with Jo Sample')
    mic.hear('follow up Friday')
    expect(session.handOver()).toEqual({
      text: 'Log a call with Jo Sample follow up Friday',
      fixes: [],
    })
    expect(now()).toMatchObject({ phase: 'listening', chunks: [], hearing: '', problem: null })
    expect(now().steps).toEqual({ found: 'pass', allowed: 'pass', hear: 'pass', ready: 'pass' })
    expect(now().bars).not.toBeNull()
    expect(mic.live()).toBe(1)
    expect(mic.tools).toHaveLength(1)
    expect(mic.tools[0]).toMatchObject({ started: true, stopped: false, aborted: false })
  })

  it('the next turn starts at once: no second check, and no second mic', async () => {
    const { mic, session, now } = await listening()
    mic.say('Log a call with Jo Sample')
    session.handOver()
    mic.say('Add a task to send the quote')
    expect(now().chunks).toEqual(['Add a task to send the quote'])
    expect(session.handOver().text).toBe('Add a task to send the quote')
    mic.say('Open today')
    expect(session.handOver().text).toBe('Open today')
    // One mic opened, one tool started, one check: three turns.
    expect(mic.asked).toHaveLength(1)
    expect(mic.tracks).toHaveLength(1)
    expect(mic.tools).toHaveLength(1)
    expect(now().phase).toBe('listening')
  })

  it('words still being heard go with their turn, once, when the tool writes them out', async () => {
    const { mic, session, now } = await listening()
    mic.hear('log a call with north wind')
    expect(session.handOver().text).toBe('log a call with north wind')
    // The service writes out the words it was still hearing: they went with the first turn.
    mic.say('Log a call with Northwind.')
    mic.hear('')
    expect(session.text()).toBe('')
    mic.say('Add a task for Friday')
    expect(now().chunks).toEqual(['Add a task for Friday'])
  })

  it('words that run on past the hand-over count in the next turn only', async () => {
    const { mic, session, now } = await listening()
    mic.hear('log a call with north wind')
    session.handOver()
    mic.hear('log a call with north wind add a')
    expect(now().hearing).toBe('add a')
    mic.say('Log a call with Northwind. Add a task.')
    mic.hear('')
    expect(now().chunks).toEqual(['Add a task.'])
    expect(session.text()).toBe('Add a task.')
  })

  it('hands over the names it put right with their words, and starts the next turn with none', async () => {
    const { mic, session, now } = await listening({}, { names: ['Vitera Pty Ltd', 'Jo Sample'] })
    mic.say('Spoke to Jo at Vitara')
    expect(session.handOver()).toEqual({
      text: 'Spoke to Jo at Vitera',
      fixes: [{ from: 'Vitara', to: 'Vitera' }],
    })
    expect(now().fixes).toEqual([])
  })

  it('starts the turn’s clock again, so "too slow" counts from this turn', async () => {
    const { mic, session, now } = await listening()
    const first = now().listeningSince ?? 0
    await tick(30_000)
    mic.say('Log a call with Jo Sample')
    session.handOver()
    expect(now().listeningSince).toBe(Date.now())
    expect(now().listeningSince).toBeGreaterThanOrEqual(first + 30_000)
  })

  it('Done after a hand-over writes out only the turn in progress', async () => {
    const { mic, session, now } = await listening()
    mic.say('Log a call with Jo Sample')
    session.handOver()
    mic.say('Add a task for Friday')
    session.finish()
    await tick(0)
    expect(now().phase).toBe('done')
    expect(session.text()).toBe('Add a task for Friday')
  })
})

describe('words handed over before they were written out (afterHanded)', () => {
  const handed = lettersOf('log a call with north wind')

  it('takes them off the front, however the service writes them', () => {
    expect(afterHanded('Log a call with Northwind.', handed)).toEqual({ rest: '', left: '' })
    expect(afterHanded('Log a call with Northwind. Add a task', handed)).toEqual({
      rest: 'Add a task',
      left: '',
    })
  })

  it('cuts at the nearest word end when the service changed a word', () => {
    // "for" heard, "four" written: one letter more.
    expect(afterHanded('Call four meeting add a task', lettersOf('call for meeting'))).toEqual({
      rest: 'add a task',
      left: '',
    })
    // "four" heard, "for" written: one letter less.
    expect(afterHanded('Call for meeting add a task', lettersOf('call four meeting'))).toEqual({
      rest: 'add a task',
      left: '',
    })
  })

  it('keeps what is left for the next chunk when the words come in two', () => {
    const first = afterHanded('Log a call.', handed)
    expect(first.rest).toBe('')
    expect(first.left).toBe(lettersOf('with north wind'))
    expect(afterHanded('With Northwind. Add a task', first.left).rest).toBe('Add a task')
  })

  it('cuts nothing from new words when only a letter or two is left over', () => {
    expect(afterHanded('Add a task', 'g').rest).toBe('Add a task')
    expect(afterHanded('Open today', 'ab').rest).toBe('Open today')
    expect(afterHanded('Open today', '').rest).toBe('Open today')
  })
})
