import { useState } from 'react'
import { Outlet, ScrollRestoration, useNavigation } from 'react-router'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { useAfterActive } from '@/lib/use-after'
import { cn } from '@/lib/utils'
import { AppSidebar } from './app-sidebar'
import { RequireSignIn } from './require-sign-in'
import { TopBar } from './top-bar'

/** Where "Skip to the page" lands: the page content, after the menu and the top bar. */
export const MAIN_ID = 'page'

/**
 * The frame around every page: a skip link, the menu on the left, the top bar, then the page,
 * up to 1440px wide (tables and the map may use all of it).
 *
 * `min-w-0` on the page area lets it shrink to the window: a wide table then scrolls inside its
 * own box, instead of making the whole page scroll sideways and cutting off the buttons on the
 * right. The padding is smaller on a phone.
 *
 * The menu opens wide on a laptop screen (1024px and up). On a tablet it starts folded to its icons,
 * so the page keeps the room; the button in the top bar opens it. On a phone it is a panel that
 * slides in.
 */
const WIDE_SCREEN = '(min-width: 1024px)'

/**
 * The frame shows only once the backend says the person may see it (`RequireSignIn`): with
 * sign-in off, or signed in. Signed out, the login page shows instead.
 */
export function AppFrame() {
  return (
    <RequireSignIn>
      <Frame />
    </RequireSignIn>
  )
}

function Frame() {
  const [openAtStart] = useState(() => window.matchMedia(WIDE_SCREEN).matches)
  // A click on a page whose code is still on its way changes nothing for a moment. After 200 ms the
  // page you are leaving dims, the way a table dims while its next page loads (PLAN-V7 B3).
  const leaving = useAfterActive(useNavigation().state === 'loading')
  return (
    <SidebarProvider defaultOpen={openAtStart}>
      <a
        href={`#${MAIN_ID}`}
        className="sr-only z-50 rounded-md border bg-card px-4 py-2 text-ui text-foreground focus:not-sr-only focus:fixed focus:top-4 focus:left-4"
      >
        Skip to the page
      </a>
      <AppSidebar />
      {/* The page fades in once, when the frame first shows (after signing in, or on a reload). */}
      <SidebarInset className="min-w-0 animate-in fade-in-0 duration-250">
        <TopBar />
        <div
          id={MAIN_ID}
          tabIndex={-1}
          aria-busy={leaving || undefined}
          className={cn(
            'mx-auto flex w-full max-w-(--content-max) min-w-0 flex-1 flex-col gap-6 p-4 outline-none transition-opacity duration-(--duration-fast) ease-(--ease) sm:p-6',
            leaving && 'opacity-60',
          )}
        >
          <Outlet />
        </div>
      </SidebarInset>
      <ScrollRestoration />
    </SidebarProvider>
  )
}
