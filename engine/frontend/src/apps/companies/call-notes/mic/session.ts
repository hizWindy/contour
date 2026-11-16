/**
 * One opening of the mic card (PLAN-V18 T3-4 and T3-5): the mic check, the mic's sound for the
 * bars, the voice tool, and the words. Plain code, with the browser handed in (`MicEnv`), so the
 * tests run it with a fake mic. The card shows its snapshot and calls its methods.
 *
 * **The check** runs each time the card opens, in under 2 seconds when the rep speaks. Four lines,
 * each passed only by its real result: a mic is found (the device list), the browser allows it
 * (`getUserMedia`), we can hear you (the sound goes over a level within 2 seconds), and voice to
 * text is ready (the tool says it is listening). The first failure stops the check with its
 * problem. Silence is the one that can mend itself: the mic stays open, and the check carries on
 * the moment a voice comes.
 *
 * **Then it listens** (a note): the tool starts as soon as the mic is allowed, so the first words
 * count, and its words collect as chunks, each with the names fixed (`name-fix.ts`). Done stops
 * the tool and waits for the last words ("Writing it out"). If that takes 3 times as long as the
 * talk, it says the computer is slow.
 *
 * **The mic is let go** the moment the card closes: every track stops (so the browser's red dot
 * goes), the sound stops, and the tool is thrown away. Nothing of the sound is kept or sent.
 */
import { BAR_COUNT, type BarSource } from '@/components/motion/bar-levels'
import { hasMic, micName, micsOf, rememberedMic, rememberMic, type MicDevice } from './devices'
import { fixNames, type NameFix } from './name-fix'
import {
  speechRecognition,
  voiceToolFor,
  type VoiceTool,
  type VoiceToolKind,
  type VoiceToolMaker,
} from './voice-tool'
import { YOUR_MIC, type CheckStep, type MicProblem } from './words'

export const CHECK_STEPS: readonly CheckStep[] = ['found', 'allowed', 'hear', 'ready']

export type StepState = 'waiting' | 'pass' | 'fail'

/**
 * checking   the four lines tick
 * listening  "Speak now": the bars, the timer and the words
 * writing    after Done, the last words on their way
 * done       the words are ready for the note box
 * checked    check only: every line passed
 * failed     a line failed, or the mic stopped, with the problem's words
 *
 * Once the card is shut, the snapshot stays as it was (the card shows it while it shrinks away),
 * and the mic is let go.
 */
export type MicPhase = 'checking' | 'listening' | 'writing' | 'done' | 'checked' | 'failed'

export interface MicSnapshot {
  phase: MicPhase
  steps: Readonly<Record<CheckStep, StepState>>
  /** The line that failed, if one did. */
  failedAt: CheckStep | null
  problem: MicProblem | null
  /** The mic in use, once it is open. */
  device: MicDevice | null
  /** Every mic on this computer, for "Change". */
  devices: readonly MicDevice[]
  /** The mic's sound for the bars, while the mic is open. */
  bars: BarSource | null
  /** The words, a chunk at a time, with the names fixed. */
  chunks: readonly string[]
  /** The words still being heard. */
  hearing: string
  fixes: readonly NameFix[]
  /** When the rep could start speaking (the clock's ms), for the timer. */
  listeningSince: number | null
}

/** The browser, as the session uses it. Tests hand in a fake one. */
export interface MicEnv {
  secure: () => boolean
  media: () => MediaDevices | undefined
  /** The site's own permission for the mic: granted, denied, prompt, or null when unknown. */
  permission: () => Promise<PermissionState | null>
  audio: () => AudioContext | null
  /** True when the browser has a speech service (the Web Speech API). */
  speech: () => boolean
  now: () => number
  storage: () => Storage | null
}

export function browserEnv(): MicEnv {
  return {
    secure: () => window.isSecureContext,
    // Undefined on a page that isn't secure, whatever the types say.
    media: () => navigator.mediaDevices,
    permission: async () => {
      try {
        const status = await navigator.permissions.query({ name: 'microphone' })
        return status.state
      } catch {
        return null
      }
    },
    audio: () => {
      try {
        return typeof AudioContext === 'function' ? new AudioContext() : null
      } catch {
        return null
      }
    },
    speech: () => speechRecognition() !== null,
    now: () => performance.now(),
    storage: () => {
      try {
        return window.localStorage
      } catch {
        return null
      }
    },
  }
}

