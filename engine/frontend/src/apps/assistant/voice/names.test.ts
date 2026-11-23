/**
 * The names for the voice bar's name fix (PLAN-V22 T3-2): the company's and its people's, from what
 * the page already loaded. PLAN-V23 T1-5: the hint list, on every page, after them; its fixed words
 * go to the speech service only. Made-up names only.
 */
import { describe, expect, it } from 'vitest'
import { namesQueryOptions } from '@/api/hooks/assistant-names'
import { queryKeys } from '@/api/query'
import type { AssistantNames } from '@/api/types'
import { createTestQueryClient } from '@/test/render'
import { cachedNames, firstCompanyOf, fixNamesOf, HINT_PLACES, hintsOf, namesOnPage } from './names'

const OFFICE_ONE_WORD = ['fitout', 'NLA', 'CBD', 'tenancy', 'sqm']

describe('namesOnPage', () => {
  it('gives the company on screen and its people, as the page loaded them', () => {
    const client = createTestQueryClient()
    client.setQueryData(queryKeys.companies.detail('201'), {
      key: '201',
      name: 'Vitera Pty Ltd',
      people: [
        { id: '9', name: 'Jo Sample', title: null, phone: null, last_activity: null },
        { id: '10', name: 'Sam Sample', title: null, phone: null, last_activity: null },
      ],
    })
    expect(namesOnPage(client, { company_key: '201' })).toEqual([
      'Vitera Pty Ltd',
      'Jo Sample',
      'Sam Sample',
    ])
  })

  it('gives none when the page hasn’t loaded the company, or shows no company', () => {
    const client = createTestQueryClient()
    expect(namesOnPage(client, { company_key: '201' })).toEqual([])
    expect(namesOnPage(client, { form_id: 'f1' })).toEqual([])
    expect(namesOnPage(client, null)).toEqual([])
  })
})

const LIST: AssistantNames = {
  names: [
    { text: 'Vitera', kind: 'company', company_key: '201' },
    { text: 'Jo Sample', kind: 'person', company_key: '201' },
    { text: 'Sam Sample', kind: 'teammate', company_key: null },
    { text: 'fitout', kind: 'word', company_key: null },
  ],
}

describe('the hint list (PLAN-V23 T1-5)', () => {
  it('the fix: the names on screen first, then the list’s names, each once, and no fixed word', () => {
    // The list's own fixed words stay out; the word list's one-word office words come last
    // (PLAN-V25 T4-1).
    expect(fixNamesOf(['Northwind Pty Ltd', 'jo sample'], LIST)).toEqual([
      'Northwind Pty Ltd',
      'jo sample',
      'Vitera',
      'Sam Sample',
      ...OFFICE_ONE_WORD,
    ])
    expect(fixNamesOf([], undefined)).toEqual(OFFICE_ONE_WORD)
  })

  it('the speech service: the names on screen, then the whole list, fixed words too', () => {
    expect(hintsOf(['Northwind Pty Ltd'], LIST)).toEqual([
      'Northwind Pty Ltd',
      'Vitera',
      'Jo Sample',
      'Sam Sample',
      'fitout', // once, though the word list has it too
      'NLA',
      'CBD',
      'tenancy',
      'sqm',
      'make good',
    ])
  })

  it('the word list: the places from our copy go to the fix, and the first 50 to the hints', () => {
    const places = Array.from({ length: 60 }, (_, index) => `Sampleton ${index}`)
    const list: AssistantNames = { ...LIST, places: ['Prahran', 'Parramatta', ...places] }
    const fix = fixNamesOf([], list)
    expect(fix).toContain('Prahran')
    expect(fix).toContain('Sampleton 59')
    expect(fix).not.toContain('make good') // two words: never a name to fix to
    const hints = hintsOf([], list)
    expect(hints).toContain('Prahran')
    expect(hints.filter((hint) => hint.startsWith('Sampleton'))).toHaveLength(HINT_PLACES - 2)
  })

  it('"Try saying" names the list’s first company, or none', () => {
    expect(firstCompanyOf(LIST)).toBe('Vitera')
    expect(firstCompanyOf({ names: [LIST.names[2]] })).toBeNull()
    expect(firstCompanyOf(undefined)).toBeNull()
  })

  it('uses the company’s own list once the page has it, and the person’s own list meanwhile', () => {
    const client = createTestQueryClient()
    expect(cachedNames(client, '201')).toBeUndefined()
    client.setQueryData(namesQueryOptions(null).queryKey, LIST)
    expect(cachedNames(client, '201')).toBe(LIST)
    const own: AssistantNames = { names: [LIST.names[0]] }
    client.setQueryData(namesQueryOptions('201').queryKey, own)
    expect(cachedNames(client, '201')).toBe(own)
  })
})
