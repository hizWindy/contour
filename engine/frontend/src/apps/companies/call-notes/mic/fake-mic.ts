/**
 * A fake mic for the tests (PLAN-V18 T3-4): the browser's mic, its sound and its speech service,
 * as the mic card sees them through `MicEnv`. Only tests import it; the app never does.
 *
 *   const mic = new FakeMic({ level: 0.2 })
 *   render(<MicCard env={mic.env()} makeTool={mic.tool} ... />)
 *   mic.say('Spoke to Jo at Vitara')        // the tool hears a chunk
 *   mic.unplug()                             // the mic in use is unplugged: it stops by itself
 *   mic.plug(HEADSET)                        // a headset, the computer's new default mic
 *   expect(mic.live()).toBe(0)               // every track let go
 *
 * The first mic in `devices` is the computer's default, as browsers list it.
 *
 * `install()` puts the same fake in the window (the mic, the sound, the secure page and the
 * browser's speech service), for a test that presses the real mic button. It is taken out again
 * when the test ends. The service's recognisers are in `recognitions`, newest last.
 *
 * The engine (PLAN-V24 T4-3): the browser is Chrome on a Windows laptop unless told (`browser`),
 * so the browser's service is the engine. On a browser that gets the model, `model` is a fake one:
 * kept already and ready at once, or with `modelBytes` to download, which the test moves on.
 *
 *   const mic = new FakeMic({ browser: IPHONE, modelBytes: 83_000_000 })
 *   mic.model.progress(41_000_000)          // the download has come this far
 *   mic.model.done()                        // downloaded and loaded: the mic opens
 */
import { onTestFinished, vi } from 'vitest'
import type { NameCase } from './name-fix'
import type { MicEnv } from './session'
import type { BrowserFacts } from './voice-engine'
import type { ModelVoice, NotReady } from './voice-ready'
import type { Progress } from './on-device/engine'
import type {
  SpeechRecognitionLike,
  VoiceTool,
  VoiceToolEvents,
  VoiceToolMaker,
} from './voice-tool'

/** Browsers, for the engine choice. Real shapes of user agents, made-up version numbers. */
export const CHROME_LAPTOP: BrowserFacts = {
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
  touchPoints: 0,
  model: true,
}
export const CHROME_ANDROID: BrowserFacts = {
  userAgent:
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36',
  touchPoints: 5,
  model: true,
}
export const IPHONE: BrowserFacts = {
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1',
  touchPoints: 5,
  model: true,
}
/** The app installed on an iPhone's home screen. */
export const IPHONE_APP: BrowserFacts = {
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  touchPoints: 5,
  model: true,
}
export const FIREFOX_LAPTOP: BrowserFacts = {
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:145.0) Gecko/20100101 Firefox/145.0',
  touchPoints: 0,
  model: true,
}

/**
 * The model on the device, as the mic session sees it (PLAN-V24 T4-3): kept already and ready at
 * once, or with `bytes` to download, which the test moves on (`progress`, `done`) or fails.
 */
export class FakeModel implements ModelVoice {
  /** Bytes still to download: 0 when this browser keeps the files. */
  bytes: number
  /** How many times each was asked for. */
  readonly asked = { fetch: 0, prepare: 0 }
  private tool: VoiceToolMaker | null = null
  private waiting: {
    onProgress: (progress: Progress) => void
    resolve: (make: VoiceToolMaker) => void
    reject: (error: Error) => void
  }[] = []
  private readonly make: VoiceToolMaker

  constructor(bytes: number, make: VoiceToolMaker) {
    this.bytes = bytes
    this.make = make
  }

  loaded = (): VoiceToolMaker | null => this.tool

  fetch = (): Promise<void> => {
    this.asked.fetch += 1
    return Promise.resolve()
  }

  prepare = (onProgress: (progress: Progress) => void): Promise<VoiceToolMaker> => {
    this.asked.prepare += 1
    if (this.bytes === 0) {
      this.tool = this.make
      return Promise.resolve(this.make)
    }
    onProgress({ loaded: 0, total: this.bytes })
    return new Promise((resolve, reject) => {
      this.waiting.push({ onProgress, resolve, reject })
    })
  }

  /** The download has come this far. */
  progress(loaded: number): void {
    for (const one of this.waiting) one.onProgress({ loaded, total: this.bytes })
  }

  /** Downloaded and loaded: the browser keeps the files now. */
  done(): void {
    this.bytes = 0
    this.tool = this.make
    const waiting = this.waiting
    this.waiting = []
    for (const one of waiting) one.resolve(this.make)
  }

