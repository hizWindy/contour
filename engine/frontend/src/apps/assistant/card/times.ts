/**
 * The review card's waits (PLAN-V22 choices 19, 22 and 23), in one place, so a test can shorten
 * them.
 */
import { HOLD_MS } from '@/lib/hold'
import { LISTEN_MS } from './listen'

export const CARD_TIMES = {
  /** Enter does nothing for this long after the card opens (choice 19). */
  guard: 500,
  /** The hold before a send (choice 22). */
  hold: HOLD_MS,
  /** The listening for "send it" (choice 23). */
  listen: LISTEN_MS,
  /** A task's or an email's preview waits this long after the last change. */
  preview: 400,
  /** How often a call's note is read again while the server sorts it. */
  sort: 2000,
}

export type CardTimes = typeof CARD_TIMES
