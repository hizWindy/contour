import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  draftWithKey,
  dropDraft,
  keepDraft,
  newestDraft,
  readDraft,
  startDraft,
  type NoteDraft,
} from './draft'

const STORAGE = 'companies.call-note-drafts'
const JO = { id: '201', name: 'Jo Sample' }

function draft(changes: Partial<NoteDraft> = {}): NoteDraft {
  return { ...startDraft('101', JO, new Date('2026-11-15T01:00:00Z')), text: 'Hi', ...changes }
}

afterEach(() => {
  window.localStorage.clear()
})

describe('call note drafts', () => {
  it('start with their own key and the time the view opened', () => {
    const made = startDraft('101', null, new Date('2026-11-15T01:00:00Z'))
    expect(made.key).toMatch(/^[0-9a-f-]{36}$/)
    expect(made).toMatchObject({
      companyKey: '101',
      contactId: null,
      contactName: null,
      text: '',
      source: 'typed',
      outcome: null,
      calledAt: '2026-11-15T01:00:00.000Z',
      followUp: null,
    })
    expect(startDraft('101', null).key).not.toBe(made.key)
  })

  it('are kept for the call (the company and the person) and read back', () => {
    const kept = draft({ outcome: 'Connected' })
    keepDraft(kept)
    expect(readDraft('101', '201')).toEqual(kept)
    expect(readDraft('101', null)).toBeNull()
    expect(draftWithKey(kept.key)).toEqual(kept)
  })

  it('find the newest for a company, whoever the call was with', () => {
    keepDraft(draft({ contactId: null, contactName: null, updatedAt: '2026-11-15T01:00:00Z' }))
    const newer = draft({ text: 'Later', updatedAt: '2026-11-15T02:00:00Z' })
    keepDraft(newer)
    expect(newestDraft('101')).toEqual(newer)
    expect(newestDraft('999')).toBeNull()
  })

  it('go when emptied, but never take a newer draft for the same call with them', () => {
    const first = draft()
    keepDraft(first)
    keepDraft({ ...first, text: '  ' })
    expect(readDraft('101', '201')).toBeNull()

    const newer = draft({ text: 'Newer' })
    keepDraft(newer)
    // An empty copy of another draft, or a drop with another key, leaves this one alone.
    keepDraft({ ...first, text: '' })
    dropDraft('101', '201', first.key)
    expect(readDraft('101', '201')).toEqual(newer)
    dropDraft('101', '201', newer.key)
    expect(readDraft('101', '201')).toBeNull()
  })

  it('keep a follow-up even with no text', () => {
    const kept = draft({ text: '', followUp: { subject: '', when: 'tomorrow' } })
    keepDraft(kept)
    expect(readDraft('101', '201')?.followUp).toEqual({ subject: '', when: 'tomorrow' })
  })

  it('skip a stored entry of the wrong shape, and survive text that is not JSON', () => {
    const good = draft()
    window.localStorage.setItem(
      STORAGE,
      JSON.stringify({ '101|201': good, '102|': { key: 'x', text: 3 } }),
    )
    expect(readDraft('101', '201')).toEqual(good)
    expect(readDraft('102', null)).toBeNull()
    window.localStorage.setItem(STORAGE, '{not json')
    expect(readDraft('101', '201')).toBeNull()
  })

  it('stay while the page is open in a browser that blocks storage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const kept = draft({ text: 'Kept in memory' })
    keepDraft(kept)
    expect(readDraft('101', '201')).toEqual(kept)

    // Once storage takes a write again, it is the one read.
    vi.restoreAllMocks()
    dropDraft('101', '201')
    expect(window.localStorage.getItem(STORAGE)).toBe('{}')
    expect(readDraft('101', '201')).toBeNull()
  })
})
