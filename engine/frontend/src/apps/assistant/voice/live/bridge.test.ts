/**
 * "Ask Contour"'s answers (PLAN-V28 T3-1 to T3-3): each kind of tool answer, never empty, with
 * the plan's words; Gemini's "send" or "cancel" held back (choice 7); a problem's plain words;
 * and a send said as it went. Plain code. Made-up names only: Sample Logistics, Northwind, Jo
 * Sample.
 */
import { describe, expect, it } from 'vitest'
import { ApiProblem } from '@/api/client'
import type { AssistantCommand, AssistantResearch } from '@/api/types'
import { NO_NAME } from '../../card/research-words'
import { callCommand, command, taskCommand } from '../../card/fixtures'
import type { Heard } from '../hand-over'
import {
  CARD_GONE_REPLY,
  commandText,
  firstSentence,
  heldBack,
  replyFor,
  replyForProblem,
  replyForSend,
  type Outcome,
} from './bridge'
import {
  CARD_GONE,
  DONE,
  IN_A_NOTE,
  NOT_SENT_LINE,
  READY,
  SAY_CANCEL_FIRST,
  SAY_SEND_IT_FIRST,
  SENT_LINE,
} from './words'

const QUESTION = 'Research Northwind? About US$0.38.'

function research(change: Partial<AssistantResearch> = {}): AssistantResearch {
  return {
    company: 'Northwind',
    company_key: null,
    city: 'Perth',
    hubspot: 'new',
    last_activity: null,
    lead: null,
    lease_end: null,
    area_m2: null,
    known: [],
    next: 'ask',
    question: QUESTION,
    cost_usd: '0.38',
    can_start: true,
    blocked: null,
    ...change,
  }
}

function heard(said: AssistantCommand): Heard {
  return { kind: 'command', command: said, words: 'Log a call with Jo', source: 'mic' }
}

function outcome(change: Partial<Outcome> & Pick<Outcome, 'heard'>): Outcome {
  return { after: { kind: 'close' }, card: null, told: null, toCard: false, ...change }
}

describe('the tool answer for each kind of turn (T3-1)', () => {
  it('a review card opened: "Ready. Say send it."', () => {
    const reply = replyFor(outcome({ heard: heard(callCommand()), card: 'hears' }))

    expect(reply).toEqual({ status: 'ok', retryable: false, message: READY })
  })

  it("a review card opened, unsure: Claude's question becomes Gemini's (T3-3)", () => {
    const unsure = 'Jo Sample or Jo Northwind?'
    const reply = replyFor(outcome({ heard: heard(callCommand({ unsure })), card: 'hears' }))

    expect(reply).toEqual({ status: 'unsure', retryable: false, message: unsure })
  })

  it('a change said to the open card: it is ready again', () => {
    const change = command({ action: 'change', read_back: 'Due Friday now.' })
    const reply = replyFor(outcome({ heard: heard(change), card: 'hears', toCard: true }))

    expect(reply.message).toBe(READY)
  })

  it("a page opened with a line of its own: that line (handOver's tell)", () => {
    const line = 'Opening the lead card for Northwind.'
    const reply = replyFor(
      outcome({ heard: heard(command({ action: 'research', research: research() })), told: line }),
    )

    expect(reply).toEqual({ status: 'ok', retryable: false, message: line })
  })

  it('a page opened with none: the read-back', () => {
    const open = command({ action: 'open', read_back: 'Opening Sample Logistics.' })

    expect(replyFor(outcome({ heard: heard(open) })).message).toBe('Opening Sample Logistics.')
  })

  it('the research card: its question, with the cost', () => {
    const asked = command({ action: 'research', read_back: QUESTION, research: research() })
    const reply = replyFor(outcome({ heard: heard(asked), card: 'hears' }))

    expect(reply).toEqual({ status: 'unsure', retryable: false, message: QUESTION })
  })

  it('the research card that asks which one: the read-back', () => {
    const asked = command({
      action: 'research',
      read_back: 'Northwind may be in HubSpot.',
      research: research({ next: 'choose', question: null }),
    })

    expect(replyFor(outcome({ heard: heard(asked), card: 'hears' }))).toMatchObject({
      status: 'unsure',
      message: 'Northwind may be in HubSpot.',
    })
  })

  it("a research that can't start: why", () => {
    const blocked = 'Research is paused for this month.'
    const asked = command({
      action: 'research',
      read_back: '',
      research: research({ can_start: false, blocked, question: null }),
    })

    expect(replyFor(outcome({ heard: heard(asked), card: 'hears' }))).toMatchObject({
      status: 'error',
      message: blocked,
    })
  })

  it("no name to research: the bar's line asking for one", () => {
    const show = { kind: 'show', line: NO_NAME, unsure: null, again: true } as const
    const asked = command({
      action: 'research',
      read_back: '',
      research: research({ next: 'needs_name', company: '', question: null }),
    })

    expect(replyFor(outcome({ heard: heard(asked), after: show }))).toEqual({
      status: 'unsure',
      retryable: false,
      message: NO_NAME,
    })
  })

  it('unknown: the read-back, short', () => {
    const line = "I didn't catch an action there. Try 'log a call with Jo'. Or say 'help'."
    const show = { kind: 'show', line, unsure: null, again: true } as const
    const reply = replyFor(outcome({ heard: heard(command({ action: 'unknown' })), after: show }))

    expect(reply).toEqual({
      status: 'unsure',
      retryable: false,
      message: "I didn't catch an action there.",
    })
  })

  it("unclear: the command step's stop line", () => {
    const unclear = {
      kind: 'unclear',
      line: "That didn't sound like a command.",
      words: 'um the thing',
    } as const

    expect(
      replyFor(outcome({ heard: heard(command({ action: 'unclear' })), after: unclear })),
    ).toEqual({ status: 'unsure', retryable: false, message: "That didn't sound like a command." })
  })

  it('a read-back shown, like a task with nothing to do: the line', () => {
    const show = { kind: 'show', line: 'Nothing to send.', unsure: null, again: false } as const

    expect(replyFor(outcome({ heard: heard(taskCommand()), after: show }))).toEqual({
      status: 'ok',
      retryable: false,
      message: 'Nothing to send.',
    })
  })

  it('with the AI off, the words went into a new call note', () => {
    const dictation: Heard = { kind: 'dictation', words: 'Jo wants a quote', source: 'mic' }

    expect(replyFor(outcome({ heard: dictation })).message).toBe(IN_A_NOTE)
  })

  it('is never empty: an empty line says "Done."', () => {
    const show = { kind: 'show', line: '', unsure: null, again: false } as const

    expect(replyFor(outcome({ heard: heard(command({ action: 'open' })), after: show }))).toEqual({
      status: 'ok',
      retryable: false,
      message: DONE,
    })
  })
})

