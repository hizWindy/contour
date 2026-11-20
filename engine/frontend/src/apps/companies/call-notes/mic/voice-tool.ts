/**
 * The voice tool seam (PLAN-V18 T3-5): the one small shape the mic card uses to turn speech into
 * words, whichever tool does it. The card starts it, stops it, hears the words as they come, and
 * hears its problems. Nothing else of a tool reaches the card.
 *
 * The tools, picked by the `voice_tool` setting (the contract, part 4):
 *
 * - `browser_service`: the browser's own speech service (the Web Speech API, `en-AU`, built here).
 *   The words come live. The browser sends the voice to its maker (Google for Chrome, Microsoft
 *   for Edge), which needs Levi's OK, so it runs only when the setting says so.
 * - `browser_model`: Whisper in the browser. It waits for T3-3 (Al-khair at the keyboard), so it
 *   has no tool here yet: the card checks the mic, shows the bars, and says plainly that turning
 *   speech into words isn't set up yet.
 * - `typing`: no mic at all. The note box has no mic button.
 *
 * Our code never stores or sends the audio. The browser service listens to the mic itself (or to
 * the track the card hands it, where the browser can), and only its words come back here.
 *
 * **On-device mode with name hints** (PLAN-V23 T1-5, choice 2) is built and off: one constant,
 * `ON_DEVICE_HINTS`, turns it on once S1 picks it. Then the tool first asks the browser whether
 * its on-device speech is installed (`SpeechRecognition.available`). Only at `available` does it
 * listen on the laptop (`processLocally`) with the hint list as phrases, so neither the voice nor
 * the names leave the laptop. Anything else, or a browser without phrases, is the server mode with
 * no hints, as before: Chrome refuses phrases in the server mode (`phrases-not-supported`).
 *
 * **No lost words** (PLAN-V24 T1-3, choice 4): when the service ends, by itself or for any other
 * reason, the words it was still hearing are kept as final words, once. A network blip gets a few
 * quiet tries (`NETWORK`) before it is a problem, and `onReconnecting` says so after a second.
 */

import type { VoiceToolKind } from '@/api/types'

export type { VoiceToolKind }

/** What a tool can tell the card went wrong. The card has the words for each. */
// too_slow: the speech model on this device can't keep up with the talk (PLAN-V24 T4-2).
export type VoiceProblem = 'blocked_browser' | 'no_mic' | 'tool_failed' | 'too_slow'

export interface VoiceToolEvents {
  /** The tool is listening: the check's last line ticks. */
  onReady: () => void
  /** A chunk of words that won't change any more. */
  onWords: (chunk: string) => void
  /** The words still being heard, which may change. Empty once they are final. */
  onHearing: (text: string) => void
  /** After `stop`: everything heard is written out. */
  onFinished: () => void
  onProblem: (problem: VoiceProblem) => void
  /**
   * The tool lost its connection and is trying again quietly (PLAN-V24 T1-3): true once that has
   * lasted a second, false once it hears again. Optional: a tool that needs no connection never
   * calls it, and a card that shows nothing for it can leave it out.
   */
  onReconnecting?: (reconnecting: boolean) => void
}

export interface VoiceTool {
  /**
   * Start listening, to this mic's track where the tool can (else to the browser's own mic).
   * `hints`: the names to listen for, used only in on-device mode (PLAN-V23 T1-5).
   */
  start: (track: MediaStreamTrack | null, hints?: readonly string[]) => void
  /** Finish: the last words come, then `onFinished`. */
  stop: () => void
  /** Throw away: nothing more comes. */
  abort: () => void
}

export type VoiceToolMaker = (events: VoiceToolEvents) => VoiceTool

// --- The browser's own speech service (Web Speech) ----------------------------------------------

