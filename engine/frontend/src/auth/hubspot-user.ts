/**
 * Where the signed-in person's work lands in HubSpot (PLAN-V23 T3-1, choices 12 to 16): their
 * HubSpot user is set (`linked`), they have none, like a designer (`none`), or nobody has picked
 * yet (`not_set`). With sign-in off, or a backend that doesn't say, it is null and everything
 * shows as before.
 *
 * Someone with no HubSpot user has no HubSpot login, so "Open in HubSpot" is hidden for them
 * everywhere (T3-4), and a task or a follow-up they make needs a teammate.
 */
import { useMe, type SignedInUser, type SignIn } from '@/api/hooks/auth'

export type HubSpotUser = NonNullable<SignedInUser['hubspot']>

export function hubSpotUserOf(signIn: SignIn | undefined): HubSpotUser | null {
  return signIn?.state === 'signed_in' ? (signIn.user.hubspot ?? null) : null
}

/** The signed-in person's HubSpot user, or null when nobody is signed in or it isn't known. */
export function useHubSpotUser(): HubSpotUser | null {
  return hubSpotUserOf(useMe().data)
}

/** True for someone marked "No HubSpot user". */
export function useNoHubSpotUser(): boolean {
  return useHubSpotUser() === 'none'
}

/** "Open in HubSpot" shows, unless this person has no HubSpot user to open it with (T3-4). */
export function useOpensHubSpot(): boolean {
  return !useNoHubSpotUser()
}
