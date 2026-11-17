import { QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useLogout, type SignedInUser, type SignIn } from '@/api/hooks/auth'
import { queryKeys } from '@/api/query'
import { SAMPLE_USER, signedOut, stubAuthBackend } from '@/test/fake-auth'
import { createTestQueryClient } from '@/test/render'
import {
  draftOwner,
  draftWithKey,
  dropDraft,
  keepDraft,
  newestDraft,
  readDraft,
  startDraft,
  type DraftOwner,
  type NoteDraft,
} from './draft'

const STORAGE = 'companies.call-note-drafts'
const JO = { id: '201', name: 'Jo Sample' }
// Two reps on one shared browser. Made-up people.
const MIA: SignedInUser = {
  ...SAMPLE_USER,
  id: 'aaaaaaaa-0000-0000-0000-00000000000a',
  name: 'Mia Sample',
  position: null,
  role: 'staff',
  apps: ['companies'],
  features: ['companies.companies', 'companies.call_logs', 'companies.meetings', 'companies.call_prep'],
}
const SAM: SignedInUser = { ...MIA, id: 'bbbbbbbb-0000-0000-0000-00000000000b', name: 'Sam Sample' }

function draft(changes: Partial<NoteDraft> = {}, owner: DraftOwner = null): NoteDraft {
  return {
    ...startDraft(owner, '101', JO, new Date('2026-11-15T01:00:00Z')),
    text: 'Hi',
    ...changes,
  }
}

function blockStorage(): void {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked')
  })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked')
  })
}

/** What one localStorage entry holds, read back. */
function stored(entry: string): Record<string, unknown> {
  return JSON.parse(window.localStorage.getItem(entry) ?? '{}') as Record<string, unknown>
}

/** Signs `user` out of this browser, the way "Sign out" in the account menu does. */
async function signOut(user: SignedInUser): Promise<void> {
  stubAuthBackend({ me: signedOut() })
  const client = createTestQueryClient()
  const signedIn: SignIn = { state: 'signed_in', user }
  client.setQueryData(queryKeys.auth.me(), signedIn)
  const { result } = renderHook(() => useLogout(), {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children),
  })
  act(() => {
    result.current.mutate(undefined)
  })
  await waitFor(() => {
    expect(client.getQueryData<SignIn>(queryKeys.auth.me())?.state).toBe('signed_out')
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
})

describe('call note drafts', () => {
  it('start with their own key, whose they are, and the time the view opened', () => {
    const made = startDraft(null, '101', null, new Date('2026-11-15T01:00:00Z'))
    expect(made.key).toMatch(/^[0-9a-f-]{36}$/)
    expect(made).toMatchObject({
      owner: null,
      companyKey: '101',
      contactId: null,
      contactName: null,
      text: '',
      source: 'typed',
      outcome: null,
      calledAt: '2026-11-15T01:00:00.000Z',
      followUp: null,
    })
    expect(startDraft(null, '101', null).key).not.toBe(made.key)
    expect(startDraft(MIA.id, '101', null).owner).toBe(MIA.id)
  })

  it('are kept for the call (the company and the person) and read back', () => {
    const kept = draft({ outcome: 'Connected' })
    keepDraft(kept)
    expect(readDraft(null, '101', '201')).toEqual(kept)
    expect(readDraft(null, '101', null)).toBeNull()
    expect(draftWithKey(null, kept.key)).toEqual(kept)
  })

  it('find the newest for a company, whoever the call was with', () => {
    keepDraft(draft({ contactId: null, contactName: null, updatedAt: '2026-11-15T01:00:00Z' }))
    const newer = draft({ text: 'Later', updatedAt: '2026-11-15T02:00:00Z' })
    keepDraft(newer)
    expect(newestDraft(null, '101')).toEqual(newer)
    expect(newestDraft(null, '999')).toBeNull()
  })

  it('go when emptied, but never take a newer draft for the same call with them', () => {
    const first = draft()
    keepDraft(first)
    keepDraft({ ...first, text: '  ' })
    expect(readDraft(null, '101', '201')).toBeNull()

    const newer = draft({ text: 'Newer' })
    keepDraft(newer)
    // An empty copy of another draft, or a drop with another key, leaves this one alone.
    keepDraft({ ...first, text: '' })
    dropDraft(null, '101', '201', first.key)
    expect(readDraft(null, '101', '201')).toEqual(newer)
    dropDraft(null, '101', '201', newer.key)
    expect(readDraft(null, '101', '201')).toBeNull()
  })

  it('keep a follow-up even with no text', () => {
    const kept = draft({ text: '', followUp: { subject: '', when: 'tomorrow' } })
    keepDraft(kept)
    expect(readDraft(null, '101', '201')?.followUp).toEqual({ subject: '', when: 'tomorrow' })
  })

  it('skip a stored entry of the wrong shape, and survive text that is not JSON', () => {
    const good = draft()
    window.localStorage.setItem(
      STORAGE,
      JSON.stringify({ '101|201': good, '102|': { key: 'x', text: 3 } }),
    )
    expect(readDraft(null, '101', '201')).toEqual(good)
    expect(readDraft(null, '102', null)).toBeNull()
    window.localStorage.setItem(STORAGE, '{not json')
    expect(readDraft(null, '101', '201')).toBeNull()
  })

  it('stay while the page is open in a browser that blocks storage', () => {
    blockStorage()
    const kept = draft({ text: 'Kept in memory' })
    keepDraft(kept)
    expect(readDraft(null, '101', '201')).toEqual(kept)

    // Once storage takes a write again, it is the one read.
    vi.restoreAllMocks()
    dropDraft(null, '101', '201')
    expect(window.localStorage.getItem(STORAGE)).toBe('{}')
    expect(readDraft(null, '101', '201')).toBeNull()
  })
})

