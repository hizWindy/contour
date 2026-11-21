import { describe, expect, it, vi } from 'vitest'
import { micName, micsOf } from './devices'
import { FakeRecognition } from './fake-mic'
import { fixNames, lettersApart, nameWords } from './name-fix'
import {
  browserService,
  NETWORK,
  ON_DEVICE_HINTS,
  type OnDeviceState,
  type SpeechRecognitionConstructor,
  type VoiceToolEvents,
} from './voice-tool'

/*
  The voice tool seam (PLAN-V18 T3-5): the browser's speech service as a tool, the name fix, and
  the mics' names. PLAN-V24 T1-3: no lost words when the service ends, and quiet tries on a
  network blip. Made-up names only: Vitera Pty Ltd, Jo Sample.
*/

function events() {
  return {
    onReady: vi.fn<VoiceToolEvents['onReady']>(),
    onWords: vi.fn<VoiceToolEvents['onWords']>(),
    onHearing: vi.fn<VoiceToolEvents['onHearing']>(),
    onFinished: vi.fn<VoiceToolEvents['onFinished']>(),
    onProblem: vi.fn<VoiceToolEvents['onProblem']>(),
    onReconnecting: vi.fn<(reconnecting: boolean) => void>(),
  }
}

/** The browser's speech service in the window, its recognisers kept in `made`. */
function installService() {
  const made: FakeRecognition[] = []
  vi.stubGlobal(
    'SpeechRecognition',
    class extends FakeRecognition {
      constructor() {
        super()
        made.push(this)
      }
    },
  )
  return made
}

const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve))

/** A hint, as the browser's `SpeechRecognitionPhrase` makes one. */
class FakePhrase {
  readonly phrase: string
  readonly boost: number
  constructor(phrase: string, boost: number) {
    this.phrase = phrase
    this.boost = boost
  }
}

/**
 * On-device speech in the window: `SpeechRecognition.available` answers `state`, and the hint
 * maker is there (`phrases: false` leaves it out). Returns what `available` was asked.
 */
function installOnDevice(state: OnDeviceState, { phrases = true } = {}) {
  const asked: { langs: string[]; processLocally: boolean }[] = []
  const service = (window as unknown as { SpeechRecognition: SpeechRecognitionConstructor })
    .SpeechRecognition
  service.available = (options) => {
    asked.push(options)
    return Promise.resolve(state)
  }
  if (phrases) vi.stubGlobal('SpeechRecognitionPhrase', FakePhrase)
  return asked
}

