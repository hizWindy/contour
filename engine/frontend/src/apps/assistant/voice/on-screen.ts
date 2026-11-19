/**
 * What a page says is on screen for the voice bar, beyond its address (PLAN-V22 choice 8): Today's
 * active row. Press V on a row, name no company, and the command uses that row's company, and the
 * name fix knows its name. The bar reads it once, as it opens; the address (`on-page.ts`) is the
 * fallback.
 *
 * Plain module state, not React's: the bar only reads it at the moment it opens. Today and the bar
 * both load late, so this never reaches the first visit.
 */
import type { AssistantOnPage } from '@/api/types'

export interface OnScreen {
  onPage: AssistantOnPage
  /** The names on screen, for the name fix: the row's company. */
  names: readonly string[]
}

let shown: OnScreen | null = null

/** A page says what is on screen now, or null when nothing is. */
export function showOnScreen(next: OnScreen | null): void {
  shown = next
}

export function onScreen(): OnScreen | null {
  return shown
}
