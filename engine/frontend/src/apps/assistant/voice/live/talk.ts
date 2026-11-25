/**
 * One live talk (PLAN-V28 Part 2): from V to its end, the rep talks with Gemini through our relay.
 * Plain code with the browser handed in (`TalkEnv`), so the tests run it with a fake relay, fake
 * audio and the fake mic. The voice bar's session drives it (`bar-session.ts`) and shows its
 * snapshot.
 *
 * - **It starts at once** (T2-3): the start (`POST /assistant/voice/session`, with the company on
 *   screen), the mic and the Assistant's voice get ready together, then the socket opens. A start
 *   refused (403, 409, 429 or 503), or a socket that never reaches `ready`, ends it before a word,
 *   and the bar takes the free mic over (Part 4 says why).
 * - **The mic opens as the mic card's does** (T2-1): echo cancellation, noise suppression and
 *   automatic gain, the mic picked on this computer, else the computer's default. It follows a
 *   headset plugged in, and says "Now using {mic}." (`movedTo`).
 * - **Sound in:** each 20 ms piece goes through the silence gate (`gate.ts`): nothing before
 *   `ready`, then only while someone talks, with one `pause` after. The gate is stricter while
 *   the Assistant speaks.
 * - **Sound out** (T2-2): Gemini's sound plays as it comes. When the gate hears the rep start over
 *   it, its voice drops to a third, until `interrupted` empties it, or for a second at most if
 *   Google talks on (TBC at T5-2). `turn_complete` lets the rest play out.
 * - **The states, for the pill** (T2-4): connecting, live, reconnecting (Google's side, or our
 *   backend's), and ended; with speaking (until the buffer is empty), working (a tool call waits
 *   for its answer) and muted beside them.
 * - **Captions:** the rep's words as Google hears them, then the Assistant's (`withHeard`,
 *   `withSaid`). A new exchange starts once the Assistant has said something.
 * - **Mute** stops sending sound and keeps the talk: the mic's track goes silent, and the gate
 *   shuts with one `pause`.
 * - **Tool calls** go to `onToolCall`, and their cancellations to `onToolCancel` (Part 3's bridge);
 *   `answer` answers each once.
 * - **Every end lets everything go:** the socket (with `stop`), the mic, the two audio contexts
 *   and the start still on its way. Nothing of the sound or the words is kept.
 */
import { toApiProblem, type ApiProblem } from '@/api/client'
import { startLiveVoice } from '@/api/hooks/live-voice'
import type { VoiceEndReason, VoiceHeard, VoiceSessionOut, VoiceToolAnswer } from '@/api/types'
import {
  defaultMic,
  hasMic,
  micName,
  micsOf,
  rememberedMic,
  rememberMic,
  type MicDevice,
} from '@/apps/companies/call-notes/mic/devices'
import {
  browserEnv,
  soundFor,
  streamProblem,
  type MicEnv,
} from '@/apps/companies/call-notes/mic/session'
import { YOUR_MIC, type MicProblem } from '@/apps/companies/call-notes/mic/words'
import type { BarSource } from '@/components/motion/bar-levels'
import { closeAudio, takeAudio, type LiveAudio } from './audio'
import { openCapture, type OpenCapture, type SoundIn } from './capture'
import type { Frame } from './dsp'
import { Gate } from './gate'
import { openPlayer, type OpenPlayer, type SoundOut } from './player'
import { browserRelay, Relay, type RelayClosed, type RelayEnv, type RelayMessage } from './relay'

/** While the rep starts to talk over the Assistant, its voice stays a third this long at most. */
export const DUCK_MS = 1000

/** What the captions show: the rep's words as Google hears them, then the Assistant's. */
export interface Captions {
  /** The rep's words this exchange. */
  rep: string
  /** A guess at the words being said now, which the next replaces. */
  hearing: string
  /** The Assistant's words, as it says them. */
  assistant: string
}

export const NO_CAPTIONS: Captions = { rep: '', hearing: '', assistant: '' }

/** Pieces of words joined as they come: Google's pieces carry their own spaces. */
function joined(before: string, piece: string): string {
  return (before + piece).replace(/\s+/g, ' ').trimStart()
}

/**
 * The rep's words from one `heard` (TBC at S1: pieces or whole). On the Gemini API they come as
 * pieces to add to the turn's words, and `interim` is a guess that replaces the last guess. Once
 * the Assistant has said something, the rep's next words start a new exchange. Kept in this one
 * place, so S1 can change it.
 */