  /** The download failed, or the model won't load here. */
  fail(why: NotReady): void {
    const waiting = this.waiting
    this.waiting = []
    for (const one of waiting) one.reject(Object.assign(new Error('not ready'), { why }))
  }
}

export interface FakeDevice {
  id: string
  label: string
}

export interface FakeMicOptions {
  /** The mics on this computer. */
  devices?: FakeDevice[]
  /** Why the browser refuses the mic, like `{ name: 'NotAllowedError' }`. */
  refuse?: { name: string; message?: string } | null
  /** The site's own permission, as the browser says it. */
  permission?: PermissionState | null
  secure?: boolean
  /** An old browser: no mic support at all. */
  noMedia?: boolean
  /** A browser with no Web Audio: the sound can't be measured. */
  noAudio?: boolean
  /** The browser has a speech service. */
  speech?: boolean
  /** How loud the mic is (the RMS of its wave, 0 to 1). 0 is silence. */
  level?: number
  /** The tool never says it is listening. */
  toolNeverReady?: boolean
  /** After Done the tool never finishes writing out. */
  toolNeverFinishes?: boolean
  /** The browser can single out a voice from other sound (PLAN-V24 choice 1). */
  voiceIsolation?: boolean
  /** What the browser is, for the engine choice (PLAN-V24 T4-3). Left out: a Chrome laptop. */
  browser?: Partial<BrowserFacts>
  /** The model's bytes still to download. Left out: 0, the browser keeps them already. */
  modelBytes?: number
}

export const HEADSET: FakeDevice = {
  id: 'mic-headset',
  label: 'Default - Headset Microphone (Jabra Evolve2 65) (0b0e:24b8)',
}
export const LAPTOP_MIC: FakeDevice = { id: 'mic-laptop', label: 'Microphone Array (Realtek)' }

class FakeTrack extends EventTarget {
  readyState: 'live' | 'ended' = 'live'
  readonly kind = 'audio'
  readonly label: string
  readonly deviceId: string
  constructor(label: string, deviceId: string) {
    super()
    this.label = label
    this.deviceId = deviceId
  }
  getSettings(): MediaTrackSettings {
    return { deviceId: this.deviceId, groupId: this.deviceId }
  }
  stop(): void {
    this.readyState = 'ended'
  }
}

export class FakeMic {
  devices: FakeDevice[]
  refuse: { name: string; message?: string } | null
  permission: PermissionState | null
  secure: boolean
  noMedia: boolean
  noAudio: boolean
  speech: boolean
  level: number
  toolNeverReady: boolean
  toolNeverFinishes: boolean
  voiceIsolation: boolean
  browser: BrowserFacts
  /** The model on the device, for a browser that gets it (PLAN-V24 T4-3). */
  readonly model: FakeModel
  /** What each `getUserMedia` asked for. */
  readonly asked: MediaStreamConstraints[] = []
  readonly tracks: FakeTrack[] = []
  /** The tools made, newest last, and what was done to them. */
  readonly tools: {
    events: VoiceToolEvents
    started: boolean
    stopped: boolean
    aborted: boolean
    /** The names it was told to listen for as it started (PLAN-V23 T1-5). */
    hints: readonly string[]
    /** The mic's track it was told to listen to (PLAN-V24 T1-1). */
    track: MediaStreamTrack | null
    /** The model's tool writes names in any case (PLAN-V24 choice 28); the service's, capitals. */
    nameCase: NameCase
  }[] = []
  readonly storage = new Map<string, string>()
  audioClosed = 0

  constructor(options: FakeMicOptions = {}) {
    this.devices = options.devices ?? [HEADSET]
    this.refuse = options.refuse ?? null
    this.permission = options.permission ?? 'prompt'
    this.secure = options.secure ?? true
    this.noMedia = options.noMedia ?? false
    this.noAudio = options.noAudio ?? false
    this.speech = options.speech ?? true
    this.level = options.level ?? 0.2
    this.toolNeverReady = options.toolNeverReady ?? false
    this.toolNeverFinishes = options.toolNeverFinishes ?? false
    this.voiceIsolation = options.voiceIsolation ?? false
    this.browser = { ...CHROME_LAPTOP, ...options.browser }
    this.model = new FakeModel(options.modelBytes ?? 0, (events) => this.made(events, 'any'))
  }

  /** How many tracks are still open: 0 once the mic is let go. */
  live(): number {
    return this.tracks.filter((track) => track.readyState === 'live').length
  }

