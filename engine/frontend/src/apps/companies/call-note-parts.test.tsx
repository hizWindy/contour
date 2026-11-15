/**
 * Call notes around the app load late (`call-note-parts.ts`, PLAN-V17 T3-7). If their file can't
 * be downloaded, as when an old file is gone after a deploy, each part draws nothing and the menu,
 * Home and Ctrl+K go on as before call notes. Here the file's download always fails.
 */
import { screen, waitFor } from '@testing-library/react'
import { Suspense } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { CallNoteButtons, CallNoteCommands, ToConfirmCount } from './call-note-parts'

vi.mock('./call-note-links', () => {
  throw new Error('Failed to fetch dynamically imported module')
})

describe('a call notes part whose file is gone', () => {
  it('draws nothing, and the rest of the page stays', async () => {
    const go = vi.fn()
    renderWithProviders(
      <>
        <p>The rest of the page</p>
        <Suspense fallback={<p>Still loading</p>}>
          <ToConfirmCount />
          <CallNoteButtons />
          <CallNoteCommands go={go} />
        </Suspense>
      </>,
    )
    // The download fails, and each part settles on nothing: no error, and no waiting forever.
    await waitFor(() => {
      expect(screen.queryByText('Still loading')).toBeNull()
    })
    expect(screen.getByText('The rest of the page')).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
    expect(go).not.toHaveBeenCalled()
  })
})