/** Lets the on-device check answer, and the start that follows it. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 4; turn += 1) await flush()
}

describe('on-device mode with hints (PLAN-V23 T1-5, built and off until S1)', () => {
  it('is off by default', () => {
    expect(ON_DEVICE_HINTS).toBe(false)
  })

  it('checks the laptop first, then listens there with the hints as phrases', async () => {
    const made = installService()
    const asked = installOnDevice('available')
    const heard = events()
    browserService(heard, { onDevice: true }).start(null, ['Vitera', 'Jo Sample', 'Vitera'])
    // Nothing starts before the check answers.
    expect(made[0]?.started).toBe(0)
    await settle()
    expect(asked).toEqual([{ langs: ['en-AU'], processLocally: true }])
    const [service] = made
    expect(service?.processLocally).toBe(true)
    expect(service?.phrases).toEqual([new FakePhrase('Vitera', 2), new FakePhrase('Jo Sample', 2)])
    expect(service?.started).toBe(1)
    expect(heard.onReady).toHaveBeenCalledTimes(1)
  })

  it.each(['downloadable', 'downloading', 'unavailable'] as const)(
    'at %s, the server mode with no hints, as before',
    async (state) => {
      const made = installService()
      installOnDevice(state)
      browserService(events(), { onDevice: true }).start(null, ['Vitera'])
      await settle()
      expect(made[0]?.processLocally).toBeUndefined()
      expect(made[0]?.phrases).toBeUndefined()
      expect(made[0]?.started).toBe(1)
    },
  )

  it('a browser without phrases, or no hints, asks nothing and starts as before', async () => {
    const made = installService()
    const asked = installOnDevice('available', { phrases: false })
    browserService(events(), { onDevice: true }).start(null, ['Vitera'])
    browserService(events(), { onDevice: true }).start(null, [])
    await settle()
    expect(asked).toEqual([])
    expect(made.map((service) => service.phrases)).toEqual([undefined, undefined])
    expect(made.map((service) => service.started)).toEqual([1, 1])
  })

  it('the laptop’s speech failing before it listens: the server mode, once, with no hints', async () => {
    const made = installService()
    installOnDevice('available')
    const heard = events()
    // Chrome refuses the hints, then ends: it starts again in the server mode.
    vi.spyOn(FakeRecognition.prototype, 'start').mockImplementationOnce(function (
      this: FakeRecognition,
    ) {
      this.started += 1
      queueMicrotask(() => {
        this.error('phrases-not-supported')
        this.end()
      })
    })
    browserService(heard, { onDevice: true }).start(null, ['Vitera'])
    await settle()
    const [service] = made
    expect(service?.processLocally).toBe(false)
    expect(service?.phrases).toEqual([])
    expect(service?.started).toBe(2)
    expect(heard.onProblem).not.toHaveBeenCalled()
    expect(heard.onReady).toHaveBeenCalledTimes(1)
  })

  it('thrown away while the check is out: nothing starts', async () => {
    const made = installService()
    installOnDevice('available')
    const tool = browserService(events(), { onDevice: true })
    tool.start(null, ['Vitera'])
    tool.abort()
    await settle()
    expect(made[0]?.started).toBe(0)
  })
})

describe('how the tool writes names (PLAN-V24 choice 28)', () => {
  it('says nothing, so the name fix reads names by their capitals, as the service writes them', () => {
    // Which engine each setting and device gets is voice-engine.ts's (PLAN-V24 T4-3).
    expect(browserService(events()).nameCase).toBeUndefined()
  })
})

describe('the browser’s speech service', () => {
  it('listens in Australian English, live, to the card’s own mic track', async () => {
    const made = installService()
    const heard = events()
    const track = { kind: 'audio' } as MediaStreamTrack
    browserService(heard).start(track)
    const [service] = made
    expect(service?.lang).toBe('en-AU')
    expect(service?.continuous).toBe(true)
    expect(service?.interimResults).toBe(true)
    expect(service?.track).toBe(track)
    await flush()
    expect(heard.onReady).toHaveBeenCalledTimes(1)
  })

  it('hands back final words as chunks, and words still heard as they change', () => {
    const made = installService()
    const heard = events()
    browserService(heard).start(null)
    made[0]?.result('about the', false)
    expect(heard.onHearing).toHaveBeenLastCalledWith('about the')
    made[0]?.result('about the lease')
    expect(heard.onWords).toHaveBeenCalledWith('about the lease')
    expect(heard.onHearing).toHaveBeenLastCalledWith('')
  })

  it('starts again by itself after a silence, until it is stopped', async () => {
    const made = installService()
    const heard = events()
    const tool = browserService(heard)
    tool.start(null)
    made[0]?.error('no-speech')
    made[0]?.end()
    expect(made[0]?.started).toBe(2)
    expect(heard.onProblem).not.toHaveBeenCalled()
    tool.stop()
    await flush()
    expect(heard.onFinished).toHaveBeenCalledTimes(1)
  })

  it('finishes anyway when the service never ends after a stop', () => {
    vi.useFakeTimers()
    const made = installService()
    const heard = events()
    const tool = browserService(heard)
    tool.start(null)
    if (made[0]) made[0].stop = () => undefined
    tool.stop()
    expect(heard.onFinished).not.toHaveBeenCalled()
    vi.advanceTimersByTime(4000)
    expect(heard.onFinished).toHaveBeenCalledTimes(1)
  })

  // A network error is tried again quietly first (PLAN-V24 T1-3, below).
  it.each([
    ['not-allowed', 'blocked_browser'],
    ['audio-capture', 'no_mic'],
    ['service-not-allowed', 'tool_failed'],
    ['language-not-supported', 'tool_failed'],
  ])('reads the service’s %s as %s, once, and stops', (error, problem) => {
    const made = installService()
    const heard = events()
    browserService(heard).start(null)
    made[0]?.error(error)
    made[0]?.error(error)
    expect(heard.onProblem).toHaveBeenCalledTimes(1)
    expect(heard.onProblem).toHaveBeenCalledWith(problem)
    expect(made[0]?.aborted).toBe(true)
  })

  it('says the tool didn’t load in a browser with no speech service', () => {
    const heard = events()
    browserService(heard).start(null)
    expect(heard.onProblem).toHaveBeenCalledWith('tool_failed')
  })

  it('starts without the track where the browser refuses one', () => {
    const made = installService()
    const heard = events()
    const tool = browserService(heard)
    vi.spyOn(FakeRecognition.prototype, 'start').mockImplementationOnce(() => {
      throw new DOMException('Not a live track', 'InvalidStateError')
    })
    tool.start({ kind: 'audio' } as MediaStreamTrack)
    expect(made).toHaveLength(1)
    expect(heard.onProblem).not.toHaveBeenCalled()
  })

  it('in the server mode, as built for now, the hints never reach the service (PLAN-V23 T1-5)', async () => {
    const made = installService()
    const asked = installOnDevice('available')
    const heard = events()
    browserService(heard).start(null, ['Vitera', 'Jo Sample'])
    await flush()
    expect(asked).toEqual([])
    expect(made[0]?.processLocally).toBeUndefined()
    expect(made[0]?.phrases).toBeUndefined()
    expect(made[0]?.started).toBe(1)
  })

  it('reports nothing more once it is thrown away', () => {
    const made = installService()
    const heard = events()
    const tool = browserService(heard)
    tool.start(null)
    tool.abort()
    made[0]?.error('network')
    made[0]?.end()
    expect(made[0]?.aborted).toBe(true)
    expect(heard.onProblem).not.toHaveBeenCalled()
    expect(made[0]?.started).toBe(1)
  })
})

describe('no lost words (PLAN-V24 T1-3, choice 4)', () => {
  it('words still being heard when the service ends by itself are kept, once', () => {
    const made = installService()
    const heard = events()
    browserService(heard).start(null)
    made[0]?.result('Spoke to Jo Sample')
    made[0]?.result('about the lease', false)
    // It ends by itself before it wrote them out, and listens on.
    made[0]?.end()
    expect(heard.onWords.mock.calls).toEqual([['Spoke to Jo Sample'], ['about the lease']])
    expect(heard.onHearing).toHaveBeenLastCalledWith('')
    expect(made[0]?.started).toBe(2)
    made[0]?.end()
    expect(heard.onWords).toHaveBeenCalledTimes(2)
    expect(heard.onProblem).not.toHaveBeenCalled()
  })

  it('words the service wrote out before it ended are not kept twice', () => {
    const made = installService()
    const heard = events()
    browserService(heard).start(null)
    made[0]?.result('about the lease', false)
    made[0]?.result('About the lease.')
    made[0]?.end()
    expect(heard.onWords.mock.calls).toEqual([['About the lease.']])
  })

  it('after Done, words still being heard come before it says it is finished', async () => {
    const made = installService()
    const heard = events()
    const tool = browserService(heard)
    tool.start(null)
    made[0]?.result('follow up Friday', false)
    tool.stop()
    await flush()
    expect(heard.onWords).toHaveBeenCalledWith('follow up Friday')
    expect(heard.onFinished).toHaveBeenCalledTimes(1)
    expect(heard.onWords.mock.invocationCallOrder[0]).toBeLessThan(
      heard.onFinished.mock.invocationCallOrder[0] ?? 0,
    )
  })
})

describe('a network blip (PLAN-V24 T1-3, choice 4)', () => {
  const [FIRST_WAIT = 0, SECOND_WAIT = 0, THIRD_WAIT = 0] = NETWORK.waitsMs

  /** The service fails with a network error, then ends, as Chrome does. */
  function blip(service: FakeRecognition | undefined): void {
    service?.error('network')
    service?.end()
  }

  it('two network errors, then words: they carry on, and no problem shows', async () => {
    vi.useFakeTimers()
    const made = installService()
    const heard = events()
    browserService(heard).start(null)
    await vi.advanceTimersByTimeAsync(0)
    made[0]?.result('Spoke to Jo Sample')
    blip(made[0])
    await vi.advanceTimersByTimeAsync(FIRST_WAIT)
    expect(made[0]?.started).toBe(2)
    blip(made[0])
    await vi.advanceTimersByTimeAsync(SECOND_WAIT)
    expect(made[0]?.started).toBe(3)
    made[0]?.result('about the lease')
    expect(heard.onProblem).not.toHaveBeenCalled()
    expect(heard.onWords.mock.calls).toEqual([['Spoke to Jo Sample'], ['about the lease']])
    // "Reconnecting" showed once the blip had lasted a second, and went when the words came.
    expect(heard.onReconnecting.mock.calls).toEqual([[true], [false]])
  })

  it('says "Reconnecting" only once the blip has lasted a second', async () => {
    vi.useFakeTimers()
    const made = installService()
    const heard = events()
    browserService(heard).start(null)
    await vi.advanceTimersByTimeAsync(0)
    blip(made[0])
    await vi.advanceTimersByTimeAsync(NETWORK.reconnectingAfterMs - 1)
    expect(heard.onReconnecting).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(heard.onReconnecting).toHaveBeenLastCalledWith(true)
    // The try listens, with no new error: the connection is back, words or not.
    await vi.advanceTimersByTimeAsync(NETWORK.steadyMs)
    expect(heard.onReconnecting).toHaveBeenLastCalledWith(false)
    expect(heard.onProblem).not.toHaveBeenCalled()
  })

  it('a quick blip that mends itself says nothing', async () => {
    vi.useFakeTimers()
    const made = installService()
    const heard = events()
    browserService(heard).start(null)
    await vi.advanceTimersByTimeAsync(0)
    blip(made[0])
    await vi.advanceTimersByTimeAsync(FIRST_WAIT)
    made[0]?.result('about the lease')
    await vi.advanceTimersByTimeAsync(NETWORK.windowMs)
    expect(heard.onReconnecting).not.toHaveBeenCalled()
    expect(heard.onWords).toHaveBeenCalledWith('about the lease')
  })

  it('a fourth network error inside 10 seconds is the lost connection, with the words kept', async () => {
    vi.useFakeTimers()
    const made = installService()
    const heard = events()
    browserService(heard).start(null)
    await vi.advanceTimersByTimeAsync(0)
    made[0]?.result('Spoke to Jo Sample')
    made[0]?.result('about the', false)
    for (const wait of [FIRST_WAIT, SECOND_WAIT, THIRD_WAIT]) {
      blip(made[0])
      await vi.advanceTimersByTimeAsync(wait)
    }
    expect(made[0]?.started).toBe(4)
    expect(heard.onProblem).not.toHaveBeenCalled()
    made[0]?.error('network')
    expect(heard.onProblem).toHaveBeenCalledTimes(1)
    // It had loaded: its connection is lost, not "didn't load" (the PLAN-V24 browser check).
    expect(heard.onProblem).toHaveBeenCalledWith('connection_lost')
    expect(made[0]?.aborted).toBe(true)
    // Every word said is kept, the ones still being heard at the first blip too, once.
    expect(heard.onWords.mock.calls).toEqual([['Spoke to Jo Sample'], ['about the']])
    expect(FIRST_WAIT + SECOND_WAIT + THIRD_WAIT).toBeLessThan(NETWORK.windowMs)
  })

  it('errors more than 10 seconds apart are each a new blip', async () => {
    vi.useFakeTimers()
    const made = installService()
    const heard = events()
    browserService(heard).start(null)
    await vi.advanceTimersByTimeAsync(0)
    for (const wait of [FIRST_WAIT, SECOND_WAIT, THIRD_WAIT]) {
      blip(made[0])
      await vi.advanceTimersByTimeAsync(wait)
    }
    await vi.advanceTimersByTimeAsync(NETWORK.windowMs)
    blip(made[0])
    await vi.advanceTimersByTimeAsync(FIRST_WAIT)
    expect(heard.onProblem).not.toHaveBeenCalled()
    expect(made[0]?.started).toBe(5)
  })

  it('Done while a quiet try waits finishes at once, with the words', async () => {
    vi.useFakeTimers()
    const made = installService()
    const heard = events()
    const tool = browserService(heard)
    tool.start(null)
    await vi.advanceTimersByTimeAsync(0)
    made[0]?.result('follow up Friday', false)
    blip(made[0])
    tool.stop()
    expect(heard.onFinished).toHaveBeenCalledTimes(1)
    expect(heard.onWords).toHaveBeenCalledWith('follow up Friday')
    await vi.advanceTimersByTimeAsync(NETWORK.windowMs)
    // No try starts after Done.
    expect(made[0]?.started).toBe(1)
    expect(heard.onProblem).not.toHaveBeenCalled()
  })

  it('a network error after Done finishes with the words so far', async () => {
    const made = installService()
    const heard = events()
    const tool = browserService(heard)
    tool.start(null)
    made[0]?.result('follow up Friday', false)
    if (made[0]) made[0].stop = () => undefined
    tool.stop()
    made[0]?.error('network')
    await flush()
    expect(heard.onFinished).toHaveBeenCalledTimes(1)
    expect(heard.onWords).toHaveBeenCalledWith('follow up Friday')
    expect(heard.onProblem).not.toHaveBeenCalled()
  })

  it('thrown away while a quiet try waits: nothing more starts or comes', async () => {
    vi.useFakeTimers()
    const made = installService()
    const heard = events()
    const tool = browserService(heard)
    tool.start(null)
    await vi.advanceTimersByTimeAsync(0)
    blip(made[0])
    tool.abort()
    await vi.advanceTimersByTimeAsync(NETWORK.windowMs)
    expect(made[0]?.started).toBe(1)
    expect(heard.onReconnecting).not.toHaveBeenCalled()
    expect(heard.onProblem).not.toHaveBeenCalled()
  })
})

