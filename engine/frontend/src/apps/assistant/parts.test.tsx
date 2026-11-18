/**
 * The Assistant's parts around the app load late (`parts.ts`, PLAN-V17 T3-7 and T3-11, moved from
 * Companies in PLAN-V22 T2-1). If their files can't be downloaded, as when an old file is gone
 * after a deploy, each part draws nothing and the menu, Home and Ctrl+K go on as before call notes
 * and meetings. Here the files' downloads always fail.
 */
import { screen, waitFor } from '@testing-library/react'
import { Suspense } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import {
  AssistantCommands,
  CallNoteButtons,
  MicCheckHost,
  MicCheckMenuItem,
  ToConfirmCount,
  UpcomingMeetings,
} from './parts'

vi.mock('./links', () => {
  throw new Error('Failed to fetch dynamically imported module')
})

vi.mock('@/apps/companies/meetings/upcoming-card', () => {
  throw new Error('Failed to fetch dynamically imported module')
})

describe('an Assistant part whose file is gone', () => {
  it('draws nothing, and the rest of the page stays', async () => {
    const go = vi.fn()
    renderWithProviders(
      <>
        <p>The rest of the page</p>
        <Suspense fallback={<p>Still loading</p>}>
          <ToConfirmCount />
          <CallNoteButtons />
          <AssistantCommands go={go} run={go} />
          <UpcomingMeetings />
          <MicCheckMenuItem />
          <MicCheckHost />
        </Suspense>
      </>,
    )
    // The download fails, and each part settles on nothing: no error, and no waiting forever.
    await waitFor(() => {
      expect(screen.queryByText('Still loading')).toBeNull()
    })
    expect(screen.getByText('The rest of the page')).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.queryByRole('region', { name: 'Upcoming meetings' })).toBeNull()
    expect(go).not.toHaveBeenCalled()
  })
})
