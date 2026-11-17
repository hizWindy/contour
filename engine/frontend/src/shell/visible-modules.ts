/**
 * The projects and pages this person may use (PLAN-V9 E1, PLAN-V19 T3-2 & T3-4). A Platform
 * admin or Admin, or anyone where sign-in is off, gets all project ticks; only the Platform
 * admin sees Platform-admin-only pages (`Test set`, `Admin`). Anyone else sees a project and its
 * pages only when their ticks allow them. The backend refuses the routes either way: this keeps
 * the menu, Home and Ctrl+K from offering what would answer 403.
 *
 * While nobody knows who this is (still asking, or the question failed), it offers none
 * (PLAN-V15 T2-5).
 */
import { useMe } from '@/api/hooks'
import type { SignIn } from '@/api/hooks/auth'
import { canSeeModule, canUse, isPlatformAdmin } from '@/auth/can'
import { MODULES } from '@/modules'
import type { AppModule, NavItem } from './nav'

export function canSeePage(signIn: SignIn | undefined, item: NavItem): boolean {
  if (signIn === undefined || signIn.state === 'signed_out') {
    return false
  }
  if (signIn.state === 'off') {
    return true
  }
  if (item.platformAdminOnly) {
    return isPlatformAdmin(signIn)
  }
  if (item.features && item.features.length > 0) {
    return canUse(signIn, ...item.features)
  }
  return true
}

export function visiblePages(
  signIn: SignIn | undefined,
  pages: readonly NavItem[],
): readonly NavItem[] {
  return pages.filter((item) => canSeePage(signIn, item))
}

export function useVisiblePages(pages: readonly NavItem[]): readonly NavItem[] {
  return visiblePages(useMe().data, pages)
}

export function visibleModules(
  signIn: SignIn | undefined,
  modules: readonly AppModule[] = MODULES,
): readonly AppModule[] {
  if (signIn === undefined || signIn.state === 'signed_out') {
    return [] // access not known (yet)
  }
  if (signIn.state === 'off') {
    return modules
  }
  return modules.filter(
    (module) =>
      canSeeModule(signIn, module.app) &&
      (module.pages.length === 0 || visiblePages(signIn, module.pages).length > 0),
  )
}

export function useVisibleModules(): readonly AppModule[] {
  return visibleModules(useMe().data)
}
