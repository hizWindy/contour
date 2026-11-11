/**
 * The connection bar and the full error pages (PLAN-V15 T2-4): what each says, and the automatic
 * retries (every 10 seconds while the server can't be reached or is updating, at once when the
 * browser is back online).
 */
import { onlineManager, useQuery } from '@tanstack/react-query'
import { act, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiProblem, unwrap } from '@/api/client'
import { connectionOf, RETRY_EVERY_MS } from '@/api/connection'
import { ErrorState } from '@/components/error-state'
import { browser } from '@/lib/reload'
import { createTestQueryClient, renderWithProviders } from '@/test/render'
import { ConnectionBar } from '../connection-bar'
import { ConnectionLostPage, NoAccessPage, NotFoundPage, ProblemPage, UpdatingPage } from './pages'

const UNREACHABLE = new ApiProblem({
  title: "Contour can't reach its server",
  status: 0,
  code: 'unreachable',
})

/** A backend the test switches: down (a network error) or up (every read answers). */
function switchableBackend() {
  const backend = { up: false, calls: [] as string[] }
  vi.stubGlobal(
    'fetch',
    vi.fn((request: Request) => {
      backend.calls.push(new URL(request.url).pathname)
      if (!backend.up) return Promise.reject(new TypeError('Failed to fetch'))
      return Promise.resolve(Response.json({ status: 'ok', total: 0, items: [] }))
    }),
  )
  return backend
}

const healthChecks = (calls: string[]) => calls.filter((path) => path === '/api/v1/health').length

afterEach(() => {
  onlineManager.setOnline(true)
})

describe('the connection bar', () => {
  it('shows nothing while the connection is fine', () => {
    renderWithProviders(<ConnectionBar />)

    expect(document.querySelector('[data-slot="connection-bar"]')).toBeNull()
  })

  it('says the server is out of reach, checks every 10 seconds, and goes when it is back', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const backend = switchableBackend()
    const queryClient = createTestQueryClient()
    function Leads() {
      const leads = useQuery({
        queryKey: ['leads', 'bar'],
        queryFn: async ({ signal }) => unwrap(await api.GET('/lead-finder/leads', { signal })),
      })
      return <p>{leads.isSuccess ? 'Leads loaded' : 'No leads yet'}</p>
    }
    renderWithProviders(
      <>
        <ConnectionBar />
        <Leads />
      </>,
      { queryClient },
    )
    await waitFor(() => {
      expect(backend.calls).toContain('/api/v1/lead-finder/leads')
    })
    act(() => {
      connectionOf(queryClient).noteError(UNREACHABLE)
    })

    const bar = await screen.findByText("Contour can't reach its server.")
    expect(bar.closest('[data-slot="connection-bar"]')).toHaveAttribute('data-state', 'unreachable')
    expect(screen.getByText(/Checking again in \d+ seconds?\./)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try now' })).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(RETRY_EVERY_MS)
    })
    expect(healthChecks(backend.calls)).toBe(1)
    expect(screen.getByText("Contour can't reach its server.")).toBeInTheDocument()

    backend.up = true
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RETRY_EVERY_MS)
    })

    await waitFor(() => {
      expect(document.querySelector('[data-slot="connection-bar"]')).toBeNull()
    })
    expect(await screen.findByText('Leads loaded')).toBeInTheDocument()
  })

  it('checks at once on "Try now"', async () => {
    const backend = switchableBackend()
    const queryClient = createTestQueryClient()
    const { user } = renderWithProviders(<ConnectionBar />, { queryClient })
    act(() => {
      connectionOf(queryClient).noteError(UNREACHABLE)
    })
    backend.up = true

    await user.click(await screen.findByRole('button', { name: 'Try now' }))

    await waitFor(() => {
      expect(document.querySelector('[data-slot="connection-bar"]')).toBeNull()
    })
  })

  it("says you're offline, and checks the server when the browser is back online", async () => {
    const backend = switchableBackend()
    renderWithProviders(<ConnectionBar />)

    act(() => {
      onlineManager.setOnline(false)
    })
    expect(await screen.findByText("You're offline.")).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try now' })).toBeNull()

    backend.up = true
    act(() => {
      onlineManager.setOnline(true)
    })
    await waitFor(() => {
      expect(document.querySelector('[data-slot="connection-bar"]')).toBeNull()
    })
    expect(healthChecks(backend.calls)).toBe(1)
  })

  it('says Contour is updating during a deploy', async () => {
    switchableBackend()
    const queryClient = createTestQueryClient()
    renderWithProviders(<ConnectionBar />, { queryClient })

    act(() => {
      connectionOf(queryClient).set('updating')
    })

    const bar = (await screen.findByText('Contour is updating.')).closest(
      '[data-slot="connection-bar"]',
    )
    expect(bar).toHaveTextContent("It'll be back in about a minute.")
  })

  it('keeps quiet while a full error page says the same thing', async () => {
    switchableBackend()
    const queryClient = createTestQueryClient()
    renderWithProviders(
      <>
        <ConnectionBar />
        <ConnectionLostPage problem={UNREACHABLE} />
      </>,
      { queryClient },
    )

    expect(
      await screen.findByRole('heading', { level: 1, name: "Contour can't reach its server" }),
    ).toBeInTheDocument()
    expect(connectionOf(queryClient).get().state).toBe('unreachable')
    expect(document.querySelector('[data-slot="connection-bar"]')).toBeNull()
  })
})

