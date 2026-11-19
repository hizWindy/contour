/**
 * Which review card is open (PLAN-V22 T3-3). The voice bar's hand-over opens one for a command,
 * and Undo or a kept draft opens one again. One small store in the page, like the bar's own
 * (`voice/store.ts`): it loads with the bar, and the card's code loads only when a card opens.
 */
import { useSyncExternalStore } from 'react'
import type { AssistantCommand, CommandSource } from '@/api/types'
import type { CardDraft } from './draft'

export type CardRequest =
  /** A command, just read: the card makes its draft. */
  | { id: number; kind: 'command'; command: AssistantCommand; words: string; source: CommandSource }
  /** A draft again: after Undo, or one kept in this browser. */
  | { id: number; kind: 'draft'; draft: CardDraft }
  /**
   * The AI that reads commands is off (choice 17): the words go in a new call note, and Log call
   * opens for the rep to pick the company (T3-5).
   */
  | { id: number; kind: 'dictation'; words: string; source: CommandSource }

type Opening =
  | Omit<Extract<CardRequest, { kind: 'command' }>, 'id'>
  | Omit<Extract<CardRequest, { kind: 'draft' }>, 'id'>
  | Omit<Extract<CardRequest, { kind: 'dictation' }>, 'id'>

let current: CardRequest | null = null
let opened = 0
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

/** Opens the card. A card already open gives way to the new one. */
export function openCard(opening: Opening): void {
  opened += 1
  current = { ...opening, id: opened }
  tell()
}

export function closeCard(): void {
  if (current === null) return
  current = null
  tell()
}

export function openedCard(): CardRequest | null {
  return current
}

export function useOpenCard(): CardRequest | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  )
}
