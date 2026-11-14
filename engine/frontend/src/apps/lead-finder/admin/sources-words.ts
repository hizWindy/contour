/**
 * The Sources tab's words (PLAN-V16 T3-6), apart from the page so it exports only the page.
 */
import type { PropertySource } from '@/api/types'

/** Whether a tool is signed in. Empty: not checked since the backend started (it signs in again). */
export function signInWords(signedIn: boolean | null): string {
  if (signedIn === null) return 'Not checked since the backend started'
  return signedIn ? 'Signed in' : 'Not signed in'
}

/** The setting that switches a tool on or off (S0's `property_daily_enabled`). */
export function switchKey(source: PropertySource): string {
  return `${source}_enabled`
}
