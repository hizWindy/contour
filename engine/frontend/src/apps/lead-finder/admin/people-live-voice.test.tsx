/**
 * Edit person's live voice switch (PLAN-V28 T1-1), against the generated contract and a fake
 * server, at a laptop's width (1440 px) and a phone's (390 px): "Live voice (paid by the minute)",
 * which the Platform admin sets for each person (this tab is theirs alone), off to start, saved at
 * once. And Settings places its monthly limit in Money, with the other US$ limits. Made-up names
 * only.
 */
import { screen, waitFor, within } from '@testing-library/react'
import { toast } from 'sonner'
import { afterEach, describe, expect, it } from 'vitest'
import type { Person } from '@/api/hooks'
import { mockApi, type Call } from '@/test/mock-api'
import { renderWithProviders } from '@/test/render'
import { asLaptop, asPhone } from '@/test/screen'
import AdminPeopleTab from './people'
import { groupOf } from './settings-groups'

const ID = 'bbbbbbbb-2222-3333-4444-555555555555'

const JO: Person = {
  id: ID,
  name: 'Jo Sample',
  email: 'jo@example.test',
  username: 'jsample',
  position: null,
  role: 'staff',
  apps: ['companies'],
  features: ['companies.call_logs'],
  active: true,
  created_at: '2026-11-05T00:00:00Z',
  last_signed_in_at: null,
  hubspot_owner: null,
  hubspot: 'none',
  live_voice: false,
}

function servePeople(person: Person): Call[] {
  let now = person
  return mockApi({
    '/api/v1/auth/me': { auth_required: false, user: null, session: null },
    '/api/v1/hubspot/owners': { owners: [] },
    '/api/v1/people': () => Response.json([now]),
    [`/api/v1/people/${ID}`]: (call: Call) => {
      if (call.method !== 'PATCH') return undefined
      now = { ...now, ...(call.body as Partial<Person>) }
      return Response.json(now)
    },
  })
}

afterEach(() => {
  toast.dismiss()
})

describe.each([
  ['1440 px (a laptop)', asLaptop],
  ['390 px (a phone)', asPhone],
])('at %s', (_, width) => {
  describe('Edit person: live voice (T1-1)', () => {
    it('is off to start, and the Platform admin turns it on for one person, at once', async () => {
      width()
      const calls = servePeople(JO)
      const { user } = renderWithProviders(<AdminPeopleTab />)
      await user.click(await screen.findByRole('button', { name: 'Edit Jo Sample' }))
      const sheet = await screen.findByRole('dialog')
      const live = within(sheet).getByRole('switch', { name: /Live voice \(paid by the minute\)/ })

      expect(live).not.toBeChecked()
      await user.click(live)
      await waitFor(() => {
        expect(calls.filter((call) => call.method === 'PATCH').map((call) => call.body)).toEqual([
          { live_voice: true },
        ])
      })
      expect(await screen.findByText('Live voice is on for Jo Sample.')).toBeInTheDocument()
      await waitFor(() => {
        expect(
          within(sheet).getByRole('switch', { name: /Live voice \(paid by the minute\)/ }),
        ).toBeChecked()
      })
    })

    it('turns off again, for a person it is on for', async () => {
      width()
      const calls = servePeople({ ...JO, live_voice: true })
      const { user } = renderWithProviders(<AdminPeopleTab />)
      await user.click(await screen.findByRole('button', { name: 'Edit Jo Sample' }))
      const sheet = await screen.findByRole('dialog')
      const live = within(sheet).getByRole('switch', { name: /Live voice \(paid by the minute\)/ })

      expect(live).toBeChecked()
      await user.click(live)
      await waitFor(() => {
        expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({ live_voice: false })
      })
      expect(await screen.findByText('Live voice is off for Jo Sample.')).toBeInTheDocument()
    })

    it('reads an account from before PLAN-V28, with no switch saved, as off', async () => {
      width()
      const older: Person = { ...JO }
      delete older.live_voice
      servePeople(older)
      const { user } = renderWithProviders(<AdminPeopleTab />)
      await user.click(await screen.findByRole('button', { name: 'Edit Jo Sample' }))
      const sheet = await screen.findByRole('dialog')

      expect(
        within(sheet).getByRole('switch', { name: /Live voice \(paid by the minute\)/ }),
      ).not.toBeChecked()
    })
  })
})

describe('Settings places the monthly limit', () => {
  it('in Money, with the other US$ limits', () => {
    expect(groupOf('live_voice_month_cap_usd')).toBe('money')
    expect(groupOf('run_cap_usd')).toBe('money')
  })
})