  /**
   * The mic in use is unplugged: it leaves the list, its tracks stop by themselves, and the
   * browser says the mics changed. With no other mic, the mic just stops.
   */
  unplug(): void {
    const gone = new Set(
      this.tracks.filter((track) => track.readyState === 'live').map((track) => track.deviceId),
    )
    this.devices = this.devices.filter((device) => !gone.has(device.id))
    for (const track of this.tracks) {
      if (track.readyState === 'live') {
        track.readyState = 'ended'
        track.dispatchEvent(new Event('ended'))
      }
    }
    this.changed()
  }

  /** A mic is plugged in: the computer's new default, unless `asDefault` is false (PLAN-V24 T1-2). */
  plug(device: FakeDevice, { asDefault = true } = {}): void {
    this.devices = asDefault ? [device, ...this.devices] : [...this.devices, device]
    this.changed()
  }

  /** The browser says the mics changed ("devicechange"). */
  changed(): void {
    this.deviceEvents.dispatchEvent(new Event('devicechange'))
  }

  /** The newest tool hears a chunk of words. */
  say(words: string): void {
    this.tools.at(-1)?.events.onWords(words)
  }

  /** The newest tool is still hearing these words. */
  hear(words: string): void {
    this.tools.at(-1)?.events.onHearing(words)
  }

  /** The newest tool reports a problem. */
  fail(problem: 'blocked_browser' | 'no_mic' | 'tool_failed' | 'too_slow'): void {
    this.tools.at(-1)?.events.onProblem(problem)
  }

  /** The newest tool lost its connection and tries again (true), or hears again (false). */
  reconnecting(on: boolean): void {
    this.tools.at(-1)?.events.onReconnecting?.(on)
  }

  /** Where "devicechange" is heard: the same mic list every time, as in a browser. */
  private readonly deviceEvents = new EventTarget()
  private mediaDevices: MediaDevices | null = null

  private media(): MediaDevices {
    this.mediaDevices ??= this.makeMedia()
    return this.mediaDevices
  }

  private makeMedia(): MediaDevices {
    const enumerateDevices = (): Promise<MediaDeviceInfo[]> => {
      const allowed = this.tracks.length > 0
      return Promise.resolve(
        this.devices.map((device): MediaDeviceInfo => ({
          deviceId: device.id,
          groupId: device.id,
          kind: 'audioinput',
          // As a browser does: no names until the mic is allowed.
          label: allowed ? device.label : '',
          toJSON: () => ({}),
        })),
      )
    }
    const getUserMedia = (constraints?: MediaStreamConstraints): Promise<MediaStream> => {
      this.asked.push(constraints ?? {})
      if (this.refuse) {
        return Promise.reject(new DOMException(this.refuse.message ?? 'Refused', this.refuse.name))
      }
      const audio = constraints?.audio
      const wanted =
        typeof audio === 'object' && audio.deviceId && typeof audio.deviceId === 'object'
          ? (audio.deviceId as ConstrainDOMStringParameters).exact
          : undefined
      const device =
        wanted === undefined ? this.devices[0] : this.devices.find((one) => one.id === wanted)
      if (!device) {
        return Promise.reject(new DOMException('No such mic', 'OverconstrainedError'))
      }
      const track = new FakeTrack(device.label, device.id)
      this.tracks.push(track)
      const stream = {
        getTracks: () => [track],
        getAudioTracks: () => [track],
      } as unknown as MediaStream
      return Promise.resolve(stream)
    }
    // The sound settings this browser knows: voice isolation only when the test says so.
    const getSupportedConstraints = (): MediaTrackSupportedConstraints => ({
      deviceId: true,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: true,
      ...(this.voiceIsolation ? { voiceIsolation: true } : {}),
    })
    const events = this.deviceEvents
    return {
      enumerateDevices,
      getUserMedia,
      getSupportedConstraints,
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
      dispatchEvent: events.dispatchEvent.bind(events),
    } as unknown as MediaDevices
  }

  private audio(): AudioContext {
    const analyser = {
      fftSize: 1024,
      frequencyBinCount: 512,
      minDecibels: -100,
      maxDecibels: -30,
      smoothingTimeConstant: 0.8,
      context: { sampleRate: 48000 },
      getFloatTimeDomainData: (wave: Float32Array) => {
        // A square wave at the mic's level: its RMS is the level.
        wave.forEach((_, index) => {
          wave[index] = index % 2 === 0 ? this.level : -this.level
        })
      },
      getByteFrequencyData: (bins: Uint8Array) => {
        bins.fill(Math.round(Math.min(1, this.level * 4) * 255))
      },
    }
    return {
      state: 'running',
      resume: () => Promise.resolve(),
      close: () => {
        this.audioClosed += 1
        return Promise.resolve()
      },
      createAnalyser: () => analyser,
      createMediaStreamSource: () => ({ connect: () => undefined, disconnect: () => undefined }),
    } as unknown as AudioContext
  }

