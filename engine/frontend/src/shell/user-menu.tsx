/**
 * Who is signed in, and "Sign out", at the end of the top bar (PLAN-V6 C3). Nothing shows when
 * sign-in is off on this backend, because there is no one to sign out. Signing out ends this
 * browser's session; the sign-in guard then shows the login page with "You signed out."
 */
import { LogOut, UserRound } from 'lucide-react'
import { useLogout, useMe } from '@/api/hooks'
import { Button } from '@/components/ui/button'

export function UserMenu() {
  const me = useMe()
  const logout = useLogout()
  if (me.data?.state !== 'signed_in') {
    return null
  }
  const { name } = me.data.user
  return (
    <div className="flex shrink-0 items-center gap-1 sm:gap-2">
      {/* On a phone the top bar has no room for the name; the button still says what it does. */}
      <span
        className="hidden max-w-40 items-center gap-1.5 text-ui text-muted-foreground sm:flex"
        title={name}
      >
        <UserRound aria-hidden="true" className="size-4 shrink-0" />
        <span className="sr-only">Signed in as </span>
        <span className="truncate">{name}</span>
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={logout.isPending}
        onClick={() => {
          logout.mutate(undefined)
        }}
      >
        <LogOut aria-hidden="true" />
        <span className="max-sm:sr-only">Sign out</span>
      </Button>
    </div>
  )
}
