/**
 * The words for errors (PLAN-V15 "Words for errors"). Every message the website writes itself
 * comes from here, so the whole site speaks with one voice: what happened, what it means for you,
 * and what to do. The technical part (the status, the code, the request id) goes in "Details for
 * support" (`ErrorState`), never in these words.
 *
 * Never here: a command, a file name, a local address or a library's raw error. A test reads every
 * message below and checks that. The wording is Al-khair's to change.
 */

export interface Words {
  title: string
  detail: string
}

/** The cases the website tells apart by itself, in the plan's order. */
export const WORDS = {
  offline: {
    title: "You're offline",
    detail: 'Contour will carry on when your connection is back.',
  },
  timeout: { title: 'Contour took too long to answer', detail: 'Nothing was lost. Try again.' },
  unreachable: {
    title: "Contour can't reach its server",
    detail: "We'll try again in 10 seconds.",
  },
  updating: {
    title: 'Contour is updating',
    detail: "It'll be back in about a minute. This page will reload by itself.",
  },
  busy: { title: 'Contour is busy', detail: 'Try again in a few seconds.' },
  forbidden: { title: "This page isn't open to you", detail: 'Ask an admin if you need it.' },
  notFound: { title: "We can't find that", detail: 'It may have moved or been removed.' },
  fields: { title: 'Some fields need a fix', detail: 'Each one is listed below.' },
  newVersion: { title: 'Contour was updated', detail: 'Reloading…' },
  /** Code in the page broke while it drew. No call failed, so there is no request id. */
  page: {
    title: "This page couldn't be shown",
    detail: 'Reload the page. If it happens again, tell an admin.',
  },
} as const satisfies Record<string, Words>

/** A 500: the request id is the code to send, when the backend gave one. */
export function serverWords(requestId: string | null): Words {
  return {
    title: 'Something went wrong on our side',
    detail: requestId
      ? `Try again. If it happens again, send this code to an admin: ${requestId}.`
      : 'Try again. If it happens again, tell an admin.',
  }
}

/** The words for a status when the answer brought none of its own. */
export function statusWords(status: number, requestId: string | null = null): Words | null {
  switch (status) {
    case 400:
      return { title: "Contour couldn't read that", detail: 'Reload the page and try again.' }
    case 403:
      return WORDS.forbidden
    case 404:
      return WORDS.notFound
    case 409:
      return {
        title: "That can't be done right now",
        detail: 'Reload the page to see where things stand.',
      }
    case 413:
      return { title: 'That was too much at once', detail: 'Pick less and try again.' }
    case 422:
      return WORDS.fields
    case 429:
      return { title: 'Too many tries at once', detail: 'Wait a few seconds and try again.' }
    case 500:
      return serverWords(requestId)
    case 501:
      return { title: "This part isn't ready yet", detail: "It's still being built." }
    case 502:
    case 504:
      return WORDS.updating
    case 503:
      return WORDS.updating
    default:
      return status >= 500 ? serverWords(requestId) : null
  }
}

/*
  Field messages. The backend checks a form with Pydantic, whose messages are written for a
  developer ("Input should be greater than or equal to 1"). Each one below becomes plain words.
  A message that matches none is the backend's own sentence (its own checks write plain words),
  and is kept.
*/
const FIELD_WORDS: readonly [RegExp, (match: RegExpMatchArray) => string][] = [
  [/^Field required$/i, () => 'Fill this in.'],
  [/^Value error, (.+)$/is, (m) => m[1] ?? ''],
  [/^Assertion failed, (.+)$/is, (m) => m[1] ?? ''],
  [/^String should have at least 1 character/i, () => 'Fill this in.'],
  [/^String should have at least (\d+) characters?/i, (m) => `Use at least ${m[1]} characters.`],
  [/^String should have at most (\d+) characters?/i, (m) => `Use at most ${m[1]} characters.`],
  [/^String should match pattern/i, () => 'Check the format.'],
  [/^List should have at least (\d+) items?/i, (m) => `Pick at least ${m[1]}.`],
  [/^List should have at most (\d+) items?/i, (m) => `Pick at most ${m[1]}.`],
  [/^Input should be greater than or equal to (\S+)$/i, (m) => `Use ${m[1]} or more.`],
  [/^Input should be greater than (\S+)$/i, (m) => `Use more than ${m[1]}.`],
  [/^Input should be less than or equal to (\S+)$/i, (m) => `Use ${m[1]} or less.`],
  [/^Input should be less than (\S+)$/i, (m) => `Use less than ${m[1]}.`],
  [/^Input should be a valid integer/i, () => 'Enter a whole number.'],
  [/^Input should be a finite number/i, () => 'Enter a number.'],
  [/^Input should be a valid (number|decimal)/i, () => 'Enter a number.'],
  [/^Input should be a valid boolean/i, () => 'Pick yes or no.'],
  [/^Input should be a valid string/i, () => 'Enter some text.'],
  [/^Input should be a valid (list|array|set)/i, () => 'Pick one or more.'],
  [/^Input should be a valid datetime/i, () => 'Enter a date and time.'],
  [/^Input should be a valid date/i, () => 'Enter a date.'],
  [/^Input should be a valid time/i, () => 'Enter a time.'],
  [/^Input should be a valid UUID/i, () => "This id isn't valid. Reload the page and try again."],
  [/^Input should be a valid URL/i, () => 'Enter a full web address, like https://example.com.'],
  [/^(Input should be a valid email|value is not a valid email)/i, () => 'Enter an email address.'],
  // "Input should be 'pass', 'watch' or 'drop'": a pick from a fixed list.
  [/^Input should be ('.+')$/i, (m) => `Pick one of: ${(m[1] ?? '').replaceAll("'", '')}.`],
  [/^Extra inputs are not permitted$/i, () => "This isn't a field Contour knows. Leave it out."],
  [/^JSON decode error/i, () => "Contour couldn't read the form. Reload the page and try again."],
]

/** A field message in plain words: "Field required" becomes "Fill this in." */
export function plainFieldMessage(message: string): string {
  const text = message.trim()
  for (const [pattern, words] of FIELD_WORDS) {
    const match = text.match(pattern)
    if (match) {
      return words(match).trim()
    }
  }
  return text
}