describe("choice 7: Gemini's words never send or cancel", () => {
  it('"send" asks the rep to say it', () => {
    expect(heldBack(command({ action: 'send' }))).toEqual({
      status: 'unsure',
      retryable: false,
      message: SAY_SEND_IT_FIRST,
    })
  })

  it('"cancel" asks the rep to say it', () => {
    expect(heldBack(command({ action: 'cancel' }))?.message).toBe(SAY_CANCEL_FIRST)
  })

  it('anything else goes on', () => {
    expect(heldBack(callCommand())).toBeNull()
    expect(heldBack(command({ action: 'change' }))).toBeNull()
  })

  it('a card closed meanwhile says so', () => {
    expect(CARD_GONE_REPLY).toEqual({ status: 'unsure', retryable: false, message: CARD_GONE })
  })
})

describe("a problem's plain words (T3-1)", () => {
  it.each([
    [409, 'assistant_busy', false],
    [429, 'too_many', true],
    [503, 'busy', true],
  ])('%i: its own words, and whether to try again', (status, code, retryable) => {
    const problem = new ApiProblem({
      title: 'Contour is busy',
      detail: 'Try again in a few seconds.',
      status,
      code,
    })

    expect(replyForProblem(problem)).toEqual({
      status: 'error',
      retryable,
      message: 'Contour is busy. Try again in a few seconds.',
    })
  })

  it('a problem with no words of its own says "Done." rather than nothing', () => {
    const problem = new ApiProblem({ title: '', status: 500 })

    expect(replyForProblem(problem).message).toBe(DONE)
  })
})

describe('a send, said as it went (T3-2)', () => {
  it('"Sent." only once it worked', () => {
    expect(replyForSend({ kind: 'sent' })).toEqual({
      status: 'ok',
      retryable: false,
      message: SENT_LINE,
    })
  })

  it("the card's own error line when it didn't", () => {
    const line = 'Not sent. HubSpot said no.'

    expect(replyForSend({ kind: 'not_sent', line })).toEqual({
      status: 'error',
      retryable: true,
      message: line,
    })
  })

  it('"Not sent." after Undo', () => {
    expect(replyForSend({ kind: 'undone' }).message).toBe(NOT_SENT_LINE)
  })
})

describe('the words the command step reads (choice 8)', () => {
  it("is Gemini's request", () => {
    expect(commandText(' Log a call with Jo Sample ', 'log a call with jo')).toBe(
      'Log a call with Jo Sample',
    )
  })

  it("can be the rep's own words, for T5-2's comparison, but never empty", () => {
    expect(commandText('Log a call with Jo Sample', 'log a call with jo', 'transcript')).toBe(
      'log a call with jo',
    )
    expect(commandText('Log a call with Jo Sample', ' ', 'transcript')).toBe(
      'Log a call with Jo Sample',
    )
  })

  it("keeps a read-back's first sentence", () => {
    expect(firstSentence('Opening Northwind. It has a lead card.')).toBe('Opening Northwind.')
    expect(firstSentence('No full stop')).toBe('No full stop')
  })
})
