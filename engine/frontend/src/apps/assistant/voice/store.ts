/**
 * Whether the voice bar is open (PLAN-V22 T3-1). The V key, the top bar's "Speak (V)" button and
 * the bar itself share it: one small store in the page, like the mic check's (`check-store.ts`).
 * It is in the first visit, so it holds one flag and nothing else.
 */
import { useSyncExternalStore } from 'react'

let open = false
const listeners = new Set<() => void>()

function tell(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Opens the bar. Pressed again while it is open, nothing more happens. */
export function openVoiceBar(): void {
  if (open) return
  open = true
  tell()
}

export function closeVoiceBar(): void {
  if (!open) return
  open = false
  tell()
}

export function isVoiceBarOpen(): boolean {
  return open
}

export function useVoiceBarOpen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => open,
    () => false,
  )
}
