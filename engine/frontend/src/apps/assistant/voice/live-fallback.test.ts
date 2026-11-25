/**
 * The free mic takes over from live voice (PLAN-V28 T4-1): each cause, with its line; the words no
 * tool call took go to the text line; typing where no free engine runs; and the next V tries live
 * voice again, but after the month's limit, until the server's Retry-After or the Melbourne month
 * changes. Made-up names only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProblem } from '@/api/client'
import { CHROME_LAPTOP } from '@/apps/companies/call-notes/mic/fake-mic'
import { taskCommand } from '../card/fixtures'
import { TASK_WORDS, setUp, live, tick } from './live/fake-session'
import { letLiveBack, liveHeldOff } from './live/limit'
import type { TalkEnd } from './live/talk'
import { LIVE_DROPPED, LIVE_LIMIT, LIVE_UNREACHABLE, LIVE_WRONG } from './live/words'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  // The month's limit holds live voice off for the page: each test starts afresh.
  letLiveBack()
})

describe('the free mic takes over (T4-1)', () => {
  const refused = (status: number, code: string | null, detail: string | null): TalkEnd => ({
    kind: 'refused',
    problem: new ApiProblem({ title: 'No', status, code, detail }),
  })
  const notAllowed =
    'Live voice is paid by the minute, so it is turned on for each person. Ask the Platform ' +
    'admin to turn it on. You can still use the free mic.'
  const switchedOff = 'Live voice is switched off on the server. Use the free mic or type.'
  const busy =
    'Too many people are using live voice right now. Try again in a minute, or use the free mic.'

  it.each<[string, TalkEnd, string]>([
    [
      'a start refused: not on for this person (403)',
      refused(403, 'live_voice_not_allowed', notAllowed),
      notAllowed,
    ],
    [
      'a start refused: off on the server (409)',
      refused(409, 'live_voice_off', switchedOff),
      switchedOff,
    ],
    [
      'a start refused: the month limit (429)',
      refused(429, 'live_voice_limit', 'Off.'),
      LIVE_LIMIT,
    ],
    ['a start refused: busy (503)', refused(503, 'live_voice_busy', busy), busy],
    [
      'a start that never reached our server',
      refused(0, null, 'Contour will carry on when your connection is back.'),
      LIVE_UNREACHABLE,
    ],
    [
      'a socket that failed, or a content policy that refused it',
      { kind: 'failed' },
      LIVE_UNREACHABLE,
    ],
    ['the browser offline', { kind: 'offline' }, LIVE_UNREACHABLE],
    ['two reconnects failed, or our backend not back in 30 s', { kind: 'lost' }, LIVE_DROPPED],
    [
      "the relay's end: a drop",
      { kind: 'ended', reason: 'dropped', line: LIVE_DROPPED },
      LIVE_DROPPED,
    ],
    [
      "the relay's end: the limit",
      { kind: 'ended', reason: 'limit', line: LIVE_LIMIT },
      LIVE_LIMIT,
    ],
    ["the relay's end: an error", { kind: 'ended', reason: 'error', line: null }, LIVE_WRONG],
    [
      "the relay's end: Google unreachable",
      { kind: 'ended', reason: 'unreachable', line: LIVE_UNREACHABLE },
      LIVE_UNREACHABLE,
    ],
  ])('%s: the free mic listens, saying why', async (_, end, line) => {
    const { talks, mic, now } = await live()
    talks.last().finish(end)
    await tick(100)

    expect(mic.tools).toHaveLength(1)
    expect(now()).toMatchObject({ phase: 'listening', live: null, notice: { line } })
  })

  it('puts the words no tool call took in the text line, under the line', async () => {
    const { talk, mic, now } = await live()
    talk.leave('Then add a task for Friday')
    talk.finish({ kind: 'lost' })
    await tick(100)

    expect(mic.tools).toEqual([])
    expect(now()).toMatchObject({
      phase: 'typing',
      draft: 'Then add a task for Friday',
      problem: { kind: 'fallback', line: LIVE_DROPPED },
    })
  })

  it('goes to typing, with the line, where no free engine can run', async () => {
    // Live voice runs here, but neither the browser's service nor the model on the device does.
    const { session, talks, mic, now } = setUp({
      mic: { speech: false, browser: { ...CHROME_LAPTOP, live: true, model: false } },
    })
    session.start('browser_service')
    talks.last().finish({ kind: 'failed' })
    await tick(100)

    expect(mic.tools).toEqual([])
    expect(now()).toMatchObject({
      phase: 'typing',
      problem: { kind: 'fallback', line: LIVE_UNREACHABLE },
    })
  })

  it('turns already said still go on', async () => {
    const { talk, readings, handed } = await live()
    talk.call('call-1', TASK_WORDS, TASK_WORDS)
    talk.finish({ kind: 'lost' })
    readings[0]?.answer(taskCommand())
    await tick()

    expect(handed).toHaveLength(1)
  })

  it('the next V tries live voice again after a drop', async () => {
    const { session, talks } = await live()
    talks.last().finish({ kind: 'lost' })
    await tick(100)
    session.dispose()
    session.start('browser_service')

    expect(talks.made).toHaveLength(2)
  })

  it('after the limit, live voice stays off until the server says (Retry-After)', async () => {
    const { session, talks, mic } = await live()
    const problem = new ApiProblem({
      title: 'No',
      status: 429,
      code: 'live_voice_limit',
      retry_after_seconds: 3600,
    })
    talks.last().finish({ kind: 'refused', problem })
    await tick(100)
    expect(liveHeldOff()).toBe(true)

    // The next V uses the free mic at once, with no live start at all.
    session.dispose()
    session.start('browser_service')
    await tick(100)
    expect(talks.made).toHaveLength(1)
    expect(mic.tools).toHaveLength(2)

    // An hour later, the month changed: live voice again.
    await tick(3600 * 1000)
    session.dispose()
    session.start('browser_service')
    expect(talks.made).toHaveLength(2)
  })

  it("after the relay's limit, live voice stays off until the Melbourne month changes", async () => {
    vi.setSystemTime(new Date('2026-11-25T03:00:00Z'))
    const { talks } = await live()
    talks.last().finish({ kind: 'ended', reason: 'limit', line: LIVE_LIMIT })
    await tick(100)

    expect(liveHeldOff(Date.parse('2026-11-30T12:59:59Z'))).toBe(true)
    expect(liveHeldOff(Date.parse('2026-11-30T13:00:00Z'))).toBe(false)
  })
})
