/**
 * Call logs keeps a follow-up's teammate through its own edits (PLAN-V23 T3-4). Someone with no
 * HubSpot user picks the teammate on the review card; an edit here sends the whole list again, so
 * each follow-up goes back with its teammate's id, found by name in the team list. At a laptop's
 * width (1440px) and a phone's (390px). Made-up names only.
 */
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { SignIn } from '@/api/hooks/auth'
import { queryKeys } from '@/api/query'
import type { CallNotePatch } from '@/api/types'
import { FOLLOW_UP, note, options, SAM, SAM_TOO } from '@/apps/assistant/card/fixtures'
import { mockApi } from '@/test/mock-api'
import { createTestQueryClient, renderWithProviders } from '@/test/render'
import { asLaptop, asPhone } from '@/test/screen'
import { NoteCard } from './note-card'

function signedIn(hubspot: 'none' | 'linked'): SignIn {
  return {
    state: 'signed_in',
    user: {
      id: '22222222-3333-4444-5555-666666666666',
      email: 'jo@example.test',
      username: 'jo',
      name: 'Jo Sample',
      position: 'Designer',
      role: 'staff',
      apps: ['companies'],
      features: ['companies.call_logs', 'companies.meetings'],
      hubspot,
    },
  }
}

function openCard(hubspot: 'none' | 'linked') {
  mockApi({ '/api/v1/companies/team': [SAM, SAM_TOO] })
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(queryKeys.auth.me(), signedIn(hubspot))
  const edit = vi.fn()
  const view = renderWithProviders(
    <NoteCard
      note={note({ tasks: [{ ...FOLLOW_UP, owner: 'Sam Example' }] })}
      options={options()}
      today="2026-11-19"
      active
      editing
      landing={null}
      onActivate={() => undefined}
      onEditing={() => undefined}
      onToggleLeftOut={() => undefined}
      onRemove={() => undefined}
      edit={edit}
    />,
    { queryClient },
  )
  return { ...view, edit }
}

describe.each([
  ['a laptop (1440px)', asLaptop],
  ['a phone (390px)', asPhone],
])('a follow-up’s teammate on Call logs, on %s', (_width, size) => {
  it('goes back with the follow-up when it is changed here', async () => {
    size()
    const { user, edit, queryClient } = openCard('none')
    expect(screen.getByText('For Sam Example')).toBeInTheDocument()
    // The team list is in before the edit.
    await waitFor(() => {
      expect(queryClient.getQueryData(queryKeys.companies.team())).toEqual([SAM, SAM_TOO])
    })
    const what = screen.getByRole('textbox', { name: 'Follow-up 1: what to do' })
    await user.clear(what)
    await user.type(what, 'Send Jo three options{Enter}')
    await waitFor(() => {
      expect(edit).toHaveBeenCalled()
    })
    const patch = edit.mock.calls.at(-1)?.[0] as CallNotePatch
    expect(patch.tasks?.[0]).toMatchObject({ subject: 'Send Jo three options', owner_id: 'o-3' })
  })
})

describe('a follow-up’s teammate on Call logs, for a linked account', () => {
  it('asks for no team list, and sends the list as before', async () => {
    const { user, edit } = openCard('linked')
    const what = within(screen.getByRole('region', { name: 'Follow-ups' })).getByRole('textbox', {
      name: 'Follow-up 1: what to do',
    })
    await user.clear(what)
    await user.type(what, 'Send Jo three options{Enter}')
    await waitFor(() => {
      expect(edit).toHaveBeenCalled()
    })
    const patch = edit.mock.calls.at(-1)?.[0] as CallNotePatch
    expect(patch.tasks?.[0]).not.toHaveProperty('owner_id')
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })
})
