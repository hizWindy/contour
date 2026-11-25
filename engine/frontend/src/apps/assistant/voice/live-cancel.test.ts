/**
 * Asking back and talking over (PLAN-V28 T3-3): the rep's answer to Claude's question goes to the
 * card's ear; a tool call Google cancels stops its command request, is never answered, and opens
 * nothing late. Made-up names only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { command, taskCommand } from '../card/fixtures'
import { handOver, preReadPath } from './hand-over'
import { TASK_WORDS, live, ear, tick } from './live/fake-session'
import { READY } from './live/words'
import { closeVoiceBar, openVoiceBar } from './store'

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

describe('a pre-read starting for a tool call Google cancels (T3-3)', () => {
  /** "Draft the pre-read for my Sample Logistics meeting": the meeting has none yet. */
  const PRE_READ = command({
    action: 'pre_read',
    read_back: 'Draft the pre-read for Fit-out walkthrough.',
    meeting: {
      found: {
        id: 'meeting-1',
        title: 'Fit-out walkthrough',
        starts_at: '2026-11-27T09:00:00+11:00',
        company_key: '201',
        company_name: 'Sample Logistics Pty Ltd',
        form: null,
      },
      choices: [],
      from_page: false,
      heard: 'my Sample Logistics meeting',
    },
  })

  /** The bar with the real hand-over, a pre-read start the test ends, and the pages opened. */
  async function preRead() {
    const went: string[] = []
    const signals: (AbortSignal | undefined)[] = []
    let started: (form: { id: string }) => void = () => undefined
    const set = await live({
      hand: (heard, _said, signal) =>
        handOver(heard, {
          go: (to) => {
            went.push(to)
          },
          start: (_, given) => {
            signals.push(given)
            return new Promise((resolve) => {
              started = resolve
            })
          },
          ...(signal ? { signal } : {}),
        }),
    })
    // The bar is open while the talk goes on.
    openVoiceBar()
    set.talk.call('call-1', 'Draft the pre-read for my Sample Logistics meeting', 'Pre-read.')
    set.readings[0]?.answer(PRE_READ)
    await tick()
    return { ...set, went, signals, start: (id: string) => started({ id }) }
  }

  afterEach(() => {
    closeVoiceBar()
  })

  it('opens nothing, and its start is stopped', async () => {
    const set = await preRead()
    set.talk.cancel('call-1')
    set.start('form-1')
    await tick()

    expect(set.signals[0]?.aborted).toBe(true)
    expect(set.went).toEqual([])
    expect(set.talk.answers).toEqual([])
  })

  it("opens its page when it isn't cancelled", async () => {
    const set = await preRead()
    set.start('form-1')
    await tick()

    expect(set.signals[0]?.aborted).toBe(false)
    expect(set.went).toEqual([preReadPath('form-1')])
    expect(set.talk.answerTo('call-1')?.status).toBe('ok')
  })
})