export function withHeard(captions: Captions, heard: VoiceHeard): Captions {
  const base = captions.assistant === '' ? captions : NO_CAPTIONS
  if (heard.interim) return { ...base, hearing: heard.text.trim() }
  return { ...base, rep: joined(base.rep, heard.text), hearing: '' }
}

/** The Assistant's words, as it says them, after the rep's. */
export function withSaid(captions: Captions, text: string): Captions {
  return { ...captions, assistant: joined(captions.assistant, text) }
}

export type TalkPhase = 'connecting' | 'live' | 'reconnecting' | 'ended'

/** Why a talk ended. */
export type TalkEnd =
  /** The start was refused: 403, 409, 429 or 503, with its plain words. */
  | { kind: 'refused'; problem: ApiProblem }
  /** No sound here, the start didn't answer, or the socket never reached `ready`. */
  | { kind: 'failed' }
  /** The mic couldn't open, or stopped with no other mic, with PLAN-V18's words. */
  | { kind: 'mic'; problem: MicProblem }
  /** The relay ended it: its reason, and the line to show. */
  | { kind: 'ended'; reason: VoiceEndReason; line: string | null }
  /** Our backend didn't come back within 30 seconds. */
  | { kind: 'lost' }
  /** V, Stop, Esc, or the bar gone. */
  | { kind: 'stopped' }

export interface TalkSnapshot {
  phase: TalkPhase
  /** Google was ready at least once: the talk began. */
  ready: boolean
  /** The Assistant's voice is playing: from its first sound until the buffer is empty. */
  speaking: boolean
  /** Tool calls waiting for their answer: "Working it out". */
  working: number
  muted: boolean
  captions: Captions
  /** Each piece of words heard or said, either way: the bar's quiet stop counts from the last. */
  words: number
  /** The mic's sound, for the bars. */
  bars: BarSource | null
  device: MicDevice | null
  /** The mic it moved to by itself, for "Now using {mic}." */
  movedTo: MicDevice | null
  end: TalkEnd | null
}

const STARTING: TalkSnapshot = {
  phase: 'connecting',
  ready: false,
  speaking: false,
  working: 0,
  muted: false,
  captions: NO_CAPTIONS,
  words: 0,
  bars: null,
  device: null,
  movedTo: null,
  end: null,
}

/** A tool call, for Part 3's bridge: Gemini's `request`, and the rep's words since the last. */
export interface ToolCall {
  id: string
  request: string
  /** The rep's own words since the last tool call, as Google heard them so far. */
  heard: string
}

/** A tool answer: the relay's five fields, less its `type`. */
export type ToolAnswer = Omit<VoiceToolAnswer, 'type'>

/** The browser, as a talk uses it. Tests hand in fakes. */
export interface TalkEnv {
  /** The mic, as the mic card uses it: `getUserMedia`, the mic list and this computer's pick. */
  mic: MicEnv
  /** The two audio contexts: the ones made in the tap that opened the bar, else new ones. */
  audio: () => LiveAudio | null
  capture: OpenCapture
  player: OpenPlayer
  /** Starts a talk: its socket's path, or the problem that refused it. */
  begin: (companyKey: string | null, signal: AbortSignal) => Promise<VoiceSessionOut>
  relay: RelayEnv
}

export function browserTalkEnv(): TalkEnv {
  return {
    mic: browserEnv(),
    audio: takeAudio,
    capture: openCapture,
    player: openPlayer,
    begin: startLiveVoice,
    relay: browserRelay(),
  }
}

export interface TalkOptions {
  /** The company on screen, so its names come first in Google's hints. */
  companyKey?: string | null
  onToolCall?: (call: ToolCall) => void
  onToolCancel?: (ids: readonly string[]) => void
  env?: TalkEnv
}

/** What the voice bar's session uses of a talk: a test's fake has the same. */
export interface Talk {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => TalkSnapshot
  start: () => void
  /** Ends it: `stop` to the relay, and everything let go. */
  stop: () => void
  mute: (on: boolean) => void
  /** Answers a tool call, once. */
  answer: (answer: ToolAnswer) => void
  /** The rep's words this exchange, for the text line. */
  text: () => string
}

export type MakeTalk = (options: TalkOptions) => Talk

export const makeTalk: MakeTalk = (options) => new LiveTalk(options)

