/**
 * "Keep listening" (PLAN-V24 choice 6, T2-5): one V, or Speak, starts a conversation that listens
 * across commands until it is stopped. Off, it is one command per V, as before PLAN-V24. On by
 * default, for everyone with the mic, as Levi asked (20 Nov).
 *
 * Kept in this browser, like "Use V to speak" (`v-switch.ts`): storage that is blocked (a private
 * window) or holds junk counts as on, and a change still holds for this visit. Only the voice bar
 * and the account menu's row read it, and both load late, so it is never in the first visit.
 */
import { useSyncExternalStore } from 'react'

const KEY = 'assistant.keep-listening'
const OFF = 'off'

/** This visit's choice, when storage couldn't keep it. */
let chosen: boolean | null = null
const listeners = new Set<() => void>()

/** On unless this browser keeps "off". */
export function isKeepListeningOn(): boolean {
  if (chosen !== null) return chosen
  try {
    return window.localStorage.getItem(KEY) !== OFF
  } catch {
    return true
  }
}

export function setKeepListening(on: boolean): void {
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

export function useKeepListening(): boolean {
  return useSyncExternalStore(subscribe, isKeepListeningOn, () => true)
}
