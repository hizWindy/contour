/**
 * The state of Meetings' Sync (PLAN-V18 T2-3), for the button and the line under the toolbar
 * (`sync.tsx`, which says how each moment looks): what the button says, how many times it was
 * pressed, the line's words, and the press itself.
 */
import { useEffect, useState } from 'react'
import { useSyncMeetings } from '@/api/hooks/meetings'
import type { MeetingPage } from '@/api/types'
import { ALREADY_CHECKING, CHECKED_A_MOMENT_AGO, checkedWords, syncNotSentWords } from './words'

/** How long "Up to date" stays on the button after a read, before it says "Sync" again. */
export const UP_TO_DATE_MS = 4000

export type SyncLook = 'idle' | 'checking' | 'done'

/** What the last press answered, for the line: already running, fresh, or why it didn't go. */
type Note = { kind: 'running' } | { kind: 'fresh' } | { kind: 'failed'; words: string }

export interface SyncLineWords {
  words: string
  problem: boolean
}

export interface MeetingsSync {
  look: SyncLook
  /** Presses so far: each turns the icon once. */
  turns: number
  /** The line under the toolbar, or null while the page doesn't know when meetings were read. */
  line: SyncLineWords | null
  /** Sync can't do anything while HubSpot isn't connected. */
  disabled: boolean
  press: () => void
}

/** Sync's state for the page of meetings on screen. */
export function useMeetingsSync(page: MeetingPage | undefined, today: string): MeetingsSync {
  const sync = useSyncMeetings()
  const [turns, setTurns] = useState(0)
  const [note, setNote] = useState<Note | null>(null)
  const [done, setDone] = useState(false)
  // A read this page asked for, or saw running, with the page that was on screen then. It has
  // ended once a newer page says nothing is being read: never on the page it started from.
  const [awaiting, setAwaiting] = useState<{ from: MeetingPage | undefined } | null>(null)

  const reading = page?.syncing === true
  const [wasReading, setWasReading] = useState(reading)
  if (reading !== wasReading) {
    setWasReading(reading)
    if (reading && awaiting === null) setAwaiting({ from: page })
  }
  // It ended, whoever started it: "Up to date", unless it failed.
  if (awaiting !== null && !reading && !sync.isPending && page !== awaiting.from) {
    setAwaiting(null)
    setDone(!page?.sync_problem)
    if (note?.kind === 'running') setNote(null)
  }

  useEffect(() => {
    if (!done) return
    const timer = setTimeout(() => {
      setDone(false)
      setNote((now) => (now?.kind === 'fresh' ? null : now))
    }, UP_TO_DATE_MS)
    return () => {
      clearTimeout(timer)
    }
  }, [done])

  const press = (): void => {
    const onScreen = page
    setTurns((count) => count + 1)
    setNote(null)
    setDone(false)
    sync.mutate(undefined, {
      onSuccess: (answer) => {
        if (answer.state === 'fresh') {
          setNote({ kind: 'fresh' })
          setDone(true)
          return
        }
        // The lists on screen say it is reading now (`useSyncMeetings`), until a newer one says
        // it has ended.
        setAwaiting({ from: onScreen })
        if (answer.state === 'running') setNote({ kind: 'running' })
      },
      onError: (error) => {
        setNote({ kind: 'failed', words: syncNotSentWords(error) })
      },
    })
  }

  const checking = sync.isPending || reading
  const look: SyncLook = checking ? 'checking' : done ? 'done' : 'idle'
  // Before anything was read, a missing permission is the list's sentence too, which the page
  // shows already: the line doesn't say it again.
  const said = page?.sentence?.trim() || null
  const told = page?.sync_problem?.trim() || null
  const problem = told !== said ? told : null

  let line: SyncLineWords | null = null
  if (note?.kind === 'failed') line = { words: note.words, problem: true }
  else if (problem && !checking) line = { words: problem, problem: true }
  else if (note?.kind === 'running') line = { words: ALREADY_CHECKING, problem: false }
  else if (note?.kind === 'fresh') line = { words: CHECKED_A_MOMENT_AGO, problem: false }
  else if (page?.checked_at) line = { words: checkedWords(page.checked_at, today), problem: false }

  return { look, turns, line, disabled: page?.meetings_state === 'off', press }
}
