/**
 * Whether the voice bar is open (PLAN-V22 T3-1). The V key, the top bar's "Speak (V)" button and
 * the bar itself share it: one small store in the page, like the mic check's (`check-store.ts`).
 * It is in the first visit, so it holds two flags and nothing else.
 *
 * The bar's code also holds the review card, so a card opened from a button or Ctrl+K before any V
 * (PLAN-V23 T4-3: "Add task", "Email the team") asks for that code here (`wantVoiceCode`).
 *
 * Hold V (PLAN-V23 choice 6): the V that opened the bar is marked down until it comes up, so the
 * bar, whose code may load after the key went down, knows whether it is still held.
 */
import { useSyncExternalStore } from 'react'

let open = false
let wanted = false
let held = false
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
  held = false
  tell()
}

/** V opened the bar, and is still down. */
export function openVoiceBarByKey(): void {
  if (open) return
  open = true
  held = true
  tell()
}

export function closeVoiceBar(): void {
  if (!open) return
  open = false
  held = false
  tell()
}

export function isVoiceBarOpen(): boolean {
  return open
}

/** The V that opened the bar came up (or the window lost the keys). */
export function letGoV(): void {
  held = false
}

/** True while the V that opened the bar is still down. */
export function isVHeld(): boolean {
  return held
}

export function useVoiceBarOpen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => open,
    () => false,
  )
}

/** The bar's code is wanted now, for the review card it holds, with the bar still closed. */
export function wantVoiceCode(): void {
  if (wanted) return
  wanted = true
  tell()
}

export function useVoiceCodeWanted(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => wanted,
    () => false,
  )
}
