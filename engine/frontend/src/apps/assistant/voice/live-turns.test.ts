/**
 * A tool call is a turn of the voice bar's conversation (PLAN-V28 T3-1), with a fake talk, a fake
 * command step, the fake mic and a fake clock: in order; the command step reads Gemini's request,
 * with what is on screen, as the free mic sends it; each call is answered once, never empty; and a
 * refused command answers with its plain words while the talk goes on. Made-up names only.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProblem } from '@/api/client'
import { callCommand, command, taskCommand } from '../card/fixtures'
import { TASK_WORDS, live, ear, tick } from './live/fake-session'
import { IN_A_NOTE, READY } from './live/words'

beforeEach(() => {
  vi.useFakeTimers()
})

describe('a tool call is a turn (T3-1)', () => {
  it("sends Gemini's request to the command step, with what is on screen, as the free mic does", async () => {
    const { talk, readings } = await live()
    talk.call('call-1', TASK_WORDS, 'add a task to send sample logistics the quote on friday')

    expect(readings.map((one) => one.body)).toEqual([
      { text: TASK_WORDS, source: 'mic', on_page: { company_key: '201' } },
    ])
  })

  it('answers "Ready. Say send it." once its card opens, once', async () => {
    const { talk, readings } = await live()
    talk.call('call-1', TASK_WORDS, TASK_WORDS)
    readings[0]?.answer(taskCommand())
    await tick()

    expect(talk.answers).toEqual([{ id: 'call-1', status: 'ok', retryable: false, message: READY }])
  })

  it("asks Claude's question back while it is unsure (T3-3)", async () => {
    const { talk, readings } = await live()
    talk.call('call-1', 'Log a call with Jo', 'Log a call with Jo')
    readings[0]?.answer(callCommand({ unsure: 'Jo Sample or Jo Northwind?' }))
    await tick()

    expect(talk.answerTo('call-1')).toEqual({
      id: 'call-1',
      status: 'unsure',
      retryable: false,
      message: 'Jo Sample or Jo Northwind?',
    })
  })

  it('says the line a page opened with', async () => {
    const line = 'Opening the lead card for Northwind.'
    const { talk, readings } = await live({
      hand: (_, said) => {
        said?.(line)
        return { kind: 'close' }
      },
    })
    talk.call('call-1', 'Research Northwind', 'Research Northwind')
    readings[0]?.answer(command({ action: 'research', read_back: line }))
    await tick()

    expect(talk.answerTo('call-1')?.message).toBe(line)
  })

  it('works the calls out in order: the next waits for the one before, and its card', async () => {
    const set = await live()
    const { talk, readings } = set
    talk.call('call-1', TASK_WORDS, TASK_WORDS)
    talk.call('call-2', 'Make it due Monday', 'Make it due Monday')

    expect(readings).toHaveLength(1)
    readings[0]?.answer(taskCommand())
    await tick()
    // The task's card is on its way: the next turn waits for it, to be read by it first.
    expect(readings).toHaveLength(1)
    const card = ear(set)
    await tick()

    expect(card.took).toEqual(['Make it due Monday'])
    expect(readings.map((one) => one.body.text)).toEqual([TASK_WORDS, 'Make it due Monday'])
    expect(readings[1]?.body.card).toEqual({ action: 'task', boxes: ['subject', 'due'] })
  })

  it("answers with the command step's plain words when it says no, and the talk goes on", async () => {
    const { talk, readings, now } = await live()
    talk.call('call-1', TASK_WORDS, TASK_WORDS)
    readings[0]?.refuse(
      new ApiProblem({
        title: 'Contour is busy',
        detail: 'Try again in a few seconds.',
        status: 503,
        code: 'busy',
      }),
    )
    await tick()

    expect(talk.answerTo('call-1')).toEqual({
      id: 'call-1',
      status: 'error',
      retryable: true,
      message: 'Contour is busy. Try again in a few seconds.',
    })
    expect(talk.stopped).toBe(false)
    expect(now().phase).toBe('listening')
    expect(now().conversation?.line).toBe('Contour is busy. Try again in a few seconds.')
  })

  it("puts the rep's own words in a new call note with the AI off", async () => {
    const { talk, readings, handed } = await live()
    talk.call('call-1', 'Log a call with Jo Sample: she wants a quote', 'Jo wants a quote')
    readings[0]?.refuse(new ApiProblem({ title: 'Off', status: 409, code: 'assistant_off' }))
    await tick()

    expect(handed).toEqual([{ kind: 'dictation', words: 'Jo wants a quote', source: 'mic' }])
    expect(talk.answerTo('call-1')?.message).toBe(IN_A_NOTE)
  })
})
