/**
 * Changes said to a call before it was sorted, kept past the card (PLAN-V24 review of T3-2): made
 * once the call is sorted, in one PATCH, once; a call that waits for its company isn't read again
 * until a pick sorts it; a call that is gone, or that moved on without being sorted, takes nothing,
 * quietly; a save still on its way is waited for; nothing is read forever; and a tab left hidden
 * past that limit still makes them. Against a fake server and a real cache, with the clock as it
 * is. Made-up names only: Jo Sample.
 */
import { focusManager } from '@tanstack/react-query'
import { waitFor } from '@testing-library/react'
import { toast } from 'sonner'
import { describe, expect, it, vi } from 'vitest'
import { queryKeys } from '@/api/query'
import type { AssistantChange, CallNoteOut } from '@/api/types'
import { mockApi } from '@/test/mock-api'
import { createTestQueryClient } from '@/test/render'
import { FOLLOW_UP, note, NOTE_ID, notePath, options } from './fixtures'
import { keepUntilSorted, keptCalls, SORT_LIMIT_MS } from './held'

const MONDAY: AssistantChange = { box: 'follow-up', value: 'Monday', day: '2099-11-30' }
const TUESDAY: AssistantChange = { box: 'follow-up', value: 'Tuesday', day: '2099-12-01' }
const VOICEMAIL: AssistantChange = { box: 'outcome', value: 'Left voicemail', day: null }
const OUTCOMES = options().outcomes
/** The card reads a sorting call every 2 seconds; here, every 20 ms. */
const SORT_MS = 20

/** The follow-up the sort made, moved to Monday. */
const ON_MONDAY = {
  id: FOLLOW_UP.id,
  subject: FOLLOW_UP.subject,
  due: '2099-11-30',
  due_words: 'Monday',
  kind: 'call',
}

/** The call on a fake server, as the test sets it: gone (null) is a 404. */
function callServer(status: CallNoteOut['status']) {
  let saved: CallNoteOut | null = note({ status, tasks: [] })
  const calls = mockApi({
    [notePath()]: () => (saved === null ? undefined : Response.json(saved)),
  })
  const of = (method: string) =>
    calls.filter((call) => call.path === notePath() && call.method === method)
  return {
    reads: () => of('GET').length,
    patches: () => of('PATCH').map((call) => call.body),
    /** The sorter is done: the call waits to be confirmed, with the follow-up it made. */
    sort: () => {
      if (saved) saved = { ...saved, status: 'to_confirm', tasks: [FOLLOW_UP] }
    },
    set: (change: Partial<CallNoteOut>) => {
      if (saved) saved = { ...saved, ...change }
    },
    remove: () => {
      saved = null
    },
    now: () => saved,
  }
}

/** A card went, with these changes kept for the call: the cache holds the call as it last read. */
function cardWent(server: ReturnType<typeof callServer>, changes: readonly AssistantChange[]) {
  const client = createTestQueryClient()
  client.setQueryData(queryKeys.companies.callNote(NOTE_ID), server.now())
  keepUntilSorted({ client, note: NOTE_ID, changes, outcomes: OUTCOMES, sortMs: SORT_MS })
  return client
}

/** Real time passes, long enough for a few reads. */
async function pause(ms = SORT_MS * 6): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

