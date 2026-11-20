/**
 * Smart pauses (PLAN-V24 choice 8, T2-2): which words sound unfinished, so the turn waits the long
 * pause. The session's own timing is in `conversation.test.ts`.
 */
import { describe, expect, it } from 'vitest'
import { pauseFor, soundsUnfinished } from './pauses'

const TIMES = { pause: 1200, longPause: 3000 }

describe('words that sound unfinished wait the long pause', () => {
  it.each([
    'Log a call with',
    'Log a call with, um',
    'Add a task for',
    'Email Sam that',
    'Make the pre-read for my meeting with the',
    'Log a call',
    'um, log a call',
    'Add a task',
    'Email',
    'Spoke to Jo Sample and',
    'um',
  ])('"%s"', (said) => {
    expect(soundsUnfinished(said)).toBe(true)
    expect(pauseFor(said, TIMES)).toBe(TIMES.longPause)
  })
})

describe('words that sound finished end after the short one', () => {
  it.each([
    'Log a call with Northwind',
    'Log a call with Jo Sample at Sample Logistics, they move in March',
    'Add a task to send the quote on Friday',
    'Open today',
    'Send it',
    'Make the follow-up Monday',
  ])('"%s"', (said) => {
    expect(soundsUnfinished(said)).toBe(false)
    expect(pauseFor(said, TIMES)).toBe(TIMES.pause)
  })

  it('no words at all is no turn: the short pause', () => {
    expect(soundsUnfinished('')).toBe(false)
  })
})
