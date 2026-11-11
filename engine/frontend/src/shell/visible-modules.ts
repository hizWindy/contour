/**
 * The projects this person may use (PLAN-V9 E1). An Admin, or anyone where sign-in is off, sees them
 * all. Anyone else sees a project only when their account lists it (the Lead Finder tick on the
 * People tab). The backend refuses the project's routes either way: this only keeps the menu, Home
 * and Ctrl+K from offering what would answer "Not open to you".
 *
 * While nobody knows who this is (still asking, or the question failed), it offers none
 * (PLAN-V15 T2-5): showing every project to someone whose access isn't known was wrong.
 */
import { useMe } from '@/api/hooks'
import type { SignIn } from '@/api/hooks/auth'
import { MODULES } from '@/modules'
import type { AppModule } from './nav'

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
  const { user } = signIn
  if (user.role === 'admin') {
    return modules
  }
  return modules.filter((module) => module.app === undefined || user.apps.includes(module.app))
}

export function useVisibleModules(): readonly AppModule[] {
  return visibleModules(useMe().data)
}
