/**
 * The sign-in form's checks. They sit in their own file because `zod` is big (about 35 kB
 * gzipped): `login-form.ts` is also read by the sign-in guard, which every first visit loads, and
 * a visit should not download `zod` before the person has even seen the login form (PLAN-V7 D1).
 * Only the login page's code reads this file.
 */
import { z } from 'zod'

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
