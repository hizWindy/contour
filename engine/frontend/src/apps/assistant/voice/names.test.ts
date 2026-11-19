/**
 * The names on screen for the voice bar's name fix (PLAN-V22 T3-2): the company's and its people's,
 * from what the page already loaded, and none elsewhere. Made-up names only.
 */
import { describe, expect, it } from 'vitest'
import { queryKeys } from '@/api/query'
import { createTestQueryClient } from '@/test/render'
import { namesOnPage } from './names'

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
