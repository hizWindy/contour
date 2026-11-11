import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { mockApi } from '@/test/mock-api'
import { renderWithProviders } from '@/test/render'
import AdminMemoryTab from './memory'

describe('Admin, Memory', () => {
  it('searches memory and shows the closest first', async () => {
    const calls = mockApi({
      '/api/v1/memory/search': [
        {
          id: 'm1',
          app: 'lead_finder',
          kind: 'source_note',
          content: "Acme's lease ends in 2028.",
          subject: 'Acme Software',
          url: 'https://www.afr.com/a',
          similarity: 0.83,
          source_date: '2026-10-01',
          created_at: '2026-10-02T00:00:00Z',
          meta: {},
        },
      ],
    })
    const { user } = renderWithProviders(<AdminMemoryTab />)
    await user.type(screen.getByLabelText('Search memory'), 'lease 2028')
    await user.click(screen.getByRole('button', { name: 'Search' }))
    expect(await screen.findByText("Acme's lease ends in 2028.")).toBeInTheDocument()
    expect(screen.getByText('83% close')).toBeInTheDocument()
    // A short list: one row each, with its source.
    const row = screen.getByRole('listitem')
    expect(row).toHaveTextContent('Acme Software')
    expect(row.querySelector('a')).toHaveAttribute('href', 'https://www.afr.com/a')
    expect(new URLSearchParams(calls.at(-1)?.search).get('q')).toBe('lease 2028')
  })
})
