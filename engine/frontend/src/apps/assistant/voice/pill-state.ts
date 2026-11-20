/**
 * What the Listening pill says (PLAN-V24 T5-1), apart from how it looks (`pill.tsx`): the state the
 * voice bar hands the open review card, and the rule that says each line once to a screen reader.
 */
import { useEffect, useState } from 'react'
import type { BarSnapshot } from './bar-session'

/** The bar's buttons once it stopped, as the bar names them. */
export type PillActionId = 'try_again' | 'type_instead' | 'carry_on' | 'say_again' | 'start_again'

export interface PillAction {
  id: PillActionId
  label: string
}

/** What the voice bar hands the open review card: the bar, shrunk to a pill. */
export interface PillState {
  /** The bar's session: the bars, the words, the conversation's line, the mic's own lines. */
  snapshot: BarSnapshot
  /** Where it stands, as the bar's title says it. */
  title: string
  /** Why it stopped listening, once it did: the quiet stop, or a problem, in the bar's words. */
  stopped: { line: string; quiet: boolean } | null
  /** The bar's buttons for where it stands, the main one first. */
  actions: readonly PillAction[]
  act: (id: PillActionId) => void
  /** Stop, or V: the turn in progress goes, then it stops listening. */
  stop: () => void
}

/** The mic is on: opening, getting the model ready, or listening. */
export function micIsOn(snapshot: BarSnapshot): boolean {
  return snapshot.phase === 'starting' || snapshot.phase === 'listening'
}

/** The conversation's last line, like a read-back, while no turn is being worked out. */
export function lineOf(snapshot: BarSnapshot): string | null {
  const { conversation } = snapshot
  return conversation?.working ? null : (conversation?.line ?? null)
}

/** The lines said already, by the thing they are about: the mic a conversation moved to. */
const said = new WeakSet<object>()

/**
 * True when this part says the line about `about` to a screen reader (choice 31): the first part
 * to show it says it, and a part that shows it after that, like the bar coming back after a card,
 * only shows it. A part says one thing in its life: give it a `key` of what it is about.
 */
export function useSaidOnce(about: object): boolean {
  const [before] = useState(() => said.has(about))
  useEffect(() => {
    said.add(about)
  }, [about])
  return !before
}
