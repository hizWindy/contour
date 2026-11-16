/**
 * Whether "Check my mic" is open (PLAN-V18 T3-4). Ctrl+K and the account menu open it, and the
 * frame's part shows the mic card in check only mode (`call-note-links.tsx`). One small store in
 * the page, shared by the three: they load together, in one late file.
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

export function openMicCheck(): void {
  open = true
  tell()
}

export function closeMicCheck(): void {
  open = false
  tell()
}

export function useMicCheckOpen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => open,
    () => false,
  )
}