/** A mic's own sound stopped: it was unplugged, or another mic took its place. */
function micGone(error: unknown): boolean {
  const name = error instanceof Error || error instanceof DOMException ? error.name : ''
  return name === 'OverconstrainedError' || name === 'NotFoundError'
}

/** The mic a track comes from: by its id, else by its name. */
function deviceOf(track: MediaStreamTrack | null, devices: readonly MicDevice[]): MicDevice {
  const id = track?.getSettings().deviceId ?? ''
  const name = micName(track?.label ?? '')
  return (
    devices.find((mic) => mic.id === id) ??
    devices.find((mic) => name !== '' && mic.name === name) ?? { id, name: name || YOUR_MIC }
  )
}

export class LiveTalk implements Talk {
  private readonly env: TalkEnv
  private readonly companyKey: string | null
  private readonly onToolCall: ((call: ToolCall) => void) | null
  private readonly onToolCancel: ((ids: readonly string[]) => void) | null
  private readonly listeners = new Set<() => void>()
  private snapshot: TalkSnapshot = STARTING
  private started = false
  private over = false
  private readonly abort = new AbortController()
  private audio: LiveAudio | null = null
  private stream: MediaStream | null = null
  private track: MediaStreamTrack | null = null
  /** The mic picked on this computer that this talk uses, or null for the computer's default. */
  private picked: string | null = null
  private defaultId: string | null = null
  private watching: MediaDevices | null = null
  private moving = false
  private lookAgain = false
  private soundIn: SoundIn | null = null
  private soundOut: SoundOut | null = null
  private relay: Relay | null = null
  private readonly gate = new Gate()
  /** Tool calls waiting for their answer. */
  private readonly pending = new Set<string>()
  /** The rep's words since the last tool call. */
  private sinceCall = ''
  private duckTimer = 0

  constructor({ companyKey = null, onToolCall, onToolCancel, env }: TalkOptions = {}) {
    this.env = env ?? browserTalkEnv()
    this.companyKey = companyKey
    this.onToolCall = onToolCall ?? null
    this.onToolCancel = onToolCancel ?? null
  }

  // --- For the bar (useSyncExternalStore) --------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = (): TalkSnapshot => this.snapshot

