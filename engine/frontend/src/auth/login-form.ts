/**
 * The sign-in form's states, words and checks, apart from the page that draws them
 * (login-view.tsx), so the login page (login-page.tsx), the mockup and the tests use the same ones.
 *
 * The words match the backend's own (`core/auth/words.py`): when the backend sends a sentence, the
 * page shows it; these are for when it sends none, and for the mockup.
 */
import { z } from 'zod'
import { isApiProblem } from '@/api/client'

/** A laptop: the page splits into two halves. Below it, the brand is a band on top. */
export const LAPTOP = '(min-width: 1024px)'

/** What the sign-in is doing now. */
export type LoginStatus =
  | { kind: 'ready' }
  | { kind: 'signing_in' }
  /** A wrong login or password. `waitSeconds`: the next try has to wait this long. */
  | { kind: 'wrong'; waitSeconds?: number | null }
  /** Too many wrong tries: nothing is checked until the wait is over. */
  | { kind: 'locked'; seconds: number }
  /** The backend didn't answer, or answered with something else. */
  | { kind: 'failed' }

/** Why the person is here, said once above the form. */
export type LoginNotice = 'idle' | 'expired' | 'ended' | 'signed_out'

export const NOTICE_TEXT: Record<LoginNotice, string> = {
  idle: 'You were signed out after 2 hours idle.',
  expired: 'Your session ended after 12 hours. Sign in again.',
  ended: 'You were signed out. Sign in again.',
  signed_out: 'You signed out.',
}

/** The notice for a `reason` in the address (the backend's `reason`, or `signed_out`). */
export function noticeOf(reason: string | null | undefined): LoginNotice | null {
  return reason && reason in NOTICE_TEXT ? (reason as LoginNotice) : null
}

/** The same words whether the email or the password was wrong, so nobody learns which exists. */
export const WRONG_TEXT = "That email or password isn't right."

export const FAILED_TEXT = "Contour HQ didn't answer. Nothing changed. Try again in a minute."

/** How long to wait, rounded up, as the backend says it: "30 seconds", "1 minute", "12 minutes". */
export function waitText(seconds: number): string {
  const whole = Math.max(1, Math.ceil(seconds))
  if (whole < 60) {
    return `${String(whole)} ${whole === 1 ? 'second' : 'seconds'}`
  }
  const minutes = Math.ceil(whole / 60)
  return `${String(minutes)} ${minutes === 1 ? 'minute' : 'minutes'}`
}

/** "Too many tries. Try again in 12 minutes." */
export function lockedText(seconds: number): string {
  return `Too many tries. Try again in ${waitText(seconds)}.`
}

/** The wrong-login words, and the wait the next try has, if it has one. */
export function wrongText(waitSeconds?: number | null): string {
  return waitSeconds && waitSeconds > 0
    ? `${WRONG_TEXT} Wait ${waitText(waitSeconds)} before you try again.`
    : WRONG_TEXT
}

/** The page's state for a failed sign-in (`POST /auth/login`). */
export function statusOfProblem(error: unknown): LoginStatus {
  if (!isApiProblem(error)) {
    return { kind: 'failed' }
  }
  if (error.status === 429 || error.code === 'too_many_attempts') {
    return { kind: 'locked', seconds: error.retry_after_seconds ?? 60 }
  }
  if (error.status === 401 || error.code === 'invalid_credentials') {
    return { kind: 'wrong', waitSeconds: error.retry_after_seconds }
  }
  return { kind: 'failed' }
}

/**
 * Where to go after signing in: the page the person came from, if it is one of this site's own
 * pages. Anything else (another site, `//host`, the login page itself) goes home, so a link can't
 * use the login page to send someone elsewhere.
 */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) {
    return '/'
  }
  if (next === '/login' || next.startsWith('/login?') || next.startsWith('/login/')) {
    return '/'
  }
  return next
}

/** The address of the login page for someone on `here` whose session ended for `reason`. */
export function loginAddress(here: string, reason: string | null): string {
  const params = new URLSearchParams()
  if (here !== '/' && here !== '') {
    params.set('next', here)
  }
  if (reason) {
    params.set('reason', reason)
  }
  const query = params.toString()
  return query ? `/login?${query}` : '/login'
}

/** Where the email or username used last time is kept, on this device only. Never a password. */
export const REMEMBER_KEY = 'contour-hq.login'

export function rememberedLogin(): string {
  try {
    return window.localStorage.getItem(REMEMBER_KEY) ?? ''
  } catch {
    return ''
  }
}

export function rememberLogin(login: string): void {
  try {
    window.localStorage.setItem(REMEMBER_KEY, login)
  } catch {
    // A browser that blocks storage just forgets it.
  }
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

/** Which field has the cursor, for the avatar. */
export type LoginFocus = 'identifier' | 'password' | null

/**
 * The sign-in page's avatar follows the form, so it never says anything the words don't:
 * - `ready`: a calm smile.
 * - `watching`: eyes on the login being typed (or on a password the person chose to show).
 * - `eyes_closed`: it looks away politely while a hidden password is typed.
 * - `thinking`: while the sign-in is checked.
 * - `concerned`: after a wrong try, a lock or a failure, until the person types again.
 */
export type AvatarMood = 'ready' | 'watching' | 'eyes_closed' | 'thinking' | 'concerned'

export function avatarMood({
  status,
  focus,
  showPassword,
  typedSinceStatus,
}: {
  status: LoginStatus
  focus: LoginFocus
  showPassword: boolean
  /** True once the person has typed after the last answer. */
  typedSinceStatus: boolean
}): AvatarMood {
  if (status.kind === 'signing_in') return 'thinking'
  const failed = status.kind === 'wrong' || status.kind === 'locked' || status.kind === 'failed'
  if (failed && !typedSinceStatus) return 'concerned'
  if (focus === 'password') return showPassword ? 'watching' : 'eyes_closed'
  if (focus === 'identifier') return 'watching'
  return 'ready'
}
