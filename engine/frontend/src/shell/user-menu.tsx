/**
 * Who is signed in, and "Sign out", at the end of the top bar (PLAN-V6 C3). It is one button at the
 * top right, where people look for their account: your initials and name. It opens a small menu
 * with who you are (name, email, role) and "Sign out". Nothing shows when sign-in is off on this
 * backend, because there is no one to sign out. Signing out ends this browser's session; the
 * sign-in guard then shows the login page with "You signed out."
 */
import { ChevronDown, LogOut } from 'lucide-react'
import { useLogout, useMe } from '@/api/hooks'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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

export function UserMenu() {
  const me = useMe()
  const logout = useLogout()
  if (me.data?.state !== 'signed_in') {
    return null
  }
  const { name, email, role } = me.data.user
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* From a tablet up the name shows beside the initials. A phone has room for the initials
            only, so the button is the same size as the search button next to it. */}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="shrink-0 gap-2 pr-2 pl-1.5 max-sm:w-10 max-sm:px-0"
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
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="flex items-center gap-3 p-2 font-normal text-foreground">
          <Initials name={name} className="size-9 text-ui" />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-ui font-semibold">{name}</span>
            <span className="truncate text-caption text-muted-foreground">{email}</span>
            <span className="text-caption text-muted-foreground">{ROLE_NAMES[role]}</span>
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
    </DropdownMenu>
  )
}
