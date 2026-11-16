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
 */

import type { VoiceToolKind } from '@/api/hooks/call-note-counts'

export type { VoiceToolKind }

/** What a tool can tell the card went wrong. The card has the words for each. */
export type VoiceProblem = 'blocked_browser' | 'no_mic' | 'tool_failed'

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
}

export interface VoiceTool {
  /** Start listening, to this mic's track where the tool can (else to the browser's own mic). */
  start: (track: MediaStreamTrack | null) => void
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
  onstart: (() => void) | null
  onresult: ((event: SpeechResultEvent) => void) | null
  onerror: ((event: SpeechErrorEvent) => void) | null
  onend: (() => void) | null
  start: (track?: MediaStreamTrack) => void
  stop: () => void
  abort: () => void
}
export type SpeechRecognitionConstructor = new () => SpeechRecognitionLike

/** The browser's speech recogniser, or null where there is none (Firefox, an old browser). */
export function speechRecognition(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null
  const found = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
  return found.SpeechRecognition ?? found.webkitSpeechRecognition ?? null
}

/** The language the service listens for: Australian English. */
export const SPEECH_LANG = 'en-AU'

/** After `stop`, the last words get this long before the tool says it is finished anyway. */
const FINISH_WAIT_MS = 4000

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
 * after a silence or a minute, so it starts again then, until `stop` or a problem.
 */
export function browserService(events: VoiceToolEvents): VoiceTool {
  const Recognition = speechRecognition()
  let recognition: SpeechRecognitionLike | null = null
  let track: MediaStreamTrack | null = null
  let ready = false
  let stopping = false
  let over = false
  let waiting = 0

  const finish = (): void => {
    if (over) return
    over = true
    window.clearTimeout(waiting)
    // Words still being heard stay with the card: the service makes them final first, if it can.
    events.onFinished()
  }

  const fail = (problem: VoiceProblem): void => {
    if (over) return
    over = true
    window.clearTimeout(waiting)
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

  return {
    start(next) {
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
        if (ready || over) return
        ready = true
        events.onReady()
      }
      recognition.onresult = (event) => {
        if (over) return
        let hearing = ''
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index]
          const text = result?.[0]?.transcript.trim() ?? ''
          if (!result || text === '') continue
          if (result.isFinal) events.onWords(text)
          else hearing = hearing ? `${hearing} ${text}` : text
        }
        events.onHearing(hearing)
      }
      recognition.onerror = (event) => {
        const problem = problemOf(event.error)
        if (problem) fail(problem)
      }
      recognition.onend = () => {
        if (over) return
        if (stopping) {
          finish()
          return
        }
        // It ended by itself (a silence, or its own time limit): listen on.
        begin()
      }
      begin()
    },
    stop() {
      if (over || stopping) return
      stopping = true
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
      window.clearTimeout(waiting)
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
