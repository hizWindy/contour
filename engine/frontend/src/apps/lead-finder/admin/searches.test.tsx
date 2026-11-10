import { screen, within } from '@testing-library/react'
import { Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'
import { mockApi, TEST_RUN_ID } from '@/test/mock-api'
import { renderWithProviders } from '@/test/render'
import AdminSearchesTab from './searches'

describe('Admin, Search log', () => {
  it('shows one run when asked, and what a request searched', async () => {
    const calls = mockApi({
      '/api/v1/searches': {
        total: 1,
        items: [
          {
            id: 's1',
            app: 'lead_finder',
            job_id: null,
            run_id: TEST_RUN_ID,
            subject: 'Acme Software',
            step: 'search:property',
            model: 'claude-opus-5-5',
            prompt_version: 'p1',
            queries: ['acme lease melbourne'],
            sources: [{ url: 'https://www.afr.com/a', title: 'Acme moves', page_age: null }],
            web_searches: 2,
            web_fetches: 1,
            input_tokens: 20000,
            output_tokens: 1000,
            cache_read_tokens: 0,
            cache_write_tokens: 0,
            cost_usd: '0.120000',
            stop_reason: 'end_turn',
            answer_ok: true,
            note: null,
            created_at: '2026-10-26T04:00:00Z',
          },
        ],
      },
    })
    const { user } = renderWithProviders(
      <Routes>
        <Route path="/admin/searches" element={<AdminSearchesTab />} />
      </Routes>,
      { route: `/admin/searches?run_id=${TEST_RUN_ID}` },
    )
    expect(await screen.findByText(/Showing the requests of run 0f3c9a2e/)).toBeInTheDocument()
    expect(calls[0]?.search).toContain(`run_id=${TEST_RUN_ID}`)
    await user.click(await screen.findByText('search:property'))
    // The details open in a side panel, so they never sit below a long table.
    const panel = await screen.findByRole('dialog', { name: 'search:property' })
    expect(within(panel).getByText('Acme Software')).toBeInTheDocument()
    expect(await within(panel).findByText('acme lease melbourne')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Acme moves/ })).toHaveAttribute(
      'rel',
      'noopener noreferrer nofollow',
    )
  })
})
