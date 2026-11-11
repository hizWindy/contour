/**
 * The error box every page uses (PLAN-V15 T2-3): plain words, "Try again" always, and the
 * technical part folded away under "Details for support", with a Copy button.
 */
import { useQuery } from '@tanstack/react-query'
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ApiProblem, api, unwrap } from '@/api/client'
import { renderWithProviders } from '@/test/render'
import { supportLines } from '@/lib/support'
import { ErrorState } from './error-state'

const SERVER_FAULT = new ApiProblem({
  title: 'Something went wrong on our side',
  detail: 'Try again. If it happens again, send this code to an admin: 7F3K92QD.',
  status: 500,
  code: 'internal_error',
  request_id: '7F3K92QD',
})

describe('ErrorState', () => {
  it('always has Try again, even when the page gives no retry of its own', () => {
    renderWithProviders(<ErrorState error={SERVER_FAULT} />)

    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('asks again for the failed reads on screen when the page gives no retry', async () => {
    let calls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        calls += 1
        return Promise.resolve(
          calls === 1
            ? Response.json({ title: 'x', status: 500 }, { status: 500 })
            : Response.json({ total: 0, items: [] }),
        )
      }),
    )
    function Page() {
      const leads = useQuery({
        queryKey: ['leads', 'error-state'],
        queryFn: async ({ signal }) => unwrap(await api.GET('/lead-finder/leads', { signal })),
      })
      return leads.isError ? (
        <ErrorState error={leads.error} />
      ) : (
        <p>{leads.data ? 'Loaded' : ''}</p>
      )
    }
    const { user } = renderWithProviders(<Page />)

    await user.click(await screen.findByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('Loaded')).toBeInTheDocument()
    expect(calls).toBe(2)
  })

  it("uses the page's own retry when it gives one", async () => {
    const onRetry = vi.fn()
    const { user } = renderWithProviders(
      <ErrorState error={SERVER_FAULT} onRetry={onRetry} retryLabel="Load again" />,
    )

    await user.click(screen.getByRole('button', { name: 'Load again' }))

    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('folds the details for support away, and they hold what an admin needs', async () => {
    const { user } = renderWithProviders(<ErrorState error={SERVER_FAULT} />, {
      route: '/companies?q=abc',
    })
    const alert = screen.getByRole('alert')
    const details = alert.querySelector('details')

    expect(details).not.toBeNull()
    expect(details?.open).toBe(false)
    await user.click(within(alert).getByText('Details for support'))
    expect(details?.open).toBe(true)

    const shown = within(details as HTMLElement)
    expect(shown.getByText('500')).toBeInTheDocument()
    expect(shown.getByText('internal_error')).toBeInTheDocument()
    expect(shown.getByText('7F3K92QD')).toBeInTheDocument()
  })

  it('copies the details in one go', async () => {
    const { user } = renderWithProviders(<ErrorState error={SERVER_FAULT} />)
    const alert = screen.getByRole('alert')
    await user.click(within(alert).getByText('Details for support'))

    await user.click(within(alert).getByRole('button', { name: 'Copy the details' }))

    const copied = await navigator.clipboard.readText()
    expect(copied).toContain('Status: 500')
    expect(copied).toContain('Code: internal_error')
    expect(copied).toContain('Request id: 7F3K92QD')
    expect(copied).toMatch(/Time: .+\(\d{4}-\d\d-\d\dT/)
    expect(copied).toContain('Page: /')
    await waitFor(() => {
      expect(within(alert).getByRole('button', { name: 'Copied' })).toBeInTheDocument()
    })
  })

  it('says "No answer" and "None" when nothing reached the server', () => {
    const lines = Object.fromEntries(
      supportLines(new ApiProblem({ title: 't', status: 0, code: 'unreachable' }), '/x'),
    )

    expect(lines).toMatchObject({
      Status: 'No answer',
      Code: 'unreachable',
      'Request id': 'None',
      Page: '/x',
    })
  })

  it('lists the wrong fields of a 422 in plain words', () => {
    renderWithProviders(
      <ErrorState
        error={
          new ApiProblem({
            title: 'Some fields need a fix',
            status: 422,
            errors: [{ field: 'body.name', message: 'Fill this in.' }],
          })
        }
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('Name: Fill this in.')
  })
})
