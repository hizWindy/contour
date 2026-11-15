/**
 * The pre-read's rules in plain code, with no screen (PLAN-V17 "The screens", part 6), so each can
 * be tested on its own: the three summaries, a rep's edit to one, and when "Check and send" may be
 * pressed.
 */
import type { FormSummaries, MeetingFormOut, MeetingFormStatus } from '@/api/v17'

export type SummaryName = keyof FormSummaries

/** The three summaries, in the order the page and the email show them. */
export const SUMMARY_NAMES: readonly SummaryName[] = [
  'what_they_do',
  'what_we_know',
  'talks_so_far',
]

/** The most a summary may hold (the server's limit). */
export const SUMMARY_MAX_CHARS = 2000

/** The most each blank may hold (the server's limit). */
export const BLANK_MAX_CHARS = 1000

/**
 * The form with one summary in the rep's words: marked theirs at once (`by: person`), with its
 * sources kept, as the server keeps them.
 */
export function withSummary(form: MeetingFormOut, name: SummaryName, text: string): MeetingFormOut {
  return {
    ...form,
    summaries: { ...form.summaries, [name]: { ...form.summaries[name], text, by: 'person' } },
  }
}

/** Some summary has words: from this draft, an earlier one, or the rep. */
export function hasSummaries(form: Pick<MeetingFormOut, 'summaries'>): boolean {
  return SUMMARY_NAMES.some((name) => form.summaries[name].text.trim() !== '')
}

/**
 * Why "Check and send" is greyed, or null when it may be pressed. The two blanks come first, since
 * the rep can fill them in while the summaries are written. Then a blank that didn't save, and
 * then the draft itself: the server sends only a pre-read whose summaries are written.
 */
export type SendBlock = 'both' | 'next_step' | 'going' | 'not_saved' | 'drafting' | 'failed'

export interface SendState {
  status: MeetingFormStatus
  /** What the two blanks hold now, as the rep sees them. */
  nextStep: string
  going: string
  /** A blank's last save failed, so the server doesn't have it. */
  unsaved: boolean
}

export function sendBlock({ status, nextStep, going, unsaved }: SendState): SendBlock | null {
  const noNextStep = nextStep.trim() === ''
  const noGoing = going.trim() === ''
  if (noNextStep && noGoing) return 'both'
  if (noNextStep) return 'next_step'
  if (noGoing) return 'going'
  if (unsaved) return 'not_saved'
  if (status === 'drafting') return 'drafting'
  if (status === 'failed') return 'failed'
  return null
}
