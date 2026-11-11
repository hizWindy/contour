/**
 * The word for each role, wherever a role shows: the account menu, the People tab and its "Role"
 * choice (PLAN-V13 T1-4). The person who runs the platform is a "System admin". The backend still
 * calls the role `admin`.
 */
import type { SignedInUser } from '@/api/hooks'

export type Role = SignedInUser['role']

export const ROLE_NAMES: Record<Role, string> = {
  admin: 'System admin',
  staff: 'Staff',
  viewer: 'Viewer',
}

/** The word for a role. A role this website doesn't know yet shows as the backend sends it. */
export function roleName(role: string): string {
  return role in ROLE_NAMES ? ROLE_NAMES[role as Role] : role
}
