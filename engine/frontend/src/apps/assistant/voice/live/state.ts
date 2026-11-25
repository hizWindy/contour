/**
 * What live voice says, apart from how it looks (`view.tsx`): where a talk stands in one word, and
 * the end of a long caption (PLAN-V28 T2-4, "Words on screen").
 */
import { RECONNECTING } from '@/apps/companies/call-notes/mic/words'
import { LISTENING, WORKING } from '../words'
import type { TalkSnapshot } from './talk'
import { CONNECTING, MUTED, SPEAKING } from './words'

/**
 * Where a live talk stands, in the pill's own words: Connecting, Reconnecting, Speaking (what is
 * heard comes first), Working it out (a tool call waits for its answer), Muted (in place of
 * Listening, so the rep always sees what the Assistant is doing), or Listening.
 */
export function liveTitle(talk: TalkSnapshot): string {
  if (talk.phase === 'connecting') return CONNECTING
  if (talk.phase === 'reconnecting') return RECONNECTING
  if (talk.speaking) return SPEAKING
  if (talk.working > 0) return WORKING
  if (talk.muted) return MUTED
  return LISTENING
}

/** A caption this long or longer shows its end: about three lines of the bar. */
export const CAPTION_MOST = 220

/** The end of a long line, from a word's start, after an ellipsis: what is being said now. */
export function captionTail(text: string, most: number = CAPTION_MOST): string {
  if (text.length <= most) return text
  const end = text.slice(text.length - most)
  const space = end.indexOf(' ')
  return `…${space > 0 && space < 40 ? end.slice(space + 1) : end}`
}
