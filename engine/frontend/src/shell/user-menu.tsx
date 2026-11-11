/**
 * Who is signed in, and "Sign out" (PLAN-V6 C3, PLAN-V13 T1-6). Two buttons open the same small
 * menu with who you are (name, email, role) and "Sign out":
 *
 * - `SidebarAccount`, at the foot of the left menu, like the dashboards people know: your
 *   initials, your name and your role ("Al-khair M. Pama, System admin"). Folded to icons, it
 *   shows the initials, with the name and role in a tooltip.
 * - `UserMenu`, at the end of the top bar, on a phone only, where the left menu is hidden behind
 *   its button.
 *
 * Nothing shows when sign-in is off on this backend, because there is no one to sign out. Signing
 * out ends this browser's session; the sign-in guard then shows the login page with "You signed
 * out."
 */
import { ChevronDown, ChevronsUpDown, LogOut } from 'lucide-react'
import { useLogout, useMe, type SignedInUser } from '@/api/hooks'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'
import { ROLE_NAMES } from './roles'

/** The first letter of the first two words: "Sample Admin" gives "SA", "Al-khair" gives "A". */
function initialsOf(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter((word) => word !== '')
    .slice(0, 2)
    .map((word) => Array.from(word).at(0) ?? '')
  return letters.join('').toUpperCase() || '?'
}

/**
 * A small square with a person's initials. It is for the eye only: the name is always written
 * beside it or inside the menu, so a screen reader skips it.
 */
function Initials({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-6 shrink-0 items-center justify-center rounded-md border border-input bg-card text-caption font-semibold text-foreground',
        className,
      )}
    >
      {initialsOf(name)}
    </span>
  )
}

/** What the menu holds: who you are, then "Sign out". */
function AccountMenuContent({
  user,
  side,
}: {
  user: SignedInUser
  side?: 'right' | 'bottom' | 'top'
}) {
  const logout = useLogout()
  return (
    <DropdownMenuContent align="end" side={side} className="w-64">
      <DropdownMenuLabel className="flex items-center gap-3 p-2 font-normal text-foreground">
        <Initials name={user.name} className="size-9 text-ui" />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-ui font-semibold">{user.name}</span>
          <span className="truncate text-caption text-muted-foreground">{user.email}</span>
          <span className="text-caption text-muted-foreground">{ROLE_NAMES[user.role]}</span>
        </span>
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        className="touch:min-h-11"
        disabled={logout.isPending}
        onSelect={() => {
          logout.mutate(undefined)
        }}
      >
        <LogOut aria-hidden="true" />
        Sign out
      </DropdownMenuItem>
    </DropdownMenuContent>
  )
}

/** The signed-in person, or null when no one is (sign-in off, or still asking). */
function useSignedInUser(): SignedInUser | null {
  const me = useMe()
  return me.data?.state === 'signed_in' ? me.data.user : null
}

/** The account at the end of the top bar. `className` hides it where the left menu shows it. */
export function UserMenu({ className }: { className?: string }) {
  const user = useSignedInUser()
  const logout = useLogout()
  if (!user) {
    return null
  }
  const { name } = user
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* From a tablet up the name shows beside the initials. A phone has room for the initials
            only, so the button is the same size as the search button next to it. */}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn('shrink-0 gap-2 pr-2 pl-1.5 max-sm:w-10 max-sm:px-0', className)}
          aria-label={`Account menu, ${name}`}
          disabled={logout.isPending}
        >
          <Initials name={name} />
          <span className="max-w-40 truncate max-sm:hidden" title={name}>
            {name}
          </span>
          <ChevronDown aria-hidden="true" className="text-muted-foreground max-sm:hidden" />
        </Button>
      </DropdownMenuTrigger>
      <AccountMenuContent user={user} />
    </DropdownMenu>
  )
}

/** The account at the foot of the left menu: initials, name and role. It opens the account menu. */
export function SidebarAccount() {
  const user = useSignedInUser()
  if (!user) {
    return null
  }
  const role = ROLE_NAMES[user.role]
  return (
    <SidebarMenuItem>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuButton
            size="lg"
            tooltip={`${user.name}, ${role}`}
            aria-label={`Account menu, ${user.name}, ${role}`}
            className="data-[state=open]:bg-sidebar-accent"
          >
            <Initials name={user.name} className="size-8 text-ui" />
            <span className="flex min-w-0 flex-1 flex-col text-left leading-tight">
              <span className="truncate font-semibold">{user.name}</span>
              <span className="truncate text-caption text-muted-foreground">{role}</span>
            </span>
            <ChevronsUpDown aria-hidden="true" className="ml-auto size-4 text-muted-foreground" />
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <AccountMenuContent user={user} side="right" />
      </DropdownMenu>
    </SidebarMenuItem>
  )
}
