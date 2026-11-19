/**
 * "Use V to speak" (PLAN-V23 T4-1): the V key can be switched off, as WCAG 2.2 rule 2.1.4 asks of
 * a one-letter shortcut. Off, V does nothing anywhere (it doesn't open the voice bar, end a talk or
 * speak a change on the review card), and the Speak buttons still work.
 *
 * Kept in this browser, on by default. Every read and write is in try/catch: storage that is
 * blocked (a private window) or holds junk counts as on, and a change still holds for this visit.
 * In the first visit, with the key listener, so it stays small.
 */
import { useSyncExternalStore } from 'react'

const KEY = 'assistant.v-key'
const OFF = 'off'

/** This visit's choice, when storage couldn't keep it. */
let chosen: boolean | null = null
const listeners = new Set<() => void>()

/** On unless this browser keeps "off". */
export function isVKeyOn(): boolean {
  if (chosen !== null) return chosen
  try {
    return window.localStorage.getItem(KEY) !== OFF
  } catch {
    return true
  }
}

export function setVKeyOn(on: boolean): void {
  try {
    if (on) window.localStorage.removeItem(KEY)
    else window.localStorage.setItem(KEY, OFF)
    chosen = null
  } catch {
    // Storage is blocked or full: the choice holds for this visit.
    chosen = on
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  // Another tab of this browser changed it.
  window.addEventListener('storage', listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', listener)
  }
}

export function useVKeyOn(): boolean {
  return useSyncExternalStore(subscribe, isVKeyOn, () => true)
}
