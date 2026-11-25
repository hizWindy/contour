/**
 * How a live talk ends by the rep's words (PLAN-V28 T3-4): "that's all" or "stop listening" as the
 * rep's whole turn ends it and closes the relay; in Gemini's words alone, or inside a longer turn,
 * it doesn't. V, Stop, Esc, the quiet stop and a phone leaving the page: live-session.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { taskCommand } from '../card/fixtures'
import { TASK_WORDS, live, tick } from './live/fake-session'

beforeEach(() => {
  vi.useFakeTimers()
})

describe('how a talk ends (T3-4)', () => {
  it.each(["That's all.", 'Stop listening'])(
    '"%s" as the rep\'s whole turn ends it, closes the relay and the bar',
    async (words) => {
      const { talk, onClose } = await live()
      talk.turn(words)

      expect(talk.stopped).toBe(true)
      expect(onClose).toHaveBeenCalledTimes(1)
    },
  )

  it('ends after the turn the command step is working out: it still opens its card', async () => {
    const { talk, readings, handed } = await live()
    talk.call('call-1', TASK_WORDS, TASK_WORDS)
    talk.turn("That's all.")

    expect(talk.stopped).toBe(true)
    readings[0]?.answer(taskCommand())
    await tick()
    expect(handed).toHaveLength(1)
  })

  it("never ends on Gemini's words alone, or on end words inside a longer turn", async () => {
    const { talk, readings } = await live()
    talk.call('call-1', "That's all", '')
    talk.turn("That's all for the quote, thanks Jo.")

    expect(talk.stopped).toBe(false)
    expect(readings.map((one) => one.body.text)).toEqual(["That's all"])
  })
})
