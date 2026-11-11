/**
 * Each case in PLAN-V15 "Words for errors" gets its words (T2-3). The backend's own words win
 * when it sends them; these are what the website says when it has to speak for itself.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { networkProblem, problemFromResponse, timeoutProblem } from './client'
import { plainFieldMessage, statusWords, WORDS } from './words'

const answer = (status: number, headers: Record<string, string> = {}) =>
  new Response(null, { status, headers })

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the words for each case', () => {
  it('offline', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const problem = networkProblem()
    expect([problem.title, problem.detail]).toEqual([
      "You're offline",
      'Contour will carry on when your connection is back.',
    ])
  })

  it('no answer in time', () => {
    const problem = timeoutProblem()
    expect([problem.title, problem.detail]).toEqual([
      'Contour took too long to answer',
      'Nothing was lost. Try again.',
    ])
  })

  it("can't reach the server", () => {
    const problem = networkProblem()
    expect([problem.title, problem.detail]).toEqual([
      "Contour can't reach its server",
      "We'll try again in 10 seconds.",
    ])
  })

  it.each([502, 503, 504])('a deploy (%i with no JSON)', (status) => {
    const problem = problemFromResponse(answer(status), '<html>Bad gateway</html>')
    expect([problem.title, problem.detail, problem.code]).toEqual([
      'Contour is updating',
      "It'll be back in about a minute. This page will reload by itself.",
      'updating',
    ])
  })

  it('too busy (503 busy), when the backend sends no words of its own', () => {
    const problem = problemFromResponse(answer(503, { 'retry-after': '5' }), {
      status: 503,
      code: 'busy',
    })
    expect(problem.code).toBe('busy')
    expect(problem.retry_after_seconds).toBe(5)
    expect([problem.title, problem.detail]).toEqual([
      'Contour is busy',
      'Try again in a few seconds.',
    ])
  })

  it('a server fault (500), with the code to send', () => {
    const problem = problemFromResponse(answer(500, { 'x-request-id': '7F3K92QD' }), undefined)
    expect([problem.title, problem.detail]).toEqual([
      'Something went wrong on our side',
      'Try again. If it happens again, send this code to an admin: 7F3K92QD.',
    ])
  })

  it('no access (403)', () => {
    const problem = problemFromResponse(answer(403), undefined)
    expect([problem.title, problem.detail]).toEqual([
      "This page isn't open to you",
      'Ask an admin if you need it.',
    ])
  })

  it('not found (404)', () => {
    const problem = problemFromResponse(answer(404), undefined)
    expect([problem.title, problem.detail]).toEqual([
      "We can't find that",
      'It may have moved or been removed.',
    ])
  })

  it('bad fields (422), each field in plain words', () => {
    const problem = problemFromResponse(answer(422), {
      detail: [{ loc: ['body', 'name'], msg: 'Field required' }],
    })
    expect(problem.title).toBe('Some fields need a fix')
    expect(problem.errors).toEqual([{ field: 'body.name', message: 'Fill this in.' }])
  })

  it('a new version', () => {
    expect(WORDS.newVersion).toEqual({ title: 'Contour was updated', detail: 'Reloading…' })
  })

  it("the backend's own words win over these", () => {
    const problem = problemFromResponse(answer(503), {
      title: 'Contour is busy',
      detail: 'Try again in a few seconds.',
      status: 503,
      code: 'busy',
    })
    expect([problem.title, problem.detail]).toEqual([
      'Contour is busy',
      'Try again in a few seconds.',
    ])
  })

  it('has words for every status it names', () => {
    for (const status of [400, 403, 404, 409, 413, 422, 429, 500, 501, 502, 503, 504]) {
      const words = statusWords(status)
      expect(words?.title, String(status)).toBeTruthy()
      expect(words?.detail, String(status)).toBeTruthy()
    }
  })
})

describe('field messages in plain words', () => {
  it.each([
    ['Field required', 'Fill this in.'],
    ['String should have at least 1 character', 'Fill this in.'],
    ['String should have at least 8 characters', 'Use at least 8 characters.'],
    ['String should have at most 400 characters', 'Use at most 400 characters.'],
    ['Input should be greater than or equal to 1', 'Use 1 or more.'],
    ['Input should be less than or equal to 200', 'Use 200 or less.'],
    ['Input should be greater than 0', 'Use more than 0.'],
    [
      'Input should be a valid integer, unable to parse string as an integer',
      'Enter a whole number.',
    ],
    ['Input should be a valid number, unable to parse string as a number', 'Enter a number.'],
    ['Input should be a valid boolean', 'Pick yes or no.'],
    ['Input should be a valid date or datetime, input is too short', 'Enter a date and time.'],
    ['Input should be a valid date', 'Enter a date.'],
    [
      'value is not a valid email address: An email address must have an @-sign.',
      'Enter an email address.',
    ],
    [
      "Input should be 'friendly', 'direct' or 'formal'",
      'Pick one of: friendly, direct or formal.',
    ],
    ['List should have at least 1 item after validation, not 0', 'Pick at least 1.'],
    ['Extra inputs are not permitted', "This isn't a field Contour knows. Leave it out."],
    ['Value error, Pick at least one city.', 'Pick at least one city.'],
    ['Pick at least one city.', 'Pick at least one city.'],
  ])('%s', (message, plain) => {
    expect(plainFieldMessage(message)).toBe(plain)
  })
})
