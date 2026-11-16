/**
 * A Home card that comes late (`HomeCard.late`, PLAN-V17 T3-11), like Companies' "Upcoming
 * meetings", never holds Home up: while its code is on its way (here, for ever), the rest of Home
 * shows, and the card takes no place in the grid.
 */
import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { queryKeys } from '@/api/query'
import { mockApi } from '@/test/mock-api'
import { createTestQueryClient, renderWithProviders } from '@/test/render'
import HomePage from './home'

// The card's file never arrives.
vi.mock('@/apps/companies/meetings/upcoming-card', () => new Promise(() => undefined))

describe('a late Home card', () => {
  it('never holds Home up while its code is on its way', async () => {
    mockApi({})
    const queryClient = createTestQueryClient()
    queryClient.setQueryData(queryKeys.auth.me(), { state: 'off' })
    renderWithProviders(<HomePage />, { queryClient })
    expect(await screen.findByRole('region', { name: 'Relationships' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Runs and cost' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Upcoming meetings' })).toBeNull()
    // Its place in the grid is empty, so it is taken out of the flow (`empty:hidden`).
    const grid = screen.getByRole('region', { name: 'Runs and cost' }).closest('.grid')
    const last = grid?.lastElementChild
    expect(last?.className).toContain('empty:hidden')
    expect(last?.childElementCount).toBe(0)
  })
})