describe('whose drafts they are (privacy on a shared browser)', () => {
  it('each signed-in person has their own; with sign-in off, all share the one entry as before', () => {
    expect(draftOwner({ state: 'signed_in', user: MIA })).toBe(MIA.id)
    expect(draftOwner({ state: 'off' })).toBeNull()

    const mias = draft({ text: "Mia's note" }, MIA.id)
    keepDraft(mias)
    expect(readDraft(MIA.id, '101', '201')).toEqual(mias)
    // Sam, on the same browser, sees none of it, and can't send it by its key.
    expect(readDraft(SAM.id, '101', '201')).toBeNull()
    expect(newestDraft(SAM.id, '101')).toBeNull()
    expect(draftWithKey(SAM.id, mias.key)).toBeNull()
    // Nor does the shared entry of sign-in off hold it.
    expect(readDraft(null, '101', '201')).toBeNull()
    expect(window.localStorage.getItem(STORAGE)).toBeNull()
    expect(window.localStorage.getItem(`${STORAGE}.${MIA.id}`)).toContain("Mia's note")

    // Sign-in off: one entry, the same as before people had their own.
    const shared = draft({ text: 'Shared' })
    keepDraft(shared)
    expect(Object.keys(stored(STORAGE))).toEqual(['101|201'])
    expect(readDraft(null, '101', '201')).toEqual(shared)
    expect(readDraft(MIA.id, '101', '201')).toEqual(mias)
    // A drop for one person never touches another's.
    dropDraft(SAM.id, '101', '201')
    dropDraft(null, '101', '201')
    expect(readDraft(MIA.id, '101', '201')).toEqual(mias)
  })

  it('read a draft kept before people had their own entries as the shared one it is', () => {
    const old: Record<string, unknown> = { ...draft({ text: 'Old' }) }
    delete old.owner
    window.localStorage.setItem(STORAGE, JSON.stringify({ '101|201': old }))
    expect(readDraft(null, '101', '201')).toMatchObject({ owner: null, text: 'Old' })
    expect(readDraft(MIA.id, '101', '201')).toBeNull()
  })

  it('signing out: the page forgets its copy, and the unsaved note waits under the person', async () => {
    const mias = draft({ text: "Mia's note" }, MIA.id)
    keepDraft(mias)
    await signOut(MIA)

    // The note isn't saved yet, so it stays in Mia's entry: she sees it when she signs in again.
    expect(readDraft(MIA.id, '101', '201')).toEqual(mias)
    // The next rep doesn't.
    expect(readDraft(SAM.id, '101', '201')).toBeNull()
    // The page itself kept no copy: with storage gone, there is nothing left of it here.
    blockStorage()
    expect(readDraft(MIA.id, '101', '201')).toBeNull()
  })

  it('signing out where storage is blocked keeps the note in the page, under the person', async () => {
    blockStorage()
    const mias = draft({ text: 'Only in this page' }, MIA.id)
    keepDraft(mias)
    await signOut(MIA)

    // The page's copy is the only one, so dropping it would lose the note: it stays, for Mia.
    expect(readDraft(MIA.id, '101', '201')).toEqual(mias)
    expect(readDraft(SAM.id, '101', '201')).toBeNull()
    expect(readDraft(null, '101', '201')).toBeNull()

    // Once storage takes a write again, the note goes into Mia's entry, whole.
    vi.restoreAllMocks()
    keepDraft({ ...mias, text: 'Only in this page, and more' })
    expect(stored(`${STORAGE}.${MIA.id}`)).toMatchObject({
      '101|201': { text: 'Only in this page, and more' },
    })
  })
})
