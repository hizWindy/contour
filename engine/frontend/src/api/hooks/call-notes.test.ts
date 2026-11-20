/**
 * What a saved or removed note marks as old (PLAN-V18 M1): the counts, every page of notes, and
 * History's pages, which have a key of their own. Before this, a call logged from Call logs
 * stayed out of History until a reload.
 */
import { describe, expect, it } from 'vitest'
import type { CallNotePage, CallNoteSummary } from '@/api/types'
import { createQueryClient, queryKeys } from '../query'
import { bumpCounts, markNotesOld, refreshCallNoteLists } from './call-notes'

const HISTORY = [...queryKeys.companies.callNotes(), 'history', { state: 'history' }] as const
const TO_CONFIRM = queryKeys.companies.callNoteList({ state: 'to_confirm' })
const SUMMARY = queryKeys.companies.callNoteSummary()

const EMPTY: CallNotePage = { total: 0, items: [] }
const COUNTS: CallNoteSummary = { to_confirm: 0, needs_look: 0, logged_today: 0 }

function seeded() {
  const client = createQueryClient()
  client.setQueryData(HISTORY, { pages: [EMPTY], pageParams: [0] })
  client.setQueryData(TO_CONFIRM, EMPTY)
  client.setQueryData(SUMMARY, COUNTS)
  return client
}

describe('after a note is saved or removed', () => {
  it('marks History old too, not only the pages of one state', async () => {
    const client = seeded()
    await refreshCallNoteLists(client)
    expect(client.getQueryState(HISTORY)?.isInvalidated).toBe(true)
    expect(client.getQueryState(TO_CONFIRM)?.isInvalidated).toBe(true)
    // The counts are not part of the lists: they keep their own rule.
    expect(client.getQueryState(SUMMARY)?.isInvalidated).toBe(false)
  })

  it('marks the counts, the lists and History old', () => {
    const client = seeded()
    markNotesOld(client)
    expect(client.getQueryState(SUMMARY)?.isInvalidated).toBe(true)
    expect(client.getQueryState(TO_CONFIRM)?.isInvalidated).toBe(true)
    expect(client.getQueryState(HISTORY)?.isInvalidated).toBe(true)
  })
})

describe('moving the counts at once (PLAN-V24)', () => {
  it('keeps the calls that need a company through a move of the others, and moves them too', async () => {
    const client = createQueryClient()
    client.setQueryData<CallNoteSummary>(SUMMARY, { ...COUNTS, to_confirm: 2, needs_company: 3 })
    await bumpCounts(client, { to_confirm: -1 })
    expect(client.getQueryData(SUMMARY)).toEqual({
      to_confirm: 1,
      needs_look: 0,
      logged_today: 0,
      needs_company: 3,
    })
    // A company picked: one fewer needs it, and one more waits to be confirmed.
    await bumpCounts(client, { needs_company: -1, to_confirm: 1 })
    expect(client.getQueryData(SUMMARY)).toMatchObject({ to_confirm: 2, needs_company: 2 })
  })

  it('adds no such count for an older server that sends none, and never goes below 0', async () => {
    const client = createQueryClient()
    client.setQueryData<CallNoteSummary>(SUMMARY, COUNTS)
    await bumpCounts(client, { to_confirm: -1 })
    expect(client.getQueryData(SUMMARY)).toEqual(COUNTS)
  })
})
