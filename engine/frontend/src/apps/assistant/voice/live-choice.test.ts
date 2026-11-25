/**
 * Choice 7 in the voice bar's session (PLAN-V28 T3-2): an open card's ear reads the rep's own
 * words, never Gemini's; "send" or "cancel" from Gemini's words alone does nothing, and the answer
 * asks the rep to say it; a quick log from a tool call opens its card, while the free mic and
 * typing keep it; and "Sent." waits for the card's real send. Made-up names only.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { callCommand, command } from '../card/fixtures'
import { TIMES, type CardTook } from './bar-session'
import { ok, type Reply } from './live/bridge'
import { CALL_SAID, setUp, live, ear, tick } from './live/fake-session'
import {
  CARD_GONE,
  NOT_DONE,
  READY,
  SAY_CANCEL_FIRST,
  SAY_SEND_IT_FIRST,
  SENT_LINE,
} from './live/words'

beforeEach(() => {
  vi.useFakeTimers()
})

describe("choice 7: only the rep's own words send, cancel or start", () => {
  it("an open card reads the rep's words, never Gemini's request", async () => {
    const set = await live()
    const card = ear(set, () => ({ line: SENT_LINE, reply: ok(SENT_LINE) }))
    set.talk.call('call-1', 'Send the task to HubSpot now', 'Send it.')
    await tick()

    expect(card.took).toEqual(['Send it.'])
    expect(set.readings).toEqual([])
    expect(set.talk.answers).toEqual([
      { id: 'call-1', status: 'ok', retryable: false, message: SENT_LINE },
    ])
  })

  it("with none of the rep's words, the request goes to the command step, with the card", async () => {
    const set = await live()
    const card = ear(set)
    set.talk.call('call-1', 'Make it due Monday', '')

    expect(card.took).toEqual([])
    expect(set.readings[0]?.body).toMatchObject({
      text: 'Make it due Monday',
      card: { action: 'task', boxes: ['subject', 'due'] },
    })
    set.readings[0]?.answer(command({ action: 'change', read_back: 'Due Mon 30 Nov now.' }))
    await tick()
    // A change made to the card: it is ready again.
    expect(card.answered).toHaveLength(1)
    expect(set.talk.answerTo('call-1')?.message).toBe(READY)
  })

  it.each([
    ['send', SAY_SEND_IT_FIRST],
    ['cancel', SAY_CANCEL_FIRST],
  ] as const)(
    '"%s" from Gemini\'s words alone does nothing, and asks the rep to say it',
    async (action, line) => {
      const set = await live()
      const card = ear(set)
      set.talk.call('call-1', action === 'send' ? 'Send it' : 'Cancel it', 'Hmm, okay then.')
      set.readings[0]?.answer(command({ action, read_back: 'Sending it.' }))
      await tick()

      // The card's ear read the rep's words, found no send word, and the card is never told.
      expect(card.took).toEqual(['Hmm, okay then.'])
      expect(card.answered).toEqual([])
      expect(set.talk.answerTo('call-1')).toEqual({
        id: 'call-1',
        status: 'unsure',
        retryable: false,
        message: line,
      })
      expect(set.now().conversation?.line).toBe(line)
    },
  )

  it('a card that answers every turn itself (the research card) hears a call with no words', async () => {
    const set = await live()
    const asked: CardTook = {
      line: null,
      reply: { status: 'unsure', retryable: false, message: 'Say yes.' },
    }
    const card = ear(set, () => asked, { every: true })
    // "Yes" only in Gemini's request: the card reads the rep's words, none, and starts nothing.
    set.talk.call('call-1', 'Yes, start the research', '')
    await tick()

    expect(card.took).toEqual([''])
    expect(set.readings).toEqual([])
    expect(set.talk.answerTo('call-1')?.message).toBe('Say yes.')
  })

  it('a quick log from a tool call opens its card: it never sends itself', async () => {
    const { talk, readings, handed } = await live()
    talk.call('call-1', 'Log a call with Jo Sample: no answer', 'Jo, no answer')
    readings[0]?.answer(callCommand({ quick: true }))
    await tick()

    expect(handed).toHaveLength(1)
    const [given] = handed
    expect(given?.kind === 'command' && given.command.quick).toBe(false)
    expect(talk.answerTo('call-1')?.message).toBe(READY)
  })

  it('the free mic and typing keep the quick log, as before (PLAN-V25 T3-3)', async () => {
    const quick = callCommand({ quick: true })
    const spoken = setUp({ liveOn: false })
    spoken.session.start('browser_service')
    await tick(100)
    spoken.mic.say(CALL_SAID)
    await tick(TIMES.silence + 100)
    spoken.readings[0]?.answer(quick)
    await tick()

    const typed = setUp({ liveOn: false })
    typed.session.start('typing')
    typed.session.setDraft(CALL_SAID)
    typed.session.sendTyped()
    typed.readings[0]?.answer(quick)
    await tick()

    for (const set of [spoken, typed]) {
      const [given] = set.handed
      expect(given?.kind === 'command' && given.command.quick).toBe(true)
    }
    expect(spoken.talks.made).toEqual([])
  })

  it('"Sent." waits for the card\'s real send, after its hold', async () => {
    const set = await live()
    let sent: (reply: Reply) => void = () => undefined
    const later = new Promise<Reply>((settle) => {
      sent = settle
    })
    ear(set, () => ({ line: SENT_LINE, reply: later }))
    set.talk.call('call-1', 'Send it', 'Send it.')
    await tick(4900)

    expect(set.talk.answers).toEqual([])
    sent(ok(SENT_LINE))
    await tick()
    expect(set.talk.answers).toEqual([
      { id: 'call-1', status: 'ok', retryable: false, message: SENT_LINE },
    ])
  })

  it('a card whose answer fails is said as not done, never as sent', async () => {
    const set = await live()
    ear(set, () => ({ line: SENT_LINE, reply: Promise.reject(new Error('gone')) }))
    set.talk.call('call-1', 'Send it', 'Send it.')
    await tick()

    expect(set.talk.answers).toEqual([
      { id: 'call-1', status: 'error', retryable: true, message: NOT_DONE },
    ])
  })

  it('the card closed while the turn was read: says so', async () => {
    const set = await live()
    const card = ear(set)
    set.talk.call('call-1', 'Make it due Monday', '')
    card.release()
    set.world.shown = null
    set.readings[0]?.answer(command({ action: 'change' }))
    await tick()

    expect(card.answered).toEqual([])
    expect(set.talk.answerTo('call-1')?.message).toBe(CARD_GONE)
  })
})
