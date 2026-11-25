/**
 * The Activity page's words for a changed account (PLAN-V26 T3-3). Live voice is paid by the
 * minute, so a change to a person's switch is named, like any other field (PLAN-V28 T1-1; found
 * by merge v28's review).
 */
import { describe, expect, it } from 'vitest'
import type { SignInItem } from '@/api/hooks/activity'
import { eventWords } from './activity-words'

function changed(details: SignInItem['details']): SignInItem {
  return {
    id: 1,
    at: '2026-11-25T09:00:00Z',
    event: 'account_changed',
    ip: null,
    device: null,
    details,
  }
}

describe("the Activity page's words for a changed account", () => {
  it('names the live voice switch', () => {
    expect(eventWords(changed({ fields: ['live_voice'], live_voice: true }))).toBe(
      'Changed: live voice',
    )
  })

  it('names it with the other fields, in the order the log keeps', () => {
    expect(eventWords(changed({ fields: ['live_voice', 'position'] }))).toBe(
      'Changed: live voice, position',
    )
  })
})
