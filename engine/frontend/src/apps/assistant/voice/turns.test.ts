/**
 * The words a conversation reads itself, with no AI (PLAN-V24 choices 10 and 11, T2-1): the end
 * words, as a whole turn only, and short turns of fewer than 2 real words.
 */
import { describe, expect, it } from 'vitest'
import { endsConversation, isShortTurn, realWordsIn } from './turns'

describe('the end words', () => {
  it.each([
    'stop listening',
    'Stop listening.',
    "That's all.",
    'that’s all',
    'Okay, that’s all, thanks',
    "that's all, thank you",
    'Um, stop.',
    "That's it",
  ])('"%s" ends the conversation', (said) => {
    expect(endsConversation(said)).toBe(true)
  })

  it.each([
    "Don't stop listening yet",
    'Stop the follow-up on Friday',
    "That's all for Sample Logistics, log the call",
    'Send it',
    '',
  ])('"%s" doesn’t', (said) => {
    expect(endsConversation(said)).toBe(false)
  })
})

describe('short turns', () => {
  it.each(['', 'um', 'Um.', 'Hmm, uh', 'Monday', 'yes'])('"%s" is short', (said) => {
    expect(isShortTurn(said)).toBe(true)
  })

  it.each(['Open today', 'um, open today', 'Send it'])('"%s" isn’t', (said) => {
    expect(isShortTurn(said)).toBe(false)
  })

  it('counts words, not sounds', () => {
    expect(realWordsIn('Um, log a call, uh, with Jo')).toEqual(['log', 'a', 'call', 'with', 'jo'])
  })
})
