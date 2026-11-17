/**
 * The word for each role, wherever a role shows: the account menu, the People tab and its "Role"
 * choice (PLAN-V19 T3-2).
 */
import type { SignedInUser } from '@/api/hooks'

export type Role = SignedInUser['role']

export const ROLE_NAMES: Record<Role, string> = {
  platform_admin: 'Platform admin',
  admin: 'Admin',
  staff: 'Staff',
  viewer: 'Viewer',
}

/** The word for a role. A role this website doesn't know yet shows as the backend sends it. */
export function roleName(role: string): string {
  return role in ROLE_NAMES ? ROLE_NAMES[role as Role] : role
}