/** The parts of the Web Speech API used here (TypeScript's DOM types don't have it yet). */
interface SpeechAlternative {
  transcript: string
}
interface SpeechResult {
  readonly isFinal: boolean
  readonly length: number
  [index: number]: SpeechAlternative | undefined
}
interface SpeechResultEvent {
  readonly resultIndex: number
  readonly results: { readonly length: number; [index: number]: SpeechResult | undefined }
}
interface SpeechErrorEvent {
  readonly error: string
}
export interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  /** On-device mode (newer Chrome): the speech is turned into words on the laptop. */
  processLocally?: boolean
  /** The names to listen for, as `SpeechRecognitionPhrase`s: on-device mode only (Chrome). */
  phrases?: unknown[]
  onstart: (() => void) | null
  onresult: ((event: SpeechResultEvent) => void) | null
  onerror: ((event: SpeechErrorEvent) => void) | null
  onend: (() => void) | null
  start: (track?: MediaStreamTrack) => void
  stop: () => void
  abort: () => void
}

/** What `SpeechRecognition.available` answers for a language. */
export type OnDeviceState = 'unavailable' | 'downloadable' | 'downloading' | 'available'

export interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionLike
  /** Whether on-device speech is installed for these languages (newer Chrome only). */
  available?: (options: { langs: string[]; processLocally: boolean }) => Promise<OnDeviceState>
}

/** A hint for the service: a name and how much to favour it, 0 to 10. */
export type SpeechPhraseConstructor = new (phrase: string, boost: number) => unknown

/** The browser's speech recogniser, or null where there is none (Firefox, an old browser). */
export function speechRecognition(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null
  const found = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
  return found.SpeechRecognition ?? found.webkitSpeechRecognition ?? null
}

/** The browser's hint maker, or null where it has none (every browser but a newer Chrome). */
export function speechPhrase(): SpeechPhraseConstructor | null {
  if (typeof window === 'undefined') return null
  const found = window as unknown as { SpeechRecognitionPhrase?: SpeechPhraseConstructor }
  return typeof found.SpeechRecognitionPhrase === 'function' ? found.SpeechRecognitionPhrase : null
}

/** The language the service listens for: Australian English. */
export const SPEECH_LANG = 'en-AU'

/**
 * On-device mode with the hint list (PLAN-V23 T1-5, choice 2): off until S1, Al-khair's test at
 * the keyboard, picks it (TBC). Chrome has no Australian on-device model: it uses its US English
 * one for any English.
 */
export const ON_DEVICE_HINTS = false

/** How much each hint is favoured, from 0 to 10 (TBC after S1). */
export const HINT_BOOST = 2

/** The most hints the service is given: the hint list's own most (choice 1, TBC after S1). */
const MOST_HINTS = 200

export interface BrowserServiceOptions {
  /** On-device mode with hints. Default: `ON_DEVICE_HINTS`. */
  onDevice?: boolean
}

/** After `stop`, the last words get this long before the tool says it is finished anyway. */
const FINISH_WAIT_MS = 4000

/**
 * A network blip (PLAN-V24 choice 4; every number TBC until S1): the service is tried again
 * quietly, after a short wait each time, and "Reconnecting" shows once the blip has lasted a
 * second. A fourth network error inside 10 seconds is the problem, with the words kept. Words
 * coming again end the blip; a try that listens 2 seconds with no error ends "Reconnecting".
 */
export const NETWORK = {
  /** Quiet tries before a network error is a problem. */
  tries: 3,
  /** The errors count over this long. */
  windowMs: 10_000,
  /** The wait before the first, second and third try, so the blip can pass. */
  waitsMs: [500, 1500, 3000],
  /** "Reconnecting" shows once the blip has lasted this long. */
  reconnectingAfterMs: 1000,
  /** A try that listens this long with no new error has its connection back. */
  steadyMs: 2000,
} as const

/** The service's errors, as the card's problems. Silence and our own stop are not problems. */
function problemOf(error: string): VoiceProblem | null {
  switch (error) {
    case 'not-allowed':
      return 'blocked_browser'
    case 'audio-capture':
      return 'no_mic'
    case 'no-speech':
    case 'aborted':
      return null
    default:
      // network, service-not-allowed, language-not-supported, and anything new.
      return 'tool_failed'
  }
}

/**
 * The browser service as a voice tool. It listens until it is stopped: the service ends by itself
 * after a silence or a minute, so it starts again then, until `stop` or a problem. Words it was
 * still hearing as it ended are kept, once, and a network blip is tried again quietly (T1-3).
 *
 * In on-device mode (`onDevice`, off by default) with hints, it asks `available` first, and
 * listens on the laptop with the hints only at `available`. If the on-device service fails before
 * it listens, it starts again once in the server mode, with no hints.
 */
