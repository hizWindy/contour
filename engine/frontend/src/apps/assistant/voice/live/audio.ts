/**
 * Live voice's two audio contexts (PLAN-V28 T2-1, T2-2):
 *
 * - **The mic's tap** runs at the device's own rate (44.1 or 48 kHz): asking for 16 kHz there
 *   fails in Firefox, so the capture worklet changes the rate itself.
 * - **The Assistant's voice** plays on a context at 24 kHz, Gemini's own rate, where the browser
 *   allows it: the browser then changes the rate for the speakers. A browser that refuses gets
 *   one at its own rate, and the playback worklet changes the rate.
 *
 * **On an iPhone, sound starts only inside the tap or key press that asked for it** (Safari's
 * rule). So both are made inside the V key press or the Speak tap that opens the bar
 * (`primeAudio`, through `whenBarOpens` in the bar's store, only for a person with live voice),
 * and the talk takes them (`takeAudio`). V or Start again with the bar open starts the talk inside
 * its own key press or click, so the talk makes them there. Contexts made in a tap and not taken
 * within 10 seconds are let go.
 */

export interface LiveAudio {
  capture: AudioContext
  playback: AudioContext
}

/** Gemini's own rate. */
const PLAYBACK_RATE = 24_000
/** Contexts made in a tap are kept this long for the talk. */
const KEPT_MS = 10_000

let primed: { audio: LiveAudio; timer: number } | null = null

function context(options: AudioContextOptions): AudioContext | null {
  try {
    return new AudioContext(options)
  } catch {
    return null
  }
}

export function closeAudio(audio: LiveAudio): void {
  void audio.capture.close().catch(() => undefined)
  void audio.playback.close().catch(() => undefined)
}

/** Makes both contexts now and asks each to run: inside a tap or key press, they may. */
export function makeAudio(): LiveAudio | null {
  if (typeof AudioContext !== 'function') return null
  const capture = context({ latencyHint: 'interactive' })
  if (!capture) return null
  const playback =
    context({ sampleRate: PLAYBACK_RATE, latencyHint: 'interactive' }) ??
    context({ latencyHint: 'interactive' })
  if (!playback) {
    void capture.close().catch(() => undefined)
    return null
  }
  for (const one of [capture, playback]) {
    if (one.state === 'suspended') void one.resume().catch(() => undefined)
  }
  return { capture, playback }
}

function letGo(): void {
  if (!primed) return
  window.clearTimeout(primed.timer)
  closeAudio(primed.audio)
  primed = null
}

/** Inside the tap or key press that opens the bar: both contexts, ready for the talk. */
export function primeAudio(): void {
  letGo()
  const audio = makeAudio()
  if (!audio) return
  primed = { audio, timer: window.setTimeout(letGo, KEPT_MS) }
}

/** The contexts made in the tap, if there are some still; else new ones, made now. */
export function takeAudio(): LiveAudio | null {
  if (primed) {
    const { audio, timer } = primed
    window.clearTimeout(timer)
    primed = null
    return audio
  }
  return makeAudio()
}
