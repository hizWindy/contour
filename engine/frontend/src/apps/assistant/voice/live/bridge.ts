/**
 * "Ask Contour" (PLAN-V28 T3-1 to T3-3, choices 5 to 10): a tool call becomes a turn of the voice
 * bar's conversation (`BarSession.toolCall`), and what the turn did becomes the tool answer: the
 * line Gemini says. Plain code: the session hands in what happened, this says what to answer.
 *
 * - **The command step reads Gemini's `request`** (choice 8; `COMMAND_TEXT`, TBC at T5-2), with
 *   what is on screen, the open card's boxes and the last turn, as the free mic sends them.
 * - **Every answer** has `status`, `retryable` and a `message` that is never empty (Google's
 *   advice), within the relay's 500 characters (the socket cuts it, `relay.ts`):
 *   - a card opened, or changed: "Ready. Say send it.", or Claude's question while it is unsure;
 *   - a page opened: its line (`handOver`'s `tell`), else the command's read-back;
 *   - the research card: its question with the cost, its "which one?", or why it can't start;
 *   - no name to research: the bar's line asking for one;
 *   - unknown: the read-back, short (its first sentence);
 *   - 409, 429 and 503: their own plain words;
 *   - a send (choice 7): "Sent." only once the card's Send has worked, after its hold; the card's
 *     own error line; or "Not sent." after Undo.
 */
import type { ApiProblem } from '@/api/client'
import type { AssistantCommand } from '@/api/types'
import { NO_NAME } from '../../card/research-words'
import type { SendOutcome } from '../../card/send'
import type { CardShown } from '../bar-session'
import type { AfterAnswer, Heard } from '../hand-over'
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

/** The tool answer, less its `id`: what Contour did, and the line to say. */
export interface Reply {
  status: 'ok' | 'unsure' | 'error'
  retryable: boolean
  message: string
}

/**
 * What the command step reads: Gemini's `request` (choice 8), or the rep's own words as Google
 * heard them. T5-2 compares the two for names and dates (TBC).
 */
export const COMMAND_TEXT: 'request' | 'transcript' = 'request'

/** The words a tool call's turn sends to the command step. */
export function commandText(
  request: string,
  heard: string,
  from: 'request' | 'transcript' = COMMAND_TEXT,
): string {
  return from === 'transcript' && heard.trim() !== '' ? heard.trim() : request.trim()
}

export function ok(message: string): Reply {
  return { status: 'ok', retryable: false, message: message.trim() || DONE }
}

export function unsure(message: string): Reply {
  return { status: 'unsure', retryable: false, message: message.trim() || DONE }
}

export function failed(message: string, retryable = false): Reply {
  return { status: 'error', retryable, message: message.trim() || DONE }
}

/** A line's first sentence: an unknown command's read-back, short. */
export function firstSentence(text: string): string {
  const match = /^.*?[.!?](?=\s|$)/.exec(text.trim())
  return match ? match[0] : text.trim()
}

/** The research card as it opens: its question with the cost, "which one?", or why not. */
function researchReply(command: AssistantCommand): Reply {
  const research = command.research
  if (!research) return unsure(command.read_back || NO_NAME)
  if (research.next === 'choose') return unsure(command.read_back || NO_NAME)
  if (research.next === 'needs_name') return unsure(command.read_back || NO_NAME)
  if (research.next === 'ask' && research.can_start && research.question) {
    return unsure(research.question)
  }
  return failed(research.blocked ?? (command.read_back || NO_NAME))
}

/** The actions whose card is the review card. */
const REVIEW: ReadonlySet<AssistantCommand['action']> = new Set(['log_call', 'task', 'email'])

export interface Outcome {
  /** What the command step answered, or dictation with the AI that reads commands off. */
  heard: Heard
  /** Where `handOver` (or the open card) sent it. */
  after: AfterAnswer
  /** The card open once it settled: one that hears the conversation, another kind, or none. */
  card: CardShown
  /** The line a page opened with (`handOver`'s `tell`), if one did. */
  told: string | null
  /** The turn was said to an open card: a change to it, not a new command. */
  toCard: boolean
}

/** The tool answer for a turn the command step read (T3-1). */
export function replyFor({ heard, after, card, told, toCard }: Outcome): Reply {
  if (heard.kind === 'dictation') {
    // The AI that reads commands is off: the words went into a new call note, or nowhere.
    return after.kind === 'close' ? ok(IN_A_NOTE) : unsure(after.kind === 'show' ? after.line : '')
  }
  const { command } = heard
  if (after.kind === 'unclear') return unsure(after.line)
  if (after.kind === 'show') {
    if (command.action === 'unknown') return unsure(firstSentence(after.line))
    const line = [after.line, after.unsure ?? ''].join(' ')
    return after.again ? unsure(line) : ok(line)
  }
  if (told) return ok(told)
  // A change made to the card the turn was said to: it is ready again.
  if (toCard) return ok(READY)
  if (command.action === 'research' && card !== null) return researchReply(command)
  if (REVIEW.has(command.action) && card !== null) {
    // Claude's question becomes Gemini's (choice 9): "Jo Sample or Jo Northwind?".
    return command.unsure?.trim() ? unsure(command.unsure) : ok(READY)
  }
  return ok(command.read_back)
}

/**
 * Choice 7: "send" or "cancel" from Gemini's words alone never sends or cancels an open card.
 * The answer asks the rep to say it. Null: any other command.
 */
export function heldBack(command: AssistantCommand): Reply | null {
  if (command.action === 'send') return unsure(SAY_SEND_IT_FIRST)
  if (command.action === 'cancel') return unsure(SAY_CANCEL_FIRST)
  return null
}

/** The card a turn was said to closed while it was read. */
export const CARD_GONE_REPLY: Reply = unsure(CARD_GONE)

/** The command step said no (T3-1): its own plain words. 429 and 503 may work again soon. */
export function replyForProblem(problem: ApiProblem): Reply {
  const words = [problem.title, problem.detail]
    .map((part) => part?.trim().replace(/\.$/, ''))
    .filter(Boolean)
    .join('. ')
  const retryable = problem.status === 429 || problem.status === 503 || problem.status === 0
  return failed(words ? `${words}.` : DONE, retryable)
}

/** "Sent." only once the send worked; the card's error line; or "Not sent." after Undo. */
export function replyForSend(outcome: SendOutcome): Reply {
  switch (outcome.kind) {
    case 'sent':
      return ok(SENT_LINE)
    case 'not_sent':
      return failed(outcome.line, true)
    case 'undone':
      return ok(NOT_SENT_LINE)
  }
}