export function browserService(
  events: VoiceToolEvents,
  { onDevice = ON_DEVICE_HINTS }: BrowserServiceOptions = {},
): VoiceTool {
  const Recognition = speechRecognition()
  let recognition: SpeechRecognitionLike | null = null
  let track: MediaStreamTrack | null = null
  let ready = false
  let stopping = false
  let over = false
  let waiting = 0
  /** Listening on the laptop, with the hints. */
  let local = false
  /** The words still being heard, as last given: kept if the service ends before they are final. */
  let heard = ''
  /** When each network error of this blip came (the clock's ms). Words coming again clear it. */
  let blip: number[] = []
  /** The wait before the service starts again, after a network error. */
  let pause = 0
  let retryTimer = 0
  let reconnectTimer = 0
  let steadyTimer = 0
  let reconnecting = false

  const clearTimers = (): void => {
    for (const timer of [waiting, retryTimer, reconnectTimer, steadyTimer]) {
      window.clearTimeout(timer)
    }
    retryTimer = 0
    reconnectTimer = 0
    steadyTimer = 0
  }

  /** Words still being heard become final, once: the service ended before it wrote them out. */
  const keepHeard = (): void => {
    if (heard === '') return
    const words = heard
    heard = ''
    events.onWords(words)
    events.onHearing('')
  }

  const setReconnecting = (on: boolean): void => {
    if (reconnecting === on) return
    reconnecting = on
    events.onReconnecting?.(on)
  }

  /** The connection works again: "Reconnecting" goes. With `heardAgain`, the blip is over. */
  const reconnected = (heardAgain: boolean): void => {
    window.clearTimeout(reconnectTimer)
    window.clearTimeout(steadyTimer)
    reconnectTimer = 0
    steadyTimer = 0
    if (heardAgain) blip = []
    setReconnecting(false)
  }

  /** A network error: true when it gets a quiet try, false once the blip has had its tries. */
  const quietTry = (): boolean => {
    const now = Date.now()
    blip = [...blip.filter((at) => now - at < NETWORK.windowMs), now]
    if (blip.length > NETWORK.tries) return false
    pause = NETWORK.waitsMs[blip.length - 1] ?? NETWORK.waitsMs[NETWORK.waitsMs.length - 1]
    window.clearTimeout(steadyTimer)
    steadyTimer = 0
    if (!reconnecting && reconnectTimer === 0) {
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = 0
        if (!over) setReconnecting(true)
      }, NETWORK.reconnectingAfterMs)
    }
    return true
  }

  /** The hints as the service's phrases, or null where on-device mode can't take them. */
  const phrasesOf = (hints: readonly string[]): unknown[] | null => {
    const Phrase = speechPhrase()
    const texts = [...new Set(hints.map((hint) => hint.trim()).filter(Boolean))]
    if (!Phrase || texts.length === 0) return null
    try {
      return texts.slice(0, MOST_HINTS).map((text) => new Phrase(text, HINT_BOOST))
    } catch {
      return null
    }
  }

  /** Back to the server mode, with no hints. */
  const leaveDevice = (): void => {
    local = false
    if (!recognition) return
    try {
      recognition.processLocally = false
      recognition.phrases = []
    } catch {
      // An older browser has neither: it was never on the laptop.
    }
  }

  const finish = (): void => {
    if (over) return
    over = true
    clearTimers()
    // Words still being heard stay with the card: the service makes them final first if it can,
    // and they are made final here if it didn't.
    keepHeard()
    events.onFinished()
  }

  const fail = (problem: VoiceProblem): void => {
    if (over) return
    over = true
    clearTimers()
    // The words so far stay, those still being heard too.
    keepHeard()
    recognition?.abort()
    events.onProblem(problem)
  }

  const begin = (): void => {
    if (!recognition) return
    try {
      // The newer API listens to the card's own mic track. An older browser ignores it and uses
      // its own default mic; one that refuses the track starts without it.
      if (track) recognition.start(track)
      else recognition.start()
    } catch {
      try {
        track = null
        recognition.start()
      } catch {
        fail('tool_failed')
      }
    }
  }

  /** On-device mode, when it is on, the browser has it installed, and there are hints. */
  const startOnDevice = (made: SpeechRecognitionLike, hints: readonly string[]): boolean => {
    const phrases = onDevice ? phrasesOf(hints) : null
    if (!phrases || typeof Recognition?.available !== 'function') return false
    let asked: Promise<OnDeviceState>
    try {
      asked = Promise.resolve(Recognition.available({ langs: [SPEECH_LANG], processLocally: true }))
    } catch {
      return false
    }
    asked.then(
      (state) => {
        if (over || recognition !== made) return
        if (state === 'available') {
          try {
            made.processLocally = true
            made.phrases = phrases
            local = true
          } catch {
            leaveDevice()
          }
        }
        begin()
      },
      () => {
        if (!over && recognition === made) begin()
      },
    )
    return true
  }

  return {
    start(next, hints = []) {
      if (!Recognition) {
        fail('tool_failed')
        return
      }
      track = next
      try {
        recognition = new Recognition()
      } catch {
        fail('tool_failed')
        return
      }
      recognition.lang = SPEECH_LANG
      recognition.continuous = true
      recognition.interimResults = true
      recognition.maxAlternatives = 1
      recognition.onstart = () => {
        if (over) return
        if (blip.length > 0) {
          // A try listens: once it has listened a while with no new error, it is connected.
          window.clearTimeout(steadyTimer)
          steadyTimer = window.setTimeout(() => {
            steadyTimer = 0
            if (!over) reconnected(false)
          }, NETWORK.steadyMs)
        }
        if (ready) return
        ready = true
        events.onReady()
      }
      recognition.onresult = (event) => {
        if (over) return
        let hearing = ''
        let any = false
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index]
          const text = result?.[0]?.transcript.trim() ?? ''
          if (!result || text === '') continue
          any = true
          if (result.isFinal) events.onWords(text)
          else hearing = hearing ? `${hearing} ${text}` : text
        }
        heard = hearing
        events.onHearing(hearing)
        // Words came: the connection works.
        if (any && (blip.length > 0 || reconnecting)) reconnected(true)
      }
      recognition.onerror = (event) => {
        if (over) return
        if (local && !ready) {
          // The laptop's own speech failed before it listened (like `phrases-not-supported`):
          // the server mode, with no hints. The service's end that follows starts it again.
          leaveDevice()
          return
        }
        if (event.error === 'network') {
          // After Done there is nothing to try again for: the words so far are all there is.
          if (stopping) {
            finish()
            return
          }
          // A blip: the service's end that follows starts it again, after a short wait.
          if (quietTry()) return
        }
        const problem = problemOf(event.error)
        if (problem) fail(problem)
      }
      recognition.onend = () => {
        if (over) return
        // Words it was still hearing as it ended are kept, once.
        keepHeard()
        if (stopping) {
          finish()
          return
        }
        if (pause > 0) {
          // After a network error: a quiet try, once the wait is over.
          const wait = pause
          pause = 0
          retryTimer = window.setTimeout(() => {
            retryTimer = 0
            if (!over && !stopping) begin()
          }, wait)
          return
        }
        // It ended by itself (a silence, or its own time limit): listen on.
        begin()
      }
      if (!startOnDevice(recognition, hints)) begin()
    },
    stop() {
      if (over || stopping) return
      stopping = true
      if (retryTimer !== 0) {
        // A quiet try is waiting, so nothing listens: the words so far are all there is.
        finish()
        return
      }
      waiting = window.setTimeout(finish, FINISH_WAIT_MS)
      try {
        recognition?.stop()
      } catch {
        finish()
      }
    },
    abort() {
      if (over) return
      over = true
      clearTimers()
      try {
        recognition?.abort()
      } catch {
        // Nothing to let go of.
      }
    },
  }
}

/** The tool for the setting, or null where there is none to run (`browser_model` and `typing`). */
export function voiceToolFor(kind: VoiceToolKind): VoiceToolMaker | null {
  return kind === 'browser_service' ? browserService : null
}
