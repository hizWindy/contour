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
 *
 * PLAN-V24 Part 1:
 *
 * - **Clean sound** (choice 1): the mic opens with the browser's own echo cancellation, noise
 *   suppression and auto gain, in one channel, and voice isolation where the browser has it. The
 *   voice tool hears that same track (choice 2), where the browser lets it.
 * - **One check a conversation** (choice 5): `handOver` gives the words so far and clears them,
 *   while the mic, the bars and the tool keep running. The next turn starts at once, with no check
 *   and no second mic. Words still being heard go with the turn they were said in, once.
 * - **It follows the mic** (choice 3): when a headset is plugged in, or the mic in use goes, it
 *   moves to the computer's default mic, keeps the words, and says "Now using {mic}." (`movedTo`).
 *   A mic picked by hand stays while it is there. With no other mic, it stops as before.
 */
import { BAR_COUNT, type BarSource } from '@/components/motion/bar-levels'
import {
  defaultMic,
  hasMic,
  micName,
  micsOf,
  rememberedMic,
  rememberMic,
  type MicDevice,
} from './devices'
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
  /**
   * The mic it moved to by itself, for "Now using {mic}." (PLAN-V24 T1-2): a headset plugged in,
   * or the mic in use gone. Null until it moves.
   */
  movedTo: MicDevice | null
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

/**
 * The mic's sound (PLAN-V24 choice 1): the browser's own cleaning of echo, background noise and
 * loudness, in one channel. Each is a wish, not a must: a browser that can't do one still opens
 * the mic.
 */
export const SOUND: Readonly<MediaTrackConstraints> = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  channelCount: 1,
}

/** Voice isolation is newer than TypeScript's types (the Media Capture Extensions draft). */
type SoundSettings = MediaTrackConstraints & { voiceIsolation?: boolean }

/** True where the browser can single out a voice from other sound (TBC: which browsers do). */
function hasVoiceIsolation(media: MediaDevices): boolean {
  try {
    if (typeof media.getSupportedConstraints !== 'function') return false
    const supported: MediaTrackSupportedConstraints & { voiceIsolation?: boolean } =
      media.getSupportedConstraints()
    return supported.voiceIsolation === true
  } catch {
    return false
  }
}

/** What the mic opens with: the clean sound, and the picked mic's exact id when there is one. */
export function soundFor(media: MediaDevices, picked: string | null): SoundSettings {
  return {
    ...(picked ? { deviceId: { exact: picked } } : {}),
    ...SOUND,
    ...(hasVoiceIsolation(media) ? { voiceIsolation: true } : {}),
  }
}

/** The words of a turn, handed over while the mic listens on (`MicSession.handOver`). */
export interface Handed {
  /** Everything said since the last hand-over: the chunks, then what was still being heard. */
  text: string
  /** The names the fix put right in those words. */
  fixes: readonly NameFix[]
}

