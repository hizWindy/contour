import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { App } from '@/App'
import { renderWithProviders } from './render'

describe('App shell placeholder', () => {
  it('renders the app name as the page title', () => {
    renderWithProviders(<App />)

    expect(screen.getByRole('heading', { level: 1, name: 'Lead Finder' })).toBeInTheDocument()
  })
})
