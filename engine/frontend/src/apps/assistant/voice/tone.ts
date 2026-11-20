/**
 * A soft tone as the Assistant starts listening and as it stops (PLAN-V24 T5-1, choice 30; TBC at
 * Al-khair's look). It is made in code with the Web Audio API, not a sound file: two short sine
 * notes, rising as listening starts and falling as it stops, quiet, and under a fifth of a second
 * in all. The bar and the pill show the same thing either way: the tone only adds to the screen.
 *
 * - **Only after a user's gesture.** The page must have had a key, a click or a tap (the browser's
 *   own `userActivation`), and the browser must let the sound play. A context it keeps waiting for
 *   a gesture plays nothing, rather than a tone that comes late.
 * - **One audio context for the page,** made at the first tone and never before. The mic's own
 *   context closes with the mic, so it can't carry the tone as listening stops.
 * - The session calls it (`bar-session.ts`, its `tone` option). Tests hand in a fake sound
 *   (`makeTone`), or a fake tone.
 */

export type ToneKind = 'start' | 'stop'

/** Plays the tone for listening starting or stopping. */
export type Tone = (kind: ToneKind) => void

/** The notes, in Hz, in the order they sound: up a fifth to start, down a fifth to stop (TBC). */
export const TONE_NOTES: Readonly<Record<ToneKind, readonly number[]>> = {
  start: [587.33, 880],
  stop: [880, 587.33],
}

/**
 * The shape of each note, in seconds, and how loud it gets, from 0 to 1 (TBC). Each note rises in
 * 10ms and fades over the rest of its 90ms, and the second starts 70ms after the first: 160ms in
 * all. A peak of 0.05 is about 26 dB under full volume.
 */
export const TONE = {
  note: 0.09,
  step: 0.07,
  rise: 0.01,
  peak: 0.05,
} as const

/** Longer than this for the browser to let the sound play, and the tone is skipped. */
const LATE_MS = 250

/** Silence, for the fades: the curve can't reach 0 itself. */
const SILENT = 0.0001

/** What the tone needs of the browser. Tests give a fake one. */
export interface ToneAudio {
  /** The page has had a user's gesture: a key, a click or a tap. */
  activated: () => boolean
  /** The page's one audio context, made the first time it is asked for. Null: no Web Audio. */
  context: () => AudioContext | null
  now: () => number
}

/** The two notes, from the context's own clock. Each node lets go once its note has played. */
function sound(context: AudioContext, notes: readonly number[]): void {
  const first = context.currentTime + 0.005
  notes.forEach((hz, index) => {
    const at = first + index * TONE.step
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(hz, at)
    gain.gain.setValueAtTime(SILENT, at)
    gain.gain.exponentialRampToValueAtTime(TONE.peak, at + TONE.rise)
    gain.gain.exponentialRampToValueAtTime(SILENT, at + TONE.note)
    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.onended = () => {
      oscillator.disconnect()
      gain.disconnect()
    }
    oscillator.start(at)
    oscillator.stop(at + TONE.note + 0.01)
  })
}

/** The tone, through the browser given. Nothing it does can fail the listening. */
export function makeTone(audio: ToneAudio): Tone {
  return (kind) => {
    try {
      if (!audio.activated()) return
      const context = audio.context()
      if (!context) return
      if (context.state === 'running') {
        sound(context, TONE_NOTES[kind])
        return
      }
      // The browser keeps a new context waiting until a gesture lets it run. It may run now.
      const asked = audio.now()
      context.resume().then(
        () => {
          if (context.state === 'running' && audio.now() - asked <= LATE_MS) {
            sound(context, TONE_NOTES[kind])
          }
        },
        () => undefined,
      )
    } catch {
      // No sound is no harm: the bar and the pill say the same thing.
    }
  }
}

let shared: AudioContext | null = null

/** This browser. */
const BROWSER: ToneAudio = {
  // A browser without `userActivation` still keeps a context waiting until a gesture.
  activated: () =>
    typeof navigator !== 'undefined' &&
    (navigator as { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive !==
      false,
  context: () => {
    if (shared) return shared
    if (typeof AudioContext !== 'function') return null
    try {
      shared = new AudioContext()
    } catch {
      return null
    }
    return shared
  },
  now: () => Date.now(),
}

/** The tone in this browser. */
export const playTone: Tone = makeTone(BROWSER)