describe('the name fix', () => {
  const NAMES = ['Vitera Pty Ltd', 'Jo Sample']

  it('fixes a name heard nearly right, and says which', () => {
    expect(fixNames('Spoke to Jo at Vitara about the lease', NAMES)).toEqual({
      text: 'Spoke to Jo at Vitera about the lease',
      fixes: [{ from: 'Vitara', to: 'Vitera' }],
    })
    expect(fixNames('Jo Sampel called back', NAMES).text).toBe('Jo Sample called back')
  })

  it('never changes a common word, a word in small letters, or one too far off', () => {
    expect(fixNames('Simple. It was simple.', ['Sample Freight']).text).toBe(
      'Simple. It was simple.',
    )
    expect(fixNames('the vitara lease', NAMES).text).toBe('the vitara lease')
    expect(fixNames('Victoria wants more room', NAMES).text).toBe('Victoria wants more room')
    expect(fixNames('Ltd and Pty', NAMES).text).toBe('Ltd and Pty')
  })

  it('reads only the distinctive words of the names', () => {
    expect(nameWords(['Vitera Pty Ltd', 'Jo Sample', 'Sample Group Australia'])).toEqual([
      'Vitera',
      'Sample',
    ])
    expect(lettersApart('vitara', 'vitera')).toBe(1)
    expect(lettersApart('sampel', 'sample')).toBe(1)
  })
})

describe('the mics’ names', () => {
  it('reads a browser’s name for a mic as a person would', () => {
    expect(micName('Default - Headset Microphone (Jabra Evolve2 65) (0b0e:24b8)')).toBe(
      'Headset Microphone (Jabra Evolve2 65)',
    )
    expect(micName('Communications - Microphone Array (Realtek)')).toBe(
      'Microphone Array (Realtek)',
    )
  })

  it('lists each real mic once, and names one with no name yet', () => {
    const device = (deviceId: string, label: string): MediaDeviceInfo => ({
      deviceId,
      groupId: deviceId,
      kind: 'audioinput',
      label,
      toJSON: () => ({}),
    })
    expect(
      micsOf([
        device('default', 'Default - Headset (Jabra)'),
        device('communications', 'Communications - Headset (Jabra)'),
        device('a1', 'Headset (Jabra)'),
        device('a2', ''),
      ]),
    ).toEqual([
      { id: 'a1', name: 'Headset (Jabra)' },
      { id: 'a2', name: 'Mic 2' },
    ])
  })
})