describe('a card while the connection is down', () => {
  it('shows a quiet line, not a red box, and still has Try again', () => {
    renderWithProviders(<ErrorState error={UNREACHABLE} context="The leads couldn't be loaded." />)

    const card = screen.getByRole('status')
    expect(card).toHaveTextContent("Contour can't reach its server")
    expect(card).toHaveTextContent('The bar at the top shows when the connection is back.')
    expect(card.className).not.toContain('destructive')
    expect(within(card).getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('the full error pages', () => {
  it('Connection lost, on its own screen: checks every 10 seconds, and reloads when back', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const reload = vi.spyOn(browser, 'reload').mockImplementation(() => undefined)
    const backend = switchableBackend()
    renderWithProviders(<ConnectionLostPage problem={UNREACHABLE} standalone reloadWhenBack />)

    const page = await screen.findByRole('alert')
    expect(within(page).getByRole('heading', { level: 1 })).toHaveTextContent(
      "Contour can't reach its server",
    )
    expect(page).toHaveTextContent("Nothing you typed is lost. We'll try again every 10 seconds.")
    expect(page).toHaveTextContent(/Checking again in \d+ seconds?\./)
    expect(screen.getByRole('main')).toContainElement(page)

    backend.up = true
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RETRY_EVERY_MS)
    })

    await waitFor(() => {
      expect(reload).toHaveBeenCalledOnce()
    })
  })

  it('Connection lost: Try again asks again for the failed reads', async () => {
    const backend = switchableBackend()
    const queryClient = createTestQueryClient()
    function Leads() {
      const leads = useQuery({
        queryKey: ['leads', 'page'],
        queryFn: async ({ signal }) => unwrap(await api.GET('/lead-finder/leads', { signal })),
      })
      return leads.isSuccess ? <p>Leads loaded</p> : <ConnectionLostPage problem={UNREACHABLE} />
    }
    const { user } = renderWithProviders(<Leads />, { queryClient })
    await screen.findByRole('heading', { level: 1, name: "Contour can't reach its server" })

    backend.up = true
    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('Leads loaded')).toBeInTheDocument()
  })

  it('Updating: says it will be back in about a minute, and checks by itself', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const backend = switchableBackend()
    const queryClient = createTestQueryClient()
    renderWithProviders(<UpdatingPage standalone />, { queryClient })

    const page = await screen.findByRole('status')
    expect(within(page).getByRole('heading', { level: 1 })).toHaveTextContent('Contour is updating')
    expect(page).toHaveTextContent(
      "It'll be back in about a minute. This page will reload by itself.",
    )

    backend.up = true
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RETRY_EVERY_MS)
    })
    await waitFor(() => {
      expect(connectionOf(queryClient).get().state).toBe('online')
    })
  })

  it('a server fault: its words, Try again, and the request id to copy', async () => {
    const problem = new ApiProblem({
      title: 'Something went wrong on our side',
      detail: 'Try again. If it happens again, send this code to an admin: 7F3K92QD.',
      status: 500,
      request_id: '7F3K92QD',
    })
    const onTryAgain = vi.fn()
    const { user } = renderWithProviders(<ProblemPage problem={problem} onTryAgain={onTryAgain} />)

    const page = screen.getByRole('alert')
    expect(within(page).getByRole('heading', { level: 1 })).toHaveTextContent(
      'Something went wrong on our side',
    )
    await user.click(within(page).getByText('Details for support'))
    expect(within(page).getByText('7F3K92QD', { selector: 'dd' })).toBeInTheDocument()
    await user.click(within(page).getByRole('button', { name: 'Try again' }))
    expect(onTryAgain).toHaveBeenCalledOnce()
  })

  it.each([
    [<NoAccessPage key="403" />, "This page isn't open to you", 'Ask an admin if you need it.'],
    [<NotFoundPage key="404" />, "We can't find that", 'It may have moved or been removed.'],
  ])('%#: says what happened, with a way back to Home', (page, title, detail) => {
    renderWithProviders(page)

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(title)
    expect(screen.getByText(detail)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to Home' })).toHaveAttribute('href', '/')
  })
})