  /** The browser, as the session sees it. */
  env(): MicEnv {
    return {
      secure: () => this.secure,
      media: () => (this.noMedia ? undefined : this.media()),
      permission: () => Promise.resolve(this.permission),
      audio: () => (this.noAudio ? null : this.audio()),
      speech: () => this.speech,
      now: () => Date.now(),
      storage: () =>
        ({
          getItem: (key: string) => this.storage.get(key) ?? null,
          setItem: (key: string, value: string) => {
            this.storage.set(key, value)
          },
          removeItem: (key: string) => {
            this.storage.delete(key)
          },
        }) as unknown as Storage,
      browser: () => this.browser,
      model: this.model,
    }
  }

  /** A fake voice tool for the browser's service: ready at once, finished as soon as stopped. */
  readonly tool: VoiceToolMaker = (events) => this.made(events, 'capitals')

  /** A fake voice tool, recorded in `tools`. The model's says it writes names in any case. */
  private made(events: VoiceToolEvents, nameCase: NameCase): VoiceTool {
    const record = {
      events,
      started: false,
      stopped: false,
      aborted: false,
      hints: [] as readonly string[],
      track: null as MediaStreamTrack | null,
      nameCase,
    }
    this.tools.push(record)
    const tool: VoiceTool = {
      start: (track, hints = []) => {
        record.started = true
        record.hints = hints
        record.track = track
        if (!this.toolNeverReady) queueMicrotask(events.onReady)
      },
      stop: () => {
        record.stopped = true
        if (!this.toolNeverFinishes) queueMicrotask(events.onFinished)
      },
      abort: () => {
        record.aborted = true
      },
      ...(nameCase === 'any' ? { nameCase } : {}),
    }
    return tool
  }

  /** The speech service's recognisers made in the window, newest last (after `install`). */
  readonly recognitions: FakeRecognition[] = []

  /** Puts this fake in the window for the rest of the test. */
  install(): void {
    const had = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices')
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      get: () => (this.noMedia ? undefined : this.media()),
    })
    onTestFinished(() => {
      if (had) Object.defineProperty(navigator, 'mediaDevices', had)
      else Reflect.deleteProperty(navigator, 'mediaDevices')
    })
    vi.stubGlobal('isSecureContext', this.secure)
    const audio = (): AudioContext => this.audio()
    vi.stubGlobal('AudioContext', function FakeAudioContext() {
      return audio()
    })
    if (this.speech) {
      const made = this.recognitions
      vi.stubGlobal(
        'SpeechRecognition',
        class extends FakeRecognition {
          constructor() {
            super()
            made.push(this)
          }
        },
      )
    }
  }
}

/** The browser's speech service, driven by the test. */
export class FakeRecognition implements SpeechRecognitionLike {
  lang = ''
  continuous = false
  interimResults = false
  maxAlternatives = 1
  /** Set only by on-device mode (PLAN-V23 T1-5). */
  processLocally?: boolean
  phrases?: unknown[]
  onstart: SpeechRecognitionLike['onstart'] = null
  onresult: SpeechRecognitionLike['onresult'] = null
  onerror: SpeechRecognitionLike['onerror'] = null
  onend: SpeechRecognitionLike['onend'] = null
  started = 0
  stopped = false
  aborted = false
  track: MediaStreamTrack | undefined

  start(track?: MediaStreamTrack): void {
    this.started += 1
    this.track = track
    queueMicrotask(() => this.onstart?.())
  }

  stop(): void {
    this.stopped = true
    queueMicrotask(() => this.onend?.())
  }

  abort(): void {
    this.aborted = true
  }

  /** The service hears words: final, or still being heard. */
  result(text: string, isFinal = true): void {
    const result = Object.assign([{ transcript: text }], { isFinal })
    this.onresult?.({ resultIndex: 0, results: [result] })
  }

  /** The service fails, like 'network' or 'not-allowed'. */
  error(error: string): void {
    this.onerror?.({ error })
  }

  /** The service ends by itself, after a silence. */
  end(): void {
    this.onend?.()
  }
}
