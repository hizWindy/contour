/**
 * The order of the projects in Ctrl+K while something is typed (`command-order.ts`, PLAN-V22
 * T2-1): the project whose page matches best comes first, because the menu never sorts the
 * projects itself and Enter takes the first entry that matches at all.
 */
import { describe, expect, it } from 'vitest'
import type { SignIn } from '@/api/hooks/auth'
import { MODULES } from '@/modules'
import { byBestMatch } from './command-order'

const OFF: SignIn = { state: 'off' }

const names = (search: string, signIn: SignIn = OFF): string[] =>
  byBestMatch(MODULES, signIn, search).map((module) => module.name)

describe("Ctrl+K's projects, while something is typed", () => {
  it('keep the menu order while nothing is typed', () => {
    expect(names('')).toEqual(['Companies', 'Assistant', 'Lead Finder'])
    expect(names('   ')).toEqual(['Companies', 'Assistant', 'Lead Finder'])
  })

  it('put the project with the best page first', () => {
    // Results has "csv" among its words; Call logs only brushes past the letters.
    expect(names('csv')[0]).toBe('Lead Finder')
    expect(names('call logs')[0]).toBe('Assistant')
    expect(names('activity')[0]).toBe('Assistant')
    expect(names('prep')[0]).toBe('Companies')
  })

  it('keep the menu order for a tie', () => {
    // Nothing matches anywhere: every project scores 0.
    expect(names('zzzz')).toEqual(['Companies', 'Assistant', 'Lead Finder'])
  })

  it('count only the pages this person may see', () => {
    const meetingsOnly: SignIn = {
      state: 'signed_in',
      user: {
        id: '11111111-2222-3333-4444-555555555555',
        name: 'Jo Sample',
        position: null,
        email: 'jo@example.test',
        username: 'jo',
        role: 'staff',
        apps: ['companies'],
        features: ['companies.meetings'],
      },
    }
    // "activity" is Call logs' word, and Call logs isn't theirs: Meetings scores nothing for it.
    const order = byBestMatch(MODULES, meetingsOnly, 'activity')
    expect(order.map((module) => module.name)).toEqual(['Companies', 'Assistant', 'Lead Finder'])
  })
})
