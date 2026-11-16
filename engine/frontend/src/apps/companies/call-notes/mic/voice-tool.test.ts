import { describe, expect, it, vi } from 'vitest'
import { micName, micsOf } from './devices'
import { FakeRecognition } from './fake-mic'
import { fixNames, lettersApart, nameWords } from './name-fix'
import { browserService, voiceToolFor, type VoiceToolEvents } from './voice-tool'

/*
  The voice tool seam (PLAN-V18 T3-5): the browser's speech service as a tool, the name fix, and
  the mics' names. Made-up names only: Vitera Pty Ltd, Jo Sample.
*/

function events() {
  return {
    onReady: vi.fn<VoiceToolEvents['onReady']>(),
    onWords: vi.fn<VoiceToolEvents['onWords']>(),
    onHearing: vi.fn<VoiceToolEvents['onHearing']>(),
    onFinished: vi.fn<VoiceToolEvents['onFinished']>(),
    onProblem: vi.fn<VoiceToolEvents['onProblem']>(),
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

describe('the tool for each setting', () => {
  it('runs the browser service only when the setting says so', () => {
    expect(voiceToolFor('browser_service')).toBe(browserService)
    // Whisper waits for T3-3, and typing has no mic.
    expect(voiceToolFor('browser_model')).toBeNull()
    expect(voiceToolFor('typing')).toBeNull()
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

  it.each([
    ['not-allowed', 'blocked_browser'],
    ['audio-capture', 'no_mic'],
    ['network', 'tool_failed'],
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