/** Letters and digits alone, in small letters: how words are matched across a hand-over. */
export function lettersOf(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

/**
 * Takes off the front of `text` the words that were handed over while they were still being heard
 * (`pending`, as `lettersOf` gives them), so they count once. The service may write them out a
 * little differently ("north wind" heard, "Northwind." written), so the cut is at the end of the
 * word nearest to that many letters, and the earlier one when two are as near.
 *
 * Returns what is left of the text, and what is left of `pending` when the text was all handed
 * over already (its words may come in more than one chunk).
 */
export function afterHanded(text: string, pending: string): { rest: string; left: string } {
  if (pending === '') return { rest: text, left: '' }
  const total = lettersOf(text).length
  if (total <= pending.length) return { rest: '', left: pending.slice(total) }
  let count = 0
  let cut = 0
  let away = pending.length
  for (const word of text.matchAll(/\S+/g)) {
    count += lettersOf(word[0]).length
    const off = Math.abs(count - pending.length)
    if (off < away) {
      away = off
      cut = word.index + word[0].length
    }
    // Every word after this one is further away.
    if (count >= pending.length) break
  }
  return { rest: text.slice(cut).trimStart(), left: '' }
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

/**
 * The mic a track comes from: by its id, else by its name (Chrome calls the default mic's track
 * "default", with the real mic's name), else by what the track says.
 */
function deviceOf(
  track: MediaStreamTrack | null,
  devices: readonly MicDevice[],
  picked: string | null,
): MicDevice {
  const id = track?.getSettings().deviceId ?? picked ?? ''
  const name = micName(track?.label ?? '')
  return (
    devices.find((mic) => mic.id === id) ??
    devices.find((mic) => name !== '' && mic.name === name) ?? { id, name: name || YOUR_MIC }
  )
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
  /** The names the speech service listens for, in on-device mode only (PLAN-V23 T1-5). */
  hints?: readonly string[]
  env?: MicEnv
  /** The tool to run; tests hand in a fake. By default, the one for `tool`. */
  makeTool?: VoiceToolMaker | null
}

type Listener = () => void

export class MicSession {
  private readonly mode: 'note' | 'check'
  private readonly kind: VoiceToolKind
  private names: readonly string[]
  private hints: readonly string[]
  private readonly env: MicEnv
  private readonly makeTool: VoiceToolMaker | null
  private readonly listeners = new Set<Listener>()
  private snapshot: MicSnapshot
  private run = 0
  private stream: MediaStream | null = null
  /** The mic's track in use: the bars and the voice tool hear it. */
  private track: MediaStreamTrack | null = null
  private audio: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  /** The mic's sound going into the analyser, swapped when the mic changes. */
  private source: AudioNode | null = null
  private wave: Float32Array<ArrayBuffer> | null = null
  private tool: VoiceTool | null = null
  private toolReady = false
  private timers: number[] = []
  private hearTimer = 0
  /** The words still being heard as they were handed over, as letters: they count once. */
  private pending = ''
  /** The words still being heard now, as the tool gave them (before the name fix). */
  private heardRaw = ''
  /** The mic picked by hand that this opening uses, or null for the computer's default (T1-2). */
  private picked: string | null = null
  /** The computer's default mic, as last seen: when it changes, the mic follows. */
  private defaultId: string | null = null
  /** Where the session hears that the mics changed, while the mic is open. */
  private watching: MediaDevices | null = null
  /** The run that is moving to another mic now, or 0; and whether to look again after. */
  private moving = 0
  private lookAgain = false
  /** The voice tool said it lost the mic: it waits for the mic to be followed first. */
  private toolLost: MicProblem | null = null

  constructor({
    mode,
    tool,
    names = [],
    hints = [],
    env = browserEnv(),
    makeTool,
  }: MicSessionOptions) {
    this.mode = mode
    this.kind = tool
    this.names = names
    this.hints = hints
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
      movedTo: null,
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
    // A start after a close opens the mic again: React runs an effect twice while developing
    // (StrictMode), close then start, and the card must still work.
    this.release()
    this.run += 1
    this.toolReady = false
    this.pending = ''
    this.heardRaw = ''
    this.set({
      phase: 'checking',
      steps: WAITING,
      failedAt: null,
      problem: null,
      bars: null,
      hearing: '',
      listeningSince: null,
      movedTo: null,
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
    this.release()
    this.set({ bars: null })
  }

  /**
   * Names that came in after the card opened (PLAN-V23 T1-5: the hint list loads on the first V):
   * the fix uses them from the next words on, and the speech service from its next start.
   */
  setNames(names: readonly string[], hints: readonly string[] = this.hints): void {
    this.names = names
    this.hints = hints
  }

  /** Everything said so far, as one text: the chunks, then what was still being heard. */
  text(): string {
    const { chunks, hearing } = this.snapshot
    return [...chunks, hearing].filter((part) => part.trim() !== '').join(' ')
  }

  /**
   * A turn is over and the mic listens on (PLAN-V24 T1-1, for Part 2's conversation): the words
   * since the last hand-over go, with their name fixes, and the session starts the next turn
   * empty. The mic, the bars and the voice tool keep running, so the next turn starts at once,
   * with no check and no second mic.
   *
   * Words still being heard go with this turn. When the tool writes them out, they are taken off
   * the next words (`afterHanded`), so they never count twice. The turn's clock starts again, for
   * the "too slow" wait after Done.
   */
  handOver(): Handed {
    const text = this.text()
    const { fixes, phase, listeningSince } = this.snapshot
    this.pending += lettersOf(this.heardRaw)
    this.heardRaw = ''
    this.set({
      chunks: [],
      hearing: '',
      fixes: [],
      listeningSince: phase === 'listening' ? this.env.now() : listeningSince,
    })
    return { text, fixes }
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
      stream = await media.getUserMedia({ audio: soundFor(media, picked) })
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
    this.picked = picked
    const track = stream.getAudioTracks()[0] ?? null
    this.track = track
    track?.addEventListener('ended', this.onEnded)

    // Now the mic is allowed, the list has its names.
    const named = await media.enumerateDevices().catch(() => listed)
    if (this.stale(run)) return
    const devices = micsOf(named)
    const device = deviceOf(track, devices, picked)
    this.defaultId = defaultMic(named)?.id ?? null

    this.openSound(stream)
    this.set({
      steps: this.step('allowed', 'pass'),
      devices,
      device,
      bars: this.analyser ? barSource(this.analyser) : null,
    })
    this.watch(media)

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
      const source = audio.createMediaStreamSource(stream)
      source.connect(analyser)
      this.audio = audio
      this.analyser = analyser
      this.source = source
      this.wave = new Float32Array(analyser.fftSize)
    } catch {
      void audio.close().catch(() => undefined)
    }
  }

  /** The bars follow another mic: its sound goes into the same analyser (T1-2). */
  private swapSound(stream: MediaStream): void {
    const { audio, analyser } = this
    if (!audio || !analyser) return
    try {
      this.source?.disconnect()
      const source = audio.createMediaStreamSource(stream)
      source.connect(analyser)
      this.source = source
    } catch {
      this.source = null
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
    let tool: VoiceTool | null = null
    // Only the session's tool of the moment counts: one let go when the mic moved says no more.
    const current = (): boolean => !this.stale(run) && tool !== null && this.tool === tool
    tool = make({
      onReady: () => {
        if (!current()) return
        this.toolReady = true
        const { phase, steps } = this.snapshot
        if (phase === 'checking' && steps.hear === 'pass') this.listen()
      },
      onWords: (chunk) => {
        if (!current()) return
        // Words handed over before they were final count once (`handOver`).
        const { rest, left } = afterHanded(chunk, this.pending)
        this.pending = left
        this.addChunk(rest)
      },
      onHearing: (text) => {
        if (!current()) return
        // Nothing is still being heard: words handed over before they were final are all in.
        if (text.trim() === '') this.pending = ''
        this.heardRaw = afterHanded(text, this.pending).rest
        this.set({ hearing: fixNames(this.heardRaw, this.names).text })
      },
      onFinished: () => {
        if (!current()) return
        if (this.snapshot.phase === 'writing') {
          this.tool = null
          // Words still heard at the end stay: they are part of the note.
          this.set({ phase: 'done' })
        }
      },
      onProblem: (problem) => {
        if (!current()) return
        this.tool = null
        const { phase, steps } = this.snapshot
        const open = this.stream !== null && steps.allowed === 'pass' && phase !== 'writing'
        if (problem === 'no_mic' && open && this.otherMic()) {
          // The mic it heard may have gone (unplugged): follow the mic first (T1-2). It fails
          // only if nothing moved.
          this.toolLost = problem
          void this.follow(run)
          return
        }
        this.toolFailed(run, problem)
      },
    })
    this.tool = tool
    tool.start(track, this.hints)
  }

  /** A chunk of final words, with the names fixed. */
  private addChunk(text: string): void {
    if (text.trim() === '') return
    const fixed = fixNames(text, this.names)
    const fixes = [...this.snapshot.fixes]
    for (const fix of fixed.fixes) {
      if (!fixes.some((kept) => kept.from === fix.from && kept.to === fix.to)) fixes.push(fix)
    }
    this.set({ chunks: [...this.snapshot.chunks, fixed.text], fixes })
  }

  /** The voice tool can't go on. The words so far stay. */
  private toolFailed(run: number, problem: MicProblem): void {
    const { phase } = this.snapshot
    if (phase === 'checking') {
      this.fail(run, 'ready', problem, problem !== 'no_mic')
    } else if (phase === 'listening' || phase === 'writing') {
      this.release()
      this.set({ phase: 'failed', problem, bars: null })
    }
  }

  /**
   * The mic stopped by itself (unplugged, or taken by the computer). With another mic on this
   * computer, the mic follows (T1-2); with none, or while the last words are written out, it
   * stops as before.
   */
  private readonly onEnded = (): void => {
    const run = this.run
    const { phase, steps } = this.snapshot
    if (phase !== 'writing' && steps.allowed === 'pass' && this.otherMic()) {
      void this.follow(run)
      return
    }
    this.lost(run)
  }

  /** The mic is gone and no other took its place: the words so far stay. */
  private lost(run: number): void {
    if (this.stale(run)) return
    const { phase } = this.snapshot
    if (phase === 'listening' || phase === 'writing') {
      this.release()
      this.set({ phase: 'failed', problem: 'cut_off', bars: null })
    } else if (phase === 'checking' || phase === 'checked') {
      const at = CHECK_STEPS.find((step) => this.snapshot.steps[step] !== 'pass') ?? 'hear'
      this.fail(run, at, 'no_mic')
    }
  }

  // --- Following the mic (PLAN-V24 T1-2, choice 3) -------------------------------------------------

  /** Hears when the mics change (a headset plugged in, or one gone), while the mic is open. */
  private watch(media: MediaDevices): void {
    if (typeof media.addEventListener !== 'function') return
    media.addEventListener('devicechange', this.onDeviceChange)
    this.watching = media
  }

  private readonly onDeviceChange = (): void => {
    void this.follow(this.run)
  }

  /** True when this computer has a mic other than the one in use, as last listed. */
  private otherMic(): boolean {
    const { device, devices } = this.snapshot
    return devices.some((mic) => mic.id !== device?.id)
  }

  /** One look at the mics at a time. A change that comes during one is looked at after it. */
  private async follow(run: number): Promise<void> {
    if (this.moving === run) {
      this.lookAgain = true
      return
    }
    this.moving = run
    try {
      do {
        this.lookAgain = false
        await this.lookAtMics(run)
      } while (this.lookAgain && !this.stale(run))
    } finally {
      if (this.moving === run) this.moving = 0
    }
  }

  /**
   * A mic picked by hand stays while it is there and works. Otherwise the computer's default mic
   * is used: as soon as it changes (a headset plugged in), or when the mic in use goes. A move
   * that fails leaves the mic in use as it is, while it works.
   */
  private async lookAtMics(run: number): Promise<void> {
    const media = this.env.media()
    if (!media || !this.stream || this.snapshot.phase === 'writing') {
      this.afterLook(run)
      return
    }
    const listed = await media.enumerateDevices().catch(() => null)
    if (this.stale(run) || !this.stream) return
    const live = this.track?.readyState === 'live'
    if (!listed) {
      if (live) this.afterLook(run)
      else this.lost(run)
      return
    }
    const devices = micsOf(listed)
    const pickedThere = this.picked !== null && devices.some((mic) => mic.id === this.picked)
    const nowDefault = defaultMic(listed)?.id ?? null
    const stay = this.picked !== null ? pickedThere : nowDefault === this.defaultId
    if (live && stay) {
      // Nothing to follow. The list may still have changed, for "Change".
      this.set({ devices })
      this.afterLook(run)
      return
    }
    if (!hasMic(listed)) {
      this.lost(run)
      return
    }
    if (this.picked !== null && !pickedThere) {
      // The mic picked by hand is gone: forget it, as the check does, and use the default one.
      rememberMic(null, this.env.storage())
      this.picked = null
    }
    const stream = await media
      .getUserMedia({ audio: soundFor(media, this.picked) })
      .catch(() => null)
    if (this.stale(run) || !this.stream) {
      for (const track of stream?.getTracks() ?? []) track.stop()
      return
    }
    if (!stream) {
      if (live) {
        this.set({ devices })
        this.afterLook(run)
      } else {
        this.lost(run)
      }
      return
    }
    // The list as it is now, with the mic that opened: it may have changed while it opened.
    const now = await media.enumerateDevices().catch(() => listed)
    if (this.stale(run) || !this.stream) {
      for (const track of stream.getTracks()) track.stop()
      return
    }
    this.useStream(run, stream, now)
  }

  /** A look that moved nothing: a voice tool that lost the mic has failed after all. */
  private afterLook(run: number): void {
    const problem = this.toolLost
    this.toolLost = null
    if (problem && !this.stale(run)) this.toolFailed(run, problem)
  }

  /** Moves to another mic: the bars and the voice tool hear it, and the words stay. */
  private useStream(run: number, stream: MediaStream, listed: readonly MediaDeviceInfo[]): void {
    const before = this.snapshot.device
    for (const old of this.stream?.getTracks() ?? []) {
      old.removeEventListener('ended', this.onEnded)
      old.stop()
    }
    this.stream = stream
    const track = stream.getAudioTracks()[0] ?? null
    this.track = track
    track?.addEventListener('ended', this.onEnded)
    this.swapSound(stream)
    const devices = micsOf(listed)
    const device = deviceOf(track, devices, this.picked)
    this.defaultId = defaultMic(listed)?.id ?? null
    this.set({
      device,
      devices,
      movedTo: device.id === before?.id ? this.snapshot.movedTo : device,
    })
    // The voice tool hears the new mic. What it was still hearing is kept as said.
    const lost = this.toolLost !== null
    this.toolLost = null
    if (this.tool || lost) {
      this.keepHearing()
      this.tool?.abort()
      this.tool = null
      this.startTool(run, track)
    }
  }

  /** Words still being heard are kept as said, before their tool is let go. */
  private keepHearing(): void {
    const raw = this.heardRaw
    this.pending = ''
    this.heardRaw = ''
    this.set({ hearing: '' })
    this.addChunk(raw)
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
    this.toolLost = null
    this.lookAgain = false
    this.watching?.removeEventListener('devicechange', this.onDeviceChange)
    this.watching = null
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.removeEventListener('ended', this.onEnded)
        track.stop()
      }
      this.stream = null
    }
    this.track = null
    if (this.audio) {
      void this.audio.close().catch(() => undefined)
      this.audio = null
    }
    this.analyser = null
    this.source = null
    this.wave = null
  }
}
