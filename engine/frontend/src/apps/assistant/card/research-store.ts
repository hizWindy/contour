/**
 * The researches running in the background (PLAN-V27 T4-2, choice 19). The research card adds one
 * as its run starts and closes at once, so the Assistant takes the next command: nothing here holds
 * the voice bar or the page. The progress (`research-tray.tsx`) follows each run's events.
 *
 * One small store in the page, like the card's own (`store.ts`): it lives as long as the page, so a
 * research keeps showing as the rep moves between pages. A reload forgets it; the run itself goes
 * on, and it is on the Runs page.
 *
 * `said` holds the one line a screen reader hears from the progress's live region: as a research
 * starts, and as it ends. Never each finding, so it is no flood.
 */
import { useSyncExternalStore } from 'react'

export interface Research {
  /** This browser's own number for it. */
  id: number
  runId: string
  /** The company as the card showed it. */
  name: string
}

let researches: readonly Research[] = []
let said = ''
let made = 0
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

/** A research started: it shows at the end of the list, so none moves while it is read. */
export function addResearch(runId: string, name: string): void {
  if (researches.some((research) => research.runId === runId)) return
  made += 1
  researches = [...researches, { id: made, runId, name }]
  tell()
}

/** Hidden by the rep. The run goes on. */
export function hideResearch(id: number): void {
  researches = researches.filter((research) => research.id !== id)
  tell()
}

/** The line the live region says next. */
export function sayResearch(line: string): void {
  if (line === said) return
  said = line
  tell()
}

/** For tests: nothing running, nothing said. */
export function clearResearches(): void {
  researches = []
  said = ''
  tell()
}

export function useResearches(): readonly Research[] {
  return useSyncExternalStore(
    subscribe,
    () => researches,
    () => researches,
  )
}

export function useResearchSaid(): string {
  return useSyncExternalStore(
    subscribe,
    () => said,
    () => said,
  )
}
