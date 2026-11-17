/**
 * What the signed-in person is allowed to see and do on the website (PLAN-V19 Part 2 & 3).
 *
 * The backend always enforces every tick and role: this only keeps the website from offering
 * buttons, tabs and pages that would answer 403.
 */
import { useMe, type SignIn, type SignedInUser } from '@/api/hooks/auth'

export type Role = SignedInUser['role']
export const ALL_FEATURES = [
  'lead_finder.start_run',
  'lead_finder.results',
  'lead_finder.rules',
  'lead_finder.send_to_hubspot',
  'companies.companies',
  'companies.call_logs',
  'companies.meetings',
  'companies.call_prep',
] as const

export type Feature = (typeof ALL_FEATURES)[number]

const ROLE_RANK: Readonly<Record<Role, number>> = {
  viewer: 0,
  staff: 1,
  admin: 2,
  platform_admin: 3,
}

export function roleRank(role: string | null | undefined): number {
  return role && role in ROLE_RANK ? ROLE_RANK[role as Role] : -1
}

export function isPlatformAdmin(signIn: SignIn | undefined): boolean {
  if (!signIn || signIn.state === 'signed_out') return false
  if (signIn.state === 'off') return true
  return signIn.user.role === 'platform_admin'
}

export function isAdmin(signIn: SignIn | undefined): boolean {
  if (!signIn || signIn.state === 'signed_out') return false
  if (signIn.state === 'off') return true
  return roleRank(signIn.user.role) >= ROLE_RANK.admin
}

export function isViewer(signIn: SignIn | undefined): boolean {
  return signIn?.state === 'signed_in' && signIn.user.role === 'viewer'
}

export function hasFeature(
  user: Pick<SignedInUser, 'role' | 'features' | 'apps'>,
  feature: Feature,
): boolean {
  if (roleRank(user.role) >= ROLE_RANK.admin) return true
  const features = user.features ?? []
  const apps = user.apps ?? []
  if (features.includes(feature)) return true
  // Fallback only for stripped legacy test fixtures that set `apps` without `features`.
  if (features.length === 0 && apps.length > 0) {
    const app = feature.split('.')[0]
    return app !== undefined && apps.includes(app)
  }
  return false
}

export function canUse(signIn: SignIn | undefined, ...features: Feature[]): boolean {
  if (!signIn || signIn.state === 'signed_out') return false
  if (signIn.state === 'off') return true
  if (features.length === 0) return true
  return features.some((feature) => hasFeature(signIn.user, feature))
}

export function canWrite(signIn: SignIn | undefined, ...features: Feature[]): boolean {
  if (isViewer(signIn)) return false
  return canUse(signIn, ...features)
}

export function appOf(feature: Feature): 'lead_finder' | 'companies' {
  return feature.startsWith('lead_finder.') ? 'lead_finder' : 'companies'
}

export function canSeeModule(signIn: SignIn | undefined, app: string | undefined): boolean {
  if (!signIn || signIn.state === 'signed_out') return false
  if (signIn.state === 'off' || app === undefined) return true
  if (isAdmin(signIn)) return true
  return ALL_FEATURES.some(
    (feature) => feature.startsWith(`${app}.`) && hasFeature(signIn.user, feature),
  )
}

export function useIsPlatformAdmin(): boolean {
  return isPlatformAdmin(useMe().data)
}

export function useIsAdmin(): boolean {
  return isAdmin(useMe().data)
}

export function useIsViewer(): boolean {
  return isViewer(useMe().data)
}

export function useCan(...features: Feature[]): boolean {
  return canUse(useMe().data, ...features)
}

export function useCanWrite(...features: Feature[]): boolean {
  return canWrite(useMe().data, ...features)
}

export function usePlatformAdminName(): string | null {
  const me = useMe().data
  if (!me || me.state !== 'signed_in') return null
  return me.platformAdminName ?? null
}
