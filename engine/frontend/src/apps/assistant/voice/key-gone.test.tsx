/**
 * The voice bar's file can't be downloaded (an old file gone after a deploy, PLAN-V22 T3-1): V
 * shows nothing, the bar closes again, and the page goes on. Each later V tries again and closes
 * again, so the bar is never stuck open with nothing on screen.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { queryKeys } from '@/api/query'
import { createTestQueryClient, renderWithProviders } from '@/test/render'
import { VoiceKey } from './key'
import { closeVoiceBar, isVoiceBarOpen } from './store'

vi.mock('./bar', () => {
  throw new Error('Failed to fetch dynamically imported module')
})

afterEach(() => {
  act(() => {
    closeVoiceBar()
  })
})

describe('a voice bar whose file is gone', () => {
  it('closes again on each V, and the rest of the page stays', async () => {
    const queryClient = createTestQueryClient()
    queryClient.setQueryData(queryKeys.auth.me(), { state: 'off' })
    renderWithProviders(
      <>
        <p>The rest of the page</p>
        <VoiceKey />
      </>,
      { queryClient },
    )
    // The first V opens it while the file is fetched, and the failed fetch closes it again.
    fireEvent.keyDown(document.body, { key: 'v' })
    expect(isVoiceBarOpen()).toBe(true)
    await waitFor(() => {
      expect(isVoiceBarOpen()).toBe(false)
    })
    // Each later V is taken again (so the bar wasn't stuck open), and closes again at once.
    for (let press = 0; press < 2; press += 1) {
      expect(fireEvent.keyDown(document.body, { key: 'v' })).toBe(false)
      expect(isVoiceBarOpen()).toBe(false)
    }
    expect(screen.getByText('The rest of the page')).toBeInTheDocument()
  })
})
