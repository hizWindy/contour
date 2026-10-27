import { screen } from '@testing-library/react'
import { Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { BackButton } from './back-button'

function Pages() {
  return (
    <Routes>
      <Route path="/results" element={<p>The list</p>} />
      <Route
        path="/leads/:id"
        element={
          <>
            <BackButton fallbackTo="/results" fallbackLabel="Results" />
            <p>The lead</p>
          </>
        }
      />
    </Routes>
  )
}

describe('the back button', () => {
  it('goes back to the page the person came from', async () => {
    const { user } = renderWithProviders(<Pages />, {
      initialEntries: ['/results?city=Perth', '/leads/1'],
    })
    expect(screen.getByText('The lead')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Back' }))

    expect(await screen.findByText('The list')).toBeInTheDocument()
  })

  it('links to the list, and says so, when the page was opened directly', () => {
    renderWithProviders(<Pages />, { initialEntries: ['/leads/1'] })

    const link = screen.getByRole('link', { name: 'Back to Results' })
    expect(link).toHaveAttribute('href', '/results')
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
  })
})
