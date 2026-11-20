/**
 * The screen while a conversation listens (PLAN-V24 choices 15 and 16, T2-5). Plain code with the
 * browser handed in, so the tests use a fake.
 *
 * - **The wake lock** keeps a phone's screen on, so it doesn't lock and stop the mic (TBC on an
 *   iPhone). It is asked for as a conversation starts, and let go at every end. A browser that
 *   refuses it, or has none, changes nothing else.
 * - **A hidden page:** on a phone (a finger is its pointer), leaving the app or locking it stops
 *   the mic, so the conversation ends there, with the words kept. On a laptop, another window in
 *   front doesn't end it (TBC at S1). The browser lets a wake lock go with a hidden page, so it is
 *   asked for again when the page comes back.
 */

/** A wake lock the browser gave. */
export interface KeptOn {
  release: () => Promise<void>
}

export interface ScreenEnv {
  /** Asks the browser to keep the screen on. Null where it can't, or won't. */
  keepOn: () => Promise<KeptOn | null>
  /** The page is hidden: another app in front, or the phone locked. */
  hidden: () => boolean
  /** Hears the page being hidden or shown. The returned function stops listening. */
  onVisibility: (listener: () => void) => () => void
  /** A phone or a tablet: one whose pointer is a finger. */
  phone: () => boolean
}

/** The Screen Wake Lock API, which older TypeScript and some browsers don't have. */
interface WithWakeLock {
  wakeLock?: { request: (type: 'screen') => Promise<KeptOn> }
}

export function browserScreen(): ScreenEnv {
  return {
    keepOn: async () => {
      try {
        const lock = (navigator as Navigator & WithWakeLock).wakeLock
        return lock ? await lock.request('screen') : null
      } catch {
        // Refused: a battery saver, or the page not in front. Nothing else changes.
        return null
      }
    },
    hidden: () => document.visibilityState === 'hidden',
    onVisibility: (listener) => {
      document.addEventListener('visibilitychange', listener)
      return () => {
        document.removeEventListener('visibilitychange', listener)
      }
    },
    phone: () => {
      try {
        return window.matchMedia('(pointer: coarse)').matches
      } catch {
        return false
      }
    },
  }
}
