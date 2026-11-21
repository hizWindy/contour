/**
 * The card's find drops an answer still on its way (PLAN-V24 review): once the card's company
 * changes, even if it changes back (a pick the server refused goes back), and once the box's words
 * change (`drop`). A dropped answer picks nothing, and the words stay. With nothing changed, one
 * found is the company, as before. Against a fake server that answers when the test lets it.
 * Made-up names only: Northwind Pty Ltd, Sample Logistics Pty Ltd, North Wind as heard.
 */
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { AssistantCompanyFind } from '@/api/types'
import { mockApi } from '@/test/mock-api'
import { createTestQueryClient } from '@/test/render'
import { companyFindQueryOptions, useCompanyFind } from './find'
import { NORTHWIND, SAMPLE } from './fixtures'

const FIND = '/api/v1/companies/assistant/companies/find'

/** "North Wind" is Northwind, by HubSpot's own search. */
const NORTH_WIND: AssistantCompanyFind = {
  company: {
    heard: 'North Wind',
    from_page: false,
    found: NORTHWIND,
    choices: [],
    from_hubspot: true,
    can_add: false,
  },
  line: `${NORTHWIND.name} is new in HubSpot. We'll use it.`,
}

/** The find on a fake server, answering once the test lets it, as a slow HubSpot search would. */
function slowServer() {
  let answer = (): void => undefined
  const answered = new Promise<void>((resolve) => {
    answer = resolve
  })
  mockApi({
    [FIND]: () => answered.then(() => Response.json(NORTH_WIND)),
  })
  return { answer: () => answer() }
}

/** Waits until the find's answer for these words is in: the card's find has heard it by then. */
async function answerIn(client: QueryClient, words: string): Promise<void> {
  await waitFor(() => {
    expect(client.getQueryData(companyFindQueryOptions(words).queryKey)).toBeDefined()
  })
}

/**
 * The card's find, for a card whose company is `company`, which a rerender changes. `askFirst`: a
 * call that needs a company.
 */
function cardFind(askFirst = false) {
  const client = createTestQueryClient()
  const onFound = vi.fn()
  const initialProps: { company: string | null } = { company: null }
  const view = renderHook(({ company }) => useCompanyFind(onFound, company, askFirst), {
    initialProps,
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  })
  return { client, onFound, ...view }
}

describe('a find still on its way (PLAN-V24 review)', () => {
  it('with nothing changed, its one match is the card’s company, as before', async () => {
    const server = slowServer()
    const { client, onFound, result } = cardFind()
    act(() => {
      result.current.find('North Wind')
    })
    expect(result.current.said).toMatchObject({ words: 'North Wind', find: { kind: 'looking' } })
    server.answer()
    await answerIn(client, 'North Wind')
    await waitFor(() => {
      expect(onFound).toHaveBeenCalledWith({ key: NORTHWIND.key, name: NORTHWIND.name }, true)
    })
  })

  it('picks nothing once the card’s company changes, even when it changes back', async () => {
    const server = slowServer()
    const { client, onFound, result, rerender } = cardFind()
    act(() => {
      result.current.find('North Wind')
    })
    // Picked another way, then refused by the server: the card's company goes back to none.
    rerender({ company: SAMPLE.key })
    rerender({ company: null })
    server.answer()
    await answerIn(client, 'North Wind')
    expect(onFound).not.toHaveBeenCalled()
    // The words stay, so the box isn't filled with them again; only the answer went.
    expect(result.current.said).toMatchObject({ words: 'North Wind', find: { kind: 'dropped' } })
  })

  it('picks nothing once dropped: the box’s words changed', async () => {
    const server = slowServer()
    const { client, onFound, result } = cardFind()
    act(() => {
      result.current.find('North Wind')
    })
    act(() => {
      result.current.drop()
    })
    server.answer()
    await answerIn(client, 'North Wind')
    expect(onFound).not.toHaveBeenCalled()
    expect(result.current.said?.find).toEqual({ kind: 'dropped' })
  })

  it('leaves an answer already in as it is', async () => {
    mockApi({
      [FIND]: {
        ...NORTH_WIND,
        company: { ...NORTH_WIND.company, found: null, choices: [NORTHWIND, SAMPLE] },
      },
    })
    const { client, result } = cardFind()
    act(() => {
      result.current.find('Sample')
    })
    await answerIn(client, 'Sample')
    await waitFor(() => {
      expect(result.current.said?.find.kind).toBe('choices')
    })
    act(() => {
      result.current.drop()
    })
    expect(result.current.said?.find.kind).toBe('choices')
  })
})

describe('one found on a call that needs a company (the PLAN-V24 browser check)', () => {
  it('is asked about first: a one-item choice, and nothing is picked', async () => {
    const server = slowServer()
    const { client, onFound, result } = cardFind(true)
    act(() => {
      result.current.find('North Wind')
    })
    server.answer()
    await answerIn(client, 'North Wind')
    await waitFor(() => {
      expect(result.current.said?.find).toEqual({
        kind: 'confirm',
        choice: NORTHWIND,
        fromHubspot: true,
      })
    })
    expect(onFound).not.toHaveBeenCalled()
  })

  it('is picked by `confirm`, as one found is picked elsewhere, with its HubSpot line', async () => {
    const server = slowServer()
    const { client, onFound, result } = cardFind(true)
    act(() => {
      result.current.find('North Wind')
    })
    server.answer()
    await answerIn(client, 'North Wind')
    await waitFor(() => {
      expect(result.current.said?.find.kind).toBe('confirm')
    })
    // Another company isn't the one asked about.
    let took = true
    act(() => {
      took = result.current.confirm(SAMPLE.key)
    })
    expect(took).toBe(false)
    expect(onFound).not.toHaveBeenCalled()
    act(() => {
      took = result.current.confirm(NORTHWIND.key)
    })
    expect(took).toBe(true)
    expect(onFound).toHaveBeenCalledWith({ key: NORTHWIND.key, name: NORTHWIND.name }, true)
    expect(result.current.said).toBeNull()
  })

  it('leaves nothing to confirm on another card: there, one found is taken at once', async () => {
    const server = slowServer()
    const { client, onFound, result } = cardFind(false)
    act(() => {
      result.current.find('North Wind')
    })
    server.answer()
    await answerIn(client, 'North Wind')
    await waitFor(() => {
      expect(onFound).toHaveBeenCalledTimes(1)
    })
    let took = true
    act(() => {
      took = result.current.confirm(NORTHWIND.key)
    })
    expect(took).toBe(false)
    expect(onFound).toHaveBeenCalledTimes(1)
  })
})