/** Sound over this level (the RMS of the wave, 0 to 1) counts as a voice. TBC after T3-3. */
export const HEAR_LEVEL = 0.015
/** The check waits this long for a voice before it says it hears nothing. */
export const SILENT_MS = 2000
const HEAR_POLL_MS = 50
/** The tool gets this long to start listening before it counts as not loaded. */
export const TOOL_START_MS = 5000
/** Writing out may take this many times as long as the talk, and at least the floor. */
export const TOO_SLOW_TIMES = 3
export const TOO_SLOW_FLOOR_MS = 5000

/** The voice's bands for the bars: low to high, spread the way an ear hears them. */
const LOW_HZ = 120
const HIGH_HZ = 6000

/** The bars' source: the mic's frequencies, in 24 bands, each from 0 to 1. */
export function barSource(analyser: AnalyserNode): BarSource {
  const bins = new Uint8Array(analyser.frequencyBinCount)
  const binHz = analyser.context.sampleRate / analyser.fftSize
  const ranges = Array.from({ length: BAR_COUNT }, (_, bar) => {
    const low = LOW_HZ * (HIGH_HZ / LOW_HZ) ** (bar / BAR_COUNT)
    const high = LOW_HZ * (HIGH_HZ / LOW_HZ) ** ((bar + 1) / BAR_COUNT)
    const from = Math.max(1, Math.min(bins.length - 1, Math.floor(low / binHz)))
    const to = Math.max(from + 1, Math.min(bins.length, Math.ceil(high / binHz)))
    return [from, to] as const
  })
  return {
    read(levels) {
      analyser.getByteFrequencyData(bins)
      ranges.forEach(([from, to], bar) => {
        let sum = 0
        for (let bin = from; bin < to; bin += 1) sum += bins[bin] ?? 0
        levels[bar] = sum / (to - from) / 255
      })
    },
  }
}

/** The loudness of the mic now: the RMS of its wave, from 0 to 1. */
function levelOf(analyser: AnalyserNode, wave: Float32Array<ArrayBuffer>): number {
  analyser.getFloatTimeDomainData(wave)
  let sum = 0
  for (const sample of wave) sum += sample * sample
  return Math.sqrt(sum / Math.max(1, wave.length))
}

/** Why `getUserMedia` refused, as a problem with words. */
export function streamProblem(error: unknown, permission: PermissionState | null): MicProblem {
  const name = error instanceof Error || error instanceof DOMException ? error.name : ''
  const message = error instanceof Error || error instanceof DOMException ? error.message : ''
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      // The browser's own "Permission denied by system", or a refusal while the site's permission
      // says Allow: the computer itself has the mic switched off for the browser (TBC: T3-3 checks
      // what Chrome on Windows says when Windows blocks it).
      return /system/i.test(message) || permission === 'granted'
        ? 'blocked_system'
        : 'blocked_browser'
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return 'no_mic'
    case 'TypeError':
      return 'old_browser'
    default:
      // NotReadableError, TrackStartError, AbortError: the mic is there but won't open.
      return 'busy'
  }
}

/** True when a picked mic is gone (unplugged), so the default mic should be used. */
function micGone(error: unknown): boolean {
  const name = error instanceof Error || error instanceof DOMException ? error.name : ''
  return name === 'OverconstrainedError' || name === 'NotFoundError'
}

const WAITING: Readonly<Record<CheckStep, StepState>> = {
  found: 'waiting',
  allowed: 'waiting',
  hear: 'waiting',
  ready: 'waiting',
}

export interface MicSessionOptions {
  /** `note`: listen for a call note. `check`: check the mic only ("Check my mic"). */
  mode: 'note' | 'check'
  tool: VoiceToolKind
  /** The company's and the person's names, for the name fix. */
  names?: readonly string[]
  env?: MicEnv
  /** The tool to run; tests hand in a fake. By default, the one for `tool`. */
  makeTool?: VoiceToolMaker | null
}

