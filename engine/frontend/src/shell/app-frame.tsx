import { Outlet, ScrollRestoration } from 'react-router'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { AppSidebar } from './app-sidebar'
import { TopBar } from './top-bar'

/** Where "Skip to the page" lands: the page content, after the menu and the top bar. */
export const MAIN_ID = 'page'

/**
 * The frame around every page: a skip link, the menu on the left, the top bar, then the page,
 * up to 1440px wide (tables and the map may use all of it).
 */
export function AppFrame() {
  return (
    <SidebarProvider>
      <a
        href={`#${MAIN_ID}`}
        className="sr-only z-50 rounded-md border bg-card px-4 py-2 text-ui text-foreground focus:not-sr-only focus:fixed focus:top-4 focus:left-4"
      >
        Skip to the page
      </a>
      <AppSidebar />
      <SidebarInset>
        <TopBar />
        <div
          id={MAIN_ID}
          tabIndex={-1}
          className="mx-auto flex w-full max-w-(--content-max) flex-1 flex-col gap-6 p-6 outline-none"
        >
          <Outlet />
        </div>
      </SidebarInset>
      <ScrollRestoration />
    </SidebarProvider>
  )
}