describe('changes kept past the card (PLAN-V24 review)', () => {
  it('are made in one PATCH once the call is sorted, in the order said, and only once', async () => {
    const server = callServer('sorting')
    const client = cardWent(server, [TUESDAY, VOICEMAIL, MONDAY])
    // Read again while it sorts; nothing is sent before.
    await waitFor(() => {
      expect(server.reads()).toBeGreaterThan(2)
    })
    expect(server.patches()).toEqual([])
    expect(keptCalls(client)).toEqual([NOTE_ID])

    server.sort()
    // A later change to the same part wins: Monday, said after Tuesday.
    await waitFor(() => {
      expect(server.patches()).toEqual([{ tasks: [ON_MONDAY], outcome: 'Left voicemail' }])
    })
    expect(keptCalls(client)).toEqual([])
    const reads = server.reads()
    await pause()
    expect(server.patches()).toHaveLength(1)
    expect(server.reads()).toBe(reads)
  })

  it('kept by two cards for one call, go in one PATCH, the second card’s after the first’s', async () => {
    const server = callServer('sorting')
    const client = cardWent(server, [MONDAY])
    keepUntilSorted({
      client,
      note: NOTE_ID,
      changes: [TUESDAY],
      outcomes: OUTCOMES,
      sortMs: SORT_MS,
    })
    server.sort()
    await waitFor(() => {
      expect(server.patches()).toEqual([
        { tasks: [{ ...ON_MONDAY, due: '2099-12-01', due_words: 'Tuesday' }] },
      ])
    })
  })

  it('on a call that waits for its company, wait without reading, until a pick sorts it', async () => {
    const server = callServer('needs_company')
    const client = cardWent(server, [MONDAY])
    await pause()
    // The cache's call is read once, as any new look at it is, and never again while it waits.
    expect(server.reads()).toBeLessThanOrEqual(1)
    expect(keptCalls(client)).toEqual([NOTE_ID])

    // Picked, on a card or in Call logs: the call sorts, and its answer is put in the cache.
    server.set({ status: 'sorting', company_key: '301', company_name: 'Northwind Pty Ltd' })
    client.setQueryData(queryKeys.companies.callNote(NOTE_ID), server.now())
    const before = server.reads()
    await waitFor(() => {
      expect(server.reads()).toBeGreaterThan(before)
    })
    server.sort()
    await waitFor(() => {
      expect(server.patches()).toEqual([{ tasks: [ON_MONDAY] }])
    })
  })

  it('on a call removed meanwhile, are dropped, and nothing is said', async () => {
    const error = vi.spyOn(toast, 'error')
    const server = callServer('sorting')
    const client = cardWent(server, [MONDAY])
    server.remove()
    await waitFor(() => {
      expect(keptCalls(client)).toEqual([])
    })
    const reads = server.reads()
    await pause()
    expect(server.reads()).toBe(reads)
    expect(server.patches()).toEqual([])
    expect(error).not.toHaveBeenCalled()
  })

  it.each<CallNoteOut['status']>(['failed', 'sending', 'logged'])(
    'on a call that is %s instead of sorted, are dropped quietly',
    async (status) => {
      const error = vi.spyOn(toast, 'error')
      const server = callServer('sorting')
      const client = cardWent(server, [MONDAY])
      server.set({ status })
      await waitFor(() => {
        expect(keptCalls(client)).toEqual([])
      })
      await pause()
      expect(server.patches()).toEqual([])
      expect(error).not.toHaveBeenCalled()
    },
  )

  it('wait for a save still on its way; a save that failed takes them with it', async () => {
    const server = callServer('sorting')
    const client = createTestQueryClient()
    let answer = (_saved: CallNoteOut): void => undefined
    const saving = new Promise<CallNoteOut>((resolve) => {
      answer = resolve
    })
    keepUntilSorted({
      client,
      note: saving,
      changes: [MONDAY],
      outcomes: OUTCOMES,
      sortMs: SORT_MS,
    })
    await pause()
    expect(keptCalls(client)).toEqual([])
    answer(note({ status: 'sorting', tasks: [] }))
    await waitFor(() => {
      expect(keptCalls(client)).toEqual([NOTE_ID])
    })
    server.sort()
    await waitFor(() => {
      expect(server.patches()).toEqual([{ tasks: [ON_MONDAY] }])
    })

    const other = createTestQueryClient()
    keepUntilSorted({
      client: other,
      note: Promise.reject(new Error('Contour is busy')),
      changes: [MONDAY],
      outcomes: OUTCOMES,
      sortMs: SORT_MS,
    })
    await pause()
    expect(keptCalls(other)).toEqual([])
  })

  it('on a call still sorting after the limit, are dropped, so nothing is read forever', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const server = callServer('sorting')
    const client = cardWent(server, [MONDAY])
    await waitFor(() => {
      expect(server.reads()).toBeGreaterThan(1)
    })
    vi.setSystemTime(Date.now() + SORT_LIMIT_MS + 1)
    await waitFor(() => {
      expect(keptCalls(client)).toEqual([])
    })
    const reads = server.reads()
    await pause()
    expect(server.reads()).toBe(reads)
    expect(server.patches()).toEqual([])
  })

  it('in a tab hidden past the limit, are still made when the call was sorted meanwhile', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const server = callServer('sorting')
      const client = cardWent(server, [MONDAY])
      await waitFor(() => {
        expect(server.reads()).toBeGreaterThan(1)
      })
      // Hidden: nothing is read. The call is sorted, and the limit passes.
      focusManager.setFocused(false)
      await pause()
      const reads = server.reads()
      server.sort()
      vi.setSystemTime(Date.now() + SORT_LIMIT_MS + 1)
      await pause()
      expect(server.reads()).toBe(reads)
      expect(keptCalls(client)).toEqual([NOTE_ID])
      // Back in front: the call is read again, sorted, and takes the change.
      focusManager.setFocused(true)
      await waitFor(() => {
        expect(server.patches()).toEqual([{ tasks: [ON_MONDAY] }])
      })
    } finally {
      focusManager.setFocused(undefined)
    }
  })
})