type Listener = () => void

export class MicSession {
  private readonly mode: 'note' | 'check'
  private readonly kind: VoiceToolKind
  private readonly names: readonly string[]
  private readonly env: MicEnv
  private readonly makeTool: VoiceToolMaker | null
  private readonly listeners = new Set<Listener>()
  private snapshot: MicSnapshot
  private run = 0
  private stream: MediaStream | null = null
  private audio: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private wave: Float32Array<ArrayBuffer> | null = null
  private tool: VoiceTool | null = null
  private toolReady = false
  private timers: number[] = []
  private hearTimer = 0
  private closed = false

  constructor({ mode, tool, names = [], env = browserEnv(), makeTool }: MicSessionOptions) {
    this.mode = mode
    this.kind = tool
    this.names = names
    this.env = env
    // Only the browser service has a tool until Whisper is built (T3-3): with the others the check
    // ends at "Voice to text ready", and nothing listens for words.
    this.makeTool =
      tool === 'browser_service' ? (makeTool === undefined ? voiceToolFor(tool) : makeTool) : null
    this.snapshot = {
      phase: 'checking',
      steps: WAITING,
      failedAt: null,
      problem: null,
      device: null,
      devices: [],
      bars: null,
      chunks: [],
      hearing: '',
      fixes: [],
      listeningSince: null,
    }
  }

  // --- For React (useSyncExternalStore) ---------------------------------------------------------

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = (): MicSnapshot => this.snapshot

  /** The session's clock, in ms (the timer counts from `listeningSince` with it). */
  now = (): number => this.env.now()