  private set(change: Partial<TalkSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...change }
    for (const listener of this.listeners) listener()
  }

  // --- What the bar asks ---------------------------------------------------------------------------

  /**
   * Starts the talk. The audio contexts are made here, at once: in a key press or a click, an
   * iPhone lets them run (the bar opened by one made them already, `primeAudio`).
   */
  start(): void {
    if (this.started) return
    this.started = true
    this.audio = this.env.audio()
    void this.run()
  }

  stop(): void {
    this.end({ kind: 'stopped' })
  }

  mute(on: boolean): void {
    if (this.over || this.snapshot.muted === on) return
    if (this.track) this.track.enabled = !on
    if (on) {
      const step = this.gate.close()
      if (step.pause) this.relay?.pause()
    }
    this.set({ muted: on })
  }

  answer(answer: ToolAnswer): void {
    if (!this.pending.delete(answer.id)) return
    this.relay?.answer(answer)
    this.set({ working: this.pending.size })
  }

  text(): string {
    const { rep, hearing } = this.snapshot.captions
    return [rep, hearing].filter((part) => part.trim() !== '').join(' ')
  }

  // --- The start ---------------------------------------------------------------------------------

  private async run(): Promise<void> {
    const audio = this.audio
    if (!audio) {
      this.end({ kind: 'failed' })
      return
    }
    // The start, the mic and the Assistant's voice get ready together: the first sound is sooner.
    const starting = this.env.begin(this.companyKey, this.abort.signal).then(
      (session): VoiceSessionOut | TalkEnd => session,
      (error: unknown): TalkEnd => {
        // The server's own answer (403, 409, 429, 503 ...) has its words; no answer has none.
        const problem = toApiProblem(error)
        return problem.status >= 400 ? { kind: 'refused', problem } : { kind: 'failed' }
      },
    )
    const player = this.env
      .player(audio.playback, this.onSpeaking)
      .catch((): SoundOut | null => null)
    const mic = await this.openMic()
    if (this.over) {
      for (const track of typeof mic === 'string' ? [] : mic.getTracks()) track.stop()
      return
    }
    if (typeof mic === 'string') {
      this.end({ kind: 'mic', problem: mic })
      return
    }
    this.useStream(mic)
    void this.nameMic()
    const capture = this.env
      .capture(audio.capture, mic, this.onFrame)
      .catch((): SoundIn | null => null)
    const [started, soundOut, soundIn] = await Promise.all([starting, player, capture])
    if (this.over) return
    this.soundOut = soundOut
    this.soundIn = soundIn
    if (!('socket' in started)) {
      this.end(started)
      return
    }
    if (!soundOut || !soundIn) {
      this.end({ kind: 'failed' })
      return
    }
    this.set({ bars: soundIn.bars })
    this.relay = new Relay(started.socket, this.relayHandlers, this.env.relay)
    this.relay.open()
  }

  /** The mic, as the mic card opens it: the picked one, else the computer's default. */
  private async openMic(): Promise<MediaStream | MicProblem> {
    const { mic } = this.env
    if (!mic.secure()) return 'insecure'
    const media = mic.media()
    if (typeof media?.getUserMedia !== 'function' || typeof media.enumerateDevices !== 'function') {
      return 'old_browser'
    }
    let picked = rememberedMic(mic.storage())
    for (;;) {
      try {
        const stream = await media.getUserMedia({ audio: soundFor(media, picked) })
        this.picked = picked
        return stream
      } catch (error) {
        if (picked && micGone(error)) {
          // The mic picked on this computer is gone: forget it, and use the default one.
          rememberMic(null, mic.storage())
          picked = null
          continue
        }
        return streamProblem(error, await mic.permission())
      }
    }
  }

  private useStream(stream: MediaStream): void {
    for (const old of this.stream?.getTracks() ?? []) {
      old.removeEventListener('ended', this.onEnded)
      old.stop()
    }
    this.stream = stream
    this.track = stream.getAudioTracks()[0] ?? null
    this.track?.addEventListener('ended', this.onEnded)
    if (this.track) this.track.enabled = !this.snapshot.muted
  }

  /** The mic's name, once it is allowed, and the computer's default, to follow it. */
  private async nameMic(): Promise<void> {
    const media = this.env.mic.media()
    if (!media) return
    const listed = await media.enumerateDevices().catch(() => [])
    if (this.over) return
    this.defaultId = defaultMic(listed)?.id ?? null
    this.set({ device: deviceOf(this.track, micsOf(listed)) })
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('devicechange', this.onDeviceChange)
      this.watching = media
    }
  }

  // --- Following the mic (as the mic card does, PLAN-V24 T1-2) -----------------------------------

  private readonly onDeviceChange = (): void => {
    void this.follow()
  }

  private readonly onEnded = (): void => {
    void this.follow()
  }

  /** One look at the mics at a time. A change during one is looked at after it. */
  private async follow(): Promise<void> {
    if (this.moving) {
      this.lookAgain = true
      return
    }
    this.moving = true
    try {
      do {
        this.lookAgain = false
        await this.lookAtMics()
      } while (this.lookAgain && !this.over)
    } finally {
      this.moving = false
    }
  }

  /**
   * A mic picked by hand stays while it is there. Otherwise the computer's default is used: as
   * soon as it changes (a headset plugged in), or when the mic in use goes. With no mic left, the
   * talk ends with the words kept.
   */
  private async lookAtMics(): Promise<void> {
    const media = this.env.mic.media()
    if (!media || !this.stream || this.over) return
    const listed = await media.enumerateDevices().catch(() => null)
    if (this.over || !listed) return
    const live = this.track?.readyState === 'live'
    const devices = micsOf(listed)
    const pickedThere = this.picked !== null && devices.some((mic) => mic.id === this.picked)
    const nowDefault = defaultMic(listed)?.id ?? null
    const stay = this.picked !== null ? pickedThere : nowDefault === this.defaultId
    if (live && stay) return
    if (!hasMic(listed)) {
      if (!live) this.end({ kind: 'mic', problem: 'cut_off' })
      return
    }
    if (this.picked !== null && !pickedThere) {
      rememberMic(null, this.env.mic.storage())
      this.picked = null
    }
    const stream = await media
      .getUserMedia({ audio: soundFor(media, this.picked) })
      .catch(() => null)
    if (this.over) {
      for (const track of stream?.getTracks() ?? []) track.stop()
      return
    }
    if (!stream) {
      if (!live) this.end({ kind: 'mic', problem: 'cut_off' })
      return
    }
    const before = this.snapshot.device
    this.useStream(stream)
    this.soundIn?.swap(stream)
    const named = await media.enumerateDevices().catch(() => listed)
    if (this.over) return
    this.defaultId = defaultMic(named)?.id ?? null
    const device = deviceOf(this.track, micsOf(named))
    this.set({ device, movedTo: device.id === before?.id ? this.snapshot.movedTo : device })
  }

  // --- Sound in and out ----------------------------------------------------------------------------

  /** A 20 ms piece from the mic: through the gate, to the relay once it is ready. */
  private readonly onFrame = (frame: Frame): void => {
    if (this.over || this.snapshot.muted) return
    const relay = this.relay
    if (!relay?.isReady) {
      this.gate.listen(frame)
      return
    }
    const step = this.gate.push(frame)
    for (const pcm of step.send) relay.sendSound(pcm)
    if (step.pause) relay.pause()
    if (step.opened && this.snapshot.speaking) this.duck()
    if (step.closed) this.unduck()
  }

  private readonly onSpeaking = (speaking: boolean): void => {
    if (this.over) return
    this.gate.setStrict(speaking)
    if (!speaking) this.unduck()
    this.set({ speaking })
  }

  /** The rep started over the Assistant: a third, until `interrupted`, or a second at most. */
  private duck(): void {
    window.clearTimeout(this.duckTimer)
    this.soundOut?.duck(true)
    this.duckTimer = window.setTimeout(() => {
      this.unduck()
    }, DUCK_MS)
  }

  private unduck(): void {
    window.clearTimeout(this.duckTimer)
    this.soundOut?.duck(false)
  }

  // --- The relay -----------------------------------------------------------------------------------

  private readonly relayHandlers = {
    ready: (): void => {
      this.set({ phase: 'live', ready: true })
    },
    message: (message: RelayMessage): void => {
      this.onMessage(message)
    },
    sound: (pcm: ArrayBuffer): void => {
      this.soundOut?.push(pcm)
    },
    reconnecting: (): void => {
      this.set({ phase: 'reconnecting' })
    },
    closed: (closed: RelayClosed): void => {
      this.relay = null
      if (closed.kind === 'ended') {
        this.end({ kind: 'ended', reason: closed.ended.reason, line: closed.ended.line })
      } else {
        this.end(closed.kind === 'lost' ? { kind: 'lost' } : { kind: 'failed' })
      }
    },
  }

  private onMessage(message: RelayMessage): void {
    switch (message.type) {
      case 'heard':
        if (!message.interim) this.sinceCall = joined(this.sinceCall, message.text)
        this.set({
          captions: withHeard(this.snapshot.captions, message),
          words: this.snapshot.words + 1,
        })
        return
      case 'said':
        this.set({
          captions: withSaid(this.snapshot.captions, message.text),
          words: this.snapshot.words + 1,
        })
        return
      case 'interrupted':
        // Barge-in: the buffer empties within one 20 ms piece.
        this.soundOut?.flush()
        this.unduck()
        return
      case 'turn_complete':
        this.soundOut?.end()
        return
      case 'tool_call': {
        if (this.pending.has(message.id)) return
        this.pending.add(message.id)
        const heard = this.sinceCall
        this.sinceCall = ''
        this.set({ working: this.pending.size })
        this.onToolCall?.({ id: message.id, request: message.request, heard })
        return
      }
      case 'tool_cancel': {
        const stopped = message.ids.filter((id) => this.pending.delete(id))
        this.set({ working: this.pending.size })
        if (stopped.length > 0) this.onToolCancel?.(stopped)
        return
      }
      case 'reconnecting':
        this.set({ phase: 'reconnecting' })
        return
      case 'reconnected':
        this.set({ phase: 'live' })
        return
    }
  }

  // --- The end -------------------------------------------------------------------------------------

  private end(why: TalkEnd): void {
    if (this.over) return
    this.over = true
    this.abort.abort()
    window.clearTimeout(this.duckTimer)
    this.relay?.stop()
    this.relay = null
    this.soundIn?.close()
    this.soundIn = null
    this.soundOut?.close()
    this.soundOut = null
    this.watching?.removeEventListener('devicechange', this.onDeviceChange)
    this.watching = null
    for (const track of this.stream?.getTracks() ?? []) {
      track.removeEventListener('ended', this.onEnded)
      track.stop()
    }
    this.stream = null
    this.track = null
    if (this.audio) closeAudio(this.audio)
    this.audio = null
    this.pending.clear()
    this.set({ phase: 'ended', end: why, speaking: false, working: 0, bars: null })
  }
}
