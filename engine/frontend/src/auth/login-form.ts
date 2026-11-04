/**
 * The sign-in form's states, words and checks, apart from the page that draws them
 * (login-view.tsx), so the real login page (PLAN-V6, C2) and its tests use the same ones.
 */
import { z } from 'zod'

/** A laptop: the page splits into two halves. Below it, the brand is a band on top. */
export const LAPTOP = '(min-width: 1024px)'

/** What the sign-in is doing now. */
export type LoginStatus =
  | { kind: 'ready' }
  | { kind: 'signing_in' }
  | { kind: 'wrong' }
  | { kind: 'locked'; minutes: number }
  /** The backend didn't answer, or answered with something else. */
  | { kind: 'failed' }

/** Why the person is here, said once above the form. */
export type LoginNotice = 'idle' | 'expired' | 'signed_out'

export const NOTICE_TEXT: Record<LoginNotice, string> = {
  idle: 'You were signed out after 2 hours idle.',
  expired: 'You were signed out after 12 hours. Sign in again.',
  signed_out: 'You signed out.',
}

/** The same words whether the email or the password was wrong, so nobody learns which exists. */
export const WRONG_TEXT = "That email or password isn't right."

export const FAILED_TEXT = "Contour HQ didn't answer. Nothing changed. Try again in a minute."

/** "Too many tries. Try again in 12 minutes.", in whole minutes, at least 1. */
export function lockedText(minutes: number): string {
  const whole = Math.max(1, Math.ceil(minutes))
  return `Too many tries. Try again in ${String(whole)} ${whole === 1 ? 'minute' : 'minutes'}.`
}

export const loginSchema = z.object({
  identifier: z
    .string()
    .trim()
    .min(1, 'Enter your email or username.')
    .max(254, 'That is longer than any email or username here.'),
  // No rules here beyond "not empty": the rules are for making a password, not for signing in.
  password: z.string().min(1, 'Enter your password.').max(1024, 'That password is too long.'),
  keepSignedIn: z.boolean(),
})

export type LoginValues = z.infer<typeof loginSchema>
