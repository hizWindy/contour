/**
 * Asking back and talking over (PLAN-V28 T3-3): the rep's answer to Claude's question goes to the
 * card's ear; a tool call Google cancels stops its command request, is never answered, and opens
 * nothing late. Made-up names only.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { command, taskCommand } from '../card/fixtures'
import { TASK_WORDS, live, ear, tick } from './live/fake-session'
import { READY } from './live/words'

beforeEach(() => {
  vi.useFakeTimers()
})

describe('asking back and talking over (T3-3)', () => {
  it("the rep's answer to Claude's question goes to the card's ear", async () => {
    const set = await live()
    const card = ear(set, (words) => (words === 'The first one.' ? { line: null } : null))
    set.talk.call('call-1', 'Jo Sample, the first one', 'The first one.')
    await tick()

    expect(card.took).toEqual(['The first one.'])
    expect(set.readings).toEqual([])
    expect(set.talk.answerTo('call-1')?.message).toBe(READY)
  })

  it('a call Google cancels stops its request, is never answered, and opens nothing late', async () => {
    const { talk, readings, handed, now } = await live()
    talk.call('call-1', TASK_WORDS, TASK_WORDS)
    talk.cancel('call-1')

    expect(readings[0]?.signal.aborted).toBe(true)
    expect(now().conversation?.working).toBeNull()
    readings[0]?.answer(taskCommand())
    await tick()
    expect(handed).toEqual([])
    expect(talk.answers).toEqual([])

    // The talk goes on: the next call is read.
    talk.call('call-2', 'Open Northwind', 'Open Northwind')
    expect(readings).toHaveLength(2)
  })

  it('a call cancelled while it waits its turn never goes', async () => {
    const { talk, readings } = await live()
    talk.call('call-1', TASK_WORDS, TASK_WORDS)
    talk.call('call-2', 'Open Northwind', 'Open Northwind')
    talk.cancel('call-2')
    readings[0]?.answer(command({ action: 'open', read_back: 'Opening Sample Logistics.' }))
    await tick()

    expect(readings.map((one) => one.body.text)).toEqual([TASK_WORDS])
    expect(talk.answers.map((answer) => answer.id)).toEqual(['call-1'])
  })

  it('a cancel that comes after the answer changes nothing', async () => {
    const { talk, readings } = await live()
    talk.call('call-1', 'Open Northwind', 'Open Northwind')
    readings[0]?.answer(command({ action: 'open', read_back: 'Opening Northwind.' }))
    await tick()
    talk.cancel('call-1')

    expect(talk.answers).toHaveLength(1)
    expect(talk.stopped).toBe(false)
  })
})
