import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { useLeadFacets, usePatchLead, useRules, useRunOptions } from './hooks'
import { createQueryClient } from './query'

/** Counts the calls to each path, and answers with an empty object (the probes read no fields). */
function mockBackend(): Map<string, number> {
  const calls = new Map<string, number>()
  vi.stubGlobal(
    'fetch',
    vi.fn((request: Request) => {
      const path = new URL(request.url).pathname.replace('/api/v1', '')
      calls.set(path, (calls.get(path) ?? 0) + 1)
      return Promise.resolve(Response.json(path === '/lead-finder/leads/l1' ? { id: 'l1' } : {}))
    }),
  )
  return calls
}

function RulesProbe() {
  return <p>{useRules().isSuccess ? 'rules ready' : 'rules loading'}</p>
}
function FacetsProbe() {
  return <p>{useLeadFacets().isSuccess ? 'counts ready' : 'counts loading'}</p>
}
function OptionsProbe() {
  return <p>{useRunOptions().isSuccess ? 'options ready' : 'options loading'}</p>
}
function RejectProbe() {
  const patch = usePatchLead()
  return (
    <button
      type="button"
      onClick={() => {
        patch.mutate({ leadId: 'l1', patch: { status: 'rejected' } })
      }}
    >
      Reject
    </button>
  )
}

const MINUTE = 60_000

/** Gives a refetch that was going to start the time to start, so "it did not ask" is a real result. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40))
  })
}

beforeEach(() => {
  // Only the clock is fake, so a query can age without the test waiting.
  vi.useFakeTimers({ toFake: ['Date'] })
})
afterEach(() => {
  vi.useRealTimers()
})

/** Shows a page, leaves it, waits `ago` ms and comes back. */
async function visitTwice(page: React.ReactElement, ready: string, ago: number): Promise<void> {
  const client = createQueryClient()
  const first = renderWithProviders(page, { queryClient: client, withRouter: false })
  await screen.findByText(ready)
  first.unmount()
  vi.setSystemTime(Date.now() + ago)
  renderWithProviders(page, { queryClient: client, withRouter: false })
  await screen.findByText(ready)
}

describe('how long an answer counts as fresh (PLAN-V7 C3)', () => {
  it('asks for the rules only once when you come back within 10 minutes', async () => {
    const calls = mockBackend()

    await visitTwice(<RulesProbe />, 'rules ready', 9 * MINUTE)
    await settle()

    expect(calls.get('/lead-finder/rules')).toBe(1)
  })

  it('asks for the rules again when you come back after 10 minutes', async () => {
    const calls = mockBackend()

    await visitTwice(<RulesProbe />, 'rules ready', 11 * MINUTE)

    await waitFor(() => {
      expect(calls.get('/lead-finder/rules')).toBe(2)
    })
  })

  it('asks for the filter counts only once when you come back within 30 seconds', async () => {
    const calls = mockBackend()

    await visitTwice(<FacetsProbe />, 'counts ready', 29_000)
    await settle()

    expect(calls.get('/lead-finder/leads/facets')).toBe(1)
  })

  it('asks for the filter counts again when you come back after 30 seconds', async () => {
    const calls = mockBackend()

    await visitTwice(<FacetsProbe />, 'counts ready', 31_000)

    await waitFor(() => {
      expect(calls.get('/lead-finder/leads/facets')).toBe(2)
    })
  })

  it('does not keep the run options longer than 15 seconds: they hold "left today"', async () => {
    const calls = mockBackend()

    await visitTwice(<OptionsProbe />, 'options ready', 16_000)

    await waitFor(() => {
      expect(calls.get('/lead-finder/run-options')).toBe(2)
    })
  })

  it('still shows your own change at once: a Reject reads the counts again', async () => {
    const calls = mockBackend()
    const client = createQueryClient()
    renderWithProviders(
      <>
        <FacetsProbe />
        <RejectProbe />
      </>,
      { queryClient: client, withRouter: false },
    )
    await screen.findByText('counts ready')
    expect(calls.get('/lead-finder/leads/facets')).toBe(1)

    // Two seconds later, well inside the 30 seconds.
    vi.setSystemTime(Date.now() + 2_000)
    await act(async () => {
      await userEvent.setup({ advanceTimers: () => undefined }).click(screen.getByText('Reject'))
    })

    await waitFor(() => {
      expect(calls.get('/lead-finder/leads/facets')).toBe(2)
    })
  })
})