  private set(change: Partial<MicSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...change }
    for (const listener of this.listeners) listener()
  }

  private step(step: CheckStep, state: StepState): Readonly<Record<CheckStep, StepState>> {
    return { ...this.snapshot.steps, [step]: state }
  }

  // --- What the card asks -----------------------------------------------------------------------

  /** Runs the check, with the mic the rep picked on this computer, if any. */
  start(): void {
    if (this.closed) return
    this.release()
    this.run += 1
    this.toolReady = false
    this.set({
      phase: 'checking',
      steps: WAITING,
      failedAt: null,
      problem: null,
      bars: null,
      hearing: '',
      listeningSince: null,
    })
    void this.check(this.run, rememberedMic(this.env.storage()))
  }

  /** Try again: the check from the start. What was said so far stays. */
  retry(): void {
    this.start()
  }

  /** Another mic: remembered on this computer, then the check again with it. */
  pick(id: string): void {
    rememberMic(id, this.env.storage())
    this.start()
  }

  /** Done: the tool writes out its last words, then the words are ready. */
  finish(): void {
    const { phase, listeningSince } = this.snapshot
    if (phase !== 'listening') return
    const tool = this.tool
    if (!tool) {
      this.set({ phase: 'done' })
      return
    }
    this.set({ phase: 'writing' })
    const talk = listeningSince === null ? 0 : this.env.now() - listeningSince
    const run = this.run
    this.later(
      () => {
        if (run !== this.run || this.snapshot.phase !== 'writing') return
        this.tool?.abort()
        this.tool = null
        this.set({ phase: 'failed', problem: 'too_slow' })
      },
      Math.max(TOO_SLOW_TIMES * talk, TOO_SLOW_FLOOR_MS),
    )
    tool.stop()
  }

  /** The card is shut: the mic is let go, and nothing more comes. */
  close(): void {
    this.run += 1
    this.closed = true
    this.release()
    this.set({ bars: null })
  }

  /** Everything said so far, as one text: the chunks, then what was still being heard. */
  text(): string {
    const { chunks, hearing } = this.snapshot
    return [...chunks, hearing].filter((part) => part.trim() !== '').join(' ')
  }

  // --- The check --------------------------------------------------------------------------------

  private stale(run: number): boolean {
    return run !== this.run
  }

  private fail(run: number, at: CheckStep, problem: MicProblem, keepOpen = false): void {
    if (this.stale(run)) return
    if (!keepOpen) this.release()
    this.set({
      phase: 'failed',
      steps: this.step(at, 'fail'),
      failedAt: at,
      problem,
      bars: keepOpen ? this.snapshot.bars : null,
    })
  }

  private async check(run: number, picked: string | null): Promise<void> {
    if (!this.env.secure()) {
      this.fail(run, 'found', 'insecure')
      return
    }
    const media = this.env.media()
    if (typeof media?.getUserMedia !== 'function' || typeof media.enumerateDevices !== 'function') {
      this.fail(run, 'found', 'old_browser')
      return
    }
    const listed = await media.enumerateDevices().catch(() => [])
    if (this.stale(run)) return
    if (!hasMic(listed)) {
      this.fail(run, 'found', 'no_mic')
      return
    }
    this.set({ steps: this.step('found', 'pass'), devices: micsOf(listed) })

    let stream: MediaStream
    try {
      stream = await media.getUserMedia({
        audio: picked ? { deviceId: { exact: picked } } : true,
      })
    } catch (error) {
      if (this.stale(run)) return
      if (picked && micGone(error)) {
        // The mic picked on this computer is gone: forget it, and use the default one.
        rememberMic(null, this.env.storage())
        await this.check(run, null)
        return
      }
      const permission = await this.env.permission()
      this.fail(run, 'allowed', streamProblem(error, permission))
      return
    }
    if (this.stale(run)) {
      for (const track of stream.getTracks()) track.stop()
      return
    }
    this.stream = stream
    const track = stream.getAudioTracks()[0] ?? null
    track?.addEventListener('ended', this.onEnded)

    // Now the mic is allowed, the list has its names.
    const named = await media.enumerateDevices().catch(() => listed)
    if (this.stale(run)) return
    const devices = micsOf(named)
    const id = track?.getSettings().deviceId ?? picked ?? ''
    const device = devices.find((mic) => mic.id === id) ?? {
      id,
      name: micName(track?.label ?? '') || YOUR_MIC,
    }

    this.openSound(stream)
    this.set({
      steps: this.step('allowed', 'pass'),
      devices,
      device,
      bars: this.analyser ? barSource(this.analyser) : null,
    })

    // A note's tool starts now, so the first words count while the check finishes.
    if (this.mode === 'note' && this.makeTool) this.startTool(run, track)
    this.listenForVoice(run)
  }

  private openSound(stream: MediaStream): void {
    const audio = this.env.audio()
    if (!audio) return
    try {
      if (audio.state === 'suspended') void audio.resume().catch(() => undefined)
      const analyser = audio.createAnalyser()
      analyser.fftSize = 1024
      analyser.minDecibels = -80
      analyser.maxDecibels = -20
      analyser.smoothingTimeConstant = 0.5
      // Into the analyser only: never to the speakers, and never recorded.
      audio.createMediaStreamSource(stream).connect(analyser)
      this.audio = audio
      this.analyser = analyser
      this.wave = new Float32Array(analyser.fftSize)
    } catch {
      void audio.close().catch(() => undefined)
    }
  }

  /** Waits for a voice. Silence for 2 seconds fails the line, and a voice later mends it. */
  private listenForVoice(run: number): void {
    const analyser = this.analyser
    const wave = this.wave
    if (!analyser || !wave) {
      // No way to measure the sound in this browser: the line can't be checked, so it passes.
      this.heard(run)
      return
    }
    const started = this.env.now()
    let silentSaid = false
    this.hearTimer = window.setInterval(() => {
      if (this.stale(run)) {
        window.clearInterval(this.hearTimer)
        return
      }
      if (levelOf(analyser, wave) >= HEAR_LEVEL) {
        window.clearInterval(this.hearTimer)
        this.heard(run)
        return
      }
      if (!silentSaid && this.env.now() - started >= SILENT_MS) {
        silentSaid = true
        this.fail(run, 'hear', 'silent', true)
      }
    }, HEAR_POLL_MS)
  }

  private heard(run: number): void {
    if (this.stale(run)) return
    this.set({ phase: 'checking', steps: this.step('hear', 'pass'), failedAt: null, problem: null })
    this.toReady(run)
  }

  /** The last line: is voice to text ready? */
  private toReady(run: number): void {
    if (this.stale(run)) return
    if (this.kind !== 'browser_service') {
      // Whisper waits for T3-3, and typing has no tool: the mic itself works.
      this.fail(run, 'ready', 'not_set_up', true)
      return
    }
    if (!this.env.speech()) {
      this.fail(run, 'ready', 'no_speech_tool', true)
      return
    }
    if (this.mode === 'check') {
      // The service is there. A check doesn't start it: it would send the voice for nothing.
      this.set({ phase: 'checked', steps: this.step('ready', 'pass') })
      return
    }
    if (!this.makeTool) {
      this.fail(run, 'ready', 'not_set_up', true)
      return
    }
    if (this.toolReady) {
      this.listen()
      return
    }
    this.later(() => {
      if (!this.stale(run) && !this.toolReady && this.snapshot.phase === 'checking') {
        this.tool?.abort()
        this.tool = null
        this.fail(run, 'ready', 'tool_failed', true)
      }
    }, TOOL_START_MS)
  }

  private listen(): void {
    this.set({
      phase: 'listening',
      steps: this.step('ready', 'pass'),
      listeningSince: this.env.now(),
    })
  }

  private startTool(run: number, track: MediaStreamTrack | null): void {
    const make = this.makeTool
    if (!make) return
    const tool = make({
      onReady: () => {
        if (this.stale(run)) return
        this.toolReady = true
        const { phase, steps } = this.snapshot
        if (phase === 'checking' && steps.hear === 'pass') this.listen()
      },
      onWords: (chunk) => {
        if (this.stale(run)) return
        const fixed = fixNames(chunk, this.names)
        const fixes = [...this.snapshot.fixes]
        for (const fix of fixed.fixes) {
          if (!fixes.some((kept) => kept.from === fix.from && kept.to === fix.to)) fixes.push(fix)
        }
        this.set({ chunks: [...this.snapshot.chunks, fixed.text], fixes })
      },
      onHearing: (text) => {
        if (this.stale(run)) return
        this.set({ hearing: fixNames(text, this.names).text })
      },
      onFinished: () => {
        if (this.stale(run)) return
        if (this.snapshot.phase === 'writing') {
          this.tool = null
          // Words still heard at the end stay: they are part of the note.
          this.set({ phase: 'done' })
        }
      },
      onProblem: (problem) => {
        if (this.stale(run)) return
        this.tool = null
        const { phase } = this.snapshot
        if (phase === 'checking') {
          this.fail(run, 'ready', problem, problem !== 'no_mic')
        } else if (phase === 'listening' || phase === 'writing') {
          // The words so far stay.
          this.release()
          this.set({ phase: 'failed', problem, bars: null })
        }
      },
    })
    this.tool = tool
    tool.start(track)
  }

  /** The mic stopped by itself (unplugged, or taken by the computer). */
  private readonly onEnded = (): void => {
    const run = this.run
    const { phase } = this.snapshot
    if (phase === 'listening' || phase === 'writing') {
      this.release()
      this.set({ phase: 'failed', problem: 'cut_off', bars: null })
    } else if (phase === 'checking' || phase === 'checked') {
      const at = CHECK_STEPS.find((step) => this.snapshot.steps[step] !== 'pass') ?? 'hear'
      this.fail(run, at, 'no_mic')
    }
  }

  // --- Letting go -------------------------------------------------------------------------------

  private later(task: () => void, ms: number): void {
    this.timers.push(window.setTimeout(task, ms))
  }

  private release(): void {
    window.clearInterval(this.hearTimer)
    for (const timer of this.timers) window.clearTimeout(timer)
    this.timers = []
    this.tool?.abort()
    this.tool = null
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.removeEventListener('ended', this.onEnded)
        track.stop()
      }
      this.stream = null
    }
    if (this.audio) {
      void this.audio.close().catch(() => undefined)
      this.audio = null
    }
    this.analyser = null
    this.wave = null
  }
}
