import { Suspense, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { Outlet, ScrollRestoration, useLocation, useNavigation } from 'react-router'
import { useStill } from '@/components/motion/use-still'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { useAfterActive } from '@/lib/use-after'
import { cn } from '@/lib/utils'
import { AppSidebar } from './app-sidebar'
import { ConnectionBar } from './connection-bar'
import { InFrameContext } from './in-frame'
import { RequireSignIn } from './require-sign-in'
import { TopBar } from './top-bar'
import { useVisibleModules } from './visible-modules'

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

/** How long a new page takes to ease in (the one curve), and how faint it starts. */
const ENTER_MS = 160
const ENTER_FROM = 0.55

/**
 * The page's own address: its first two parts, so `/assistant/meetings` is one page whatever its
 * tab, search or filter says, and a lead or a run is a page of its own.
 */
function pageOf(pathname: string): string {
  return pathname.split('/').slice(0, 3).join('/')
}

/**
 * A new page eases in (Improvements 1, #8): its content comes up from 55% to full in 160ms. Only
 * the opacity moves: a transform on the page would make it the home of every fixed bar inside it,
 * like the send bar a phone page holds at the bottom. It is never held back: the page is there and
 * readable from the first frame. With reduced motion it simply changes. The first page of a visit
 * has its own fade (the frame's), so it is left alone here.
 */
function useEnter(page: RefObject<HTMLElement | null>, key: string): void {
  const still = useStill()
  const first = useRef(true)
  useLayoutEffect(() => {
    if (first.current) {
      first.current = false
      return undefined
    }
    const element = page.current
    if (still || !element || typeof element.animate !== 'function') return undefined
    const run = element.animate([{ opacity: ENTER_FROM }, { opacity: 1 }], {
      duration: ENTER_MS,
      easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
    })
    return () => {
      run.cancel()
    }
  }, [key, page, still])
}

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

/**
 * The parts a project draws once in the frame (`AppModule.frame`), like the mic check that Ctrl+K
 * and the account menu open (PLAN-V18 T3-4). Each draws nothing until it is asked, and may load
 * late. Only the projects this person may use.
 */
function FrameParts() {
  const modules = useVisibleModules()
  return modules.map((app) => {
    const Part = app.frame
    return Part ? (
      <Suspense key={app.id} fallback={null}>
        <Part />
      </Suspense>
    ) : null
  })
}

function Frame() {
  const [openAtStart] = useState(() => window.matchMedia(WIDE_SCREEN).matches)
  // A click on a page whose code is still on its way changes nothing for a moment. After 200 ms the
  // page you are leaving dims, the way a table dims while its next page loads (PLAN-V7 B3).
  const leaving = useAfterActive(useNavigation().state === 'loading')
  const page = useRef<HTMLDivElement>(null)
  useEnter(page, pageOf(useLocation().pathname))
  return (
    <InFrameContext value>
      <SidebarProvider defaultOpen={openAtStart}>
        {/* The first thing Tab reaches: it shows as it gets the focus, and Enter puts the focus on
            the page itself, past the menu and the top bar (PLAN-V23 T4-5: 18 Tabs before Today's
            rows without it). The focus moves by hand, so the address gets no #page and the page
            isn't drawn again. */}
        <a
          href={`#${MAIN_ID}`}
          // Off the screen until it has the focus, then a small card at the top left. (Tailwind's
          // `not-sr-only` set its padding to 0, so it showed as bare text over the menu.)
          className="fixed top-4 left-4 z-60 -translate-y-[200%] rounded-md border bg-card px-4 py-2 text-ui text-foreground shadow-float focus:translate-y-0"
          onClick={(event) => {
            const target = page.current
            if (!target) return
            event.preventDefault()
            target.focus()
          }}
        >
          Skip to the page
        </a>
        <AppSidebar />
        {/* The page fades in once, when the frame first shows (after signing in, or on a reload). */}
        <SidebarInset className="min-w-0 animate-in fade-in-0 duration-250">
          {/* While the connection isn't fine: one thin line, instead of a red box in every card. */}
          <ConnectionBar />
          <TopBar />
          <div
            id={MAIN_ID}
            ref={page}
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
        <FrameParts />
      </SidebarProvider>
    </InFrameContext>
  )
}
