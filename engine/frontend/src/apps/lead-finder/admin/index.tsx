import { useEffect, useRef } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router'
import { TabIndicator } from '@/components/motion'
import { PageHeader } from '@/components/page-header'
import { cn } from '@/lib/utils'
import { ADMIN_TABS, adminTabAt, isWithin } from '@/shell/nav'

/**
 * The Admin page: what every project shares. It opens on Health (PLAN-V13 T1-6). Its tabs are links
 * (each tab has its own address, so a tab can be shared and the back button works), and the open
 * tab shows below them, with its purpose in one short line between. A project's own admin, like the
 * Lead Finder's Rules, lives in that project's menu instead.
 *
 * The selected tab has an accent underline that slides from the old tab to the new one (the motion
 * kit's `TabIndicator`; with reduced motion it just moves).
 *
 * The tabs stay in one row. When the screen is too narrow for them, the row scrolls sideways
 * (it reaches the screen's edges on a phone, so a tab cut off at the edge shows there is more), and
 * the open tab is scrolled into view, so it is never hidden. Three rows of wrapped tabs would push
 * the content a third of a screen down.
 */
export default function AdminPage() {
  const { pathname } = useLocation()
  const tab = adminTabAt(pathname)
  const tabs = useRef<HTMLElement>(null)
  useEffect(() => {
    tabs.current?.querySelector('[aria-current=page]')?.scrollIntoView({
      inline: 'center',
      block: 'nearest',
    })
  }, [pathname])
  return (
    <>
      <PageHeader title="Admin" description="What every project shares, and whether it works." />
      <nav
        ref={tabs}
        aria-label="Admin sections"
        className="-mx-4 -mt-2 flex gap-1 overflow-x-auto border-b px-4 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden"
      >
        {ADMIN_TABS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                // The row scrolls sideways, which would clip a ring drawn outside the tab, so the
                // focus ring is drawn just inside it.
                'relative flex shrink-0 items-center gap-2 rounded-t-md px-3 py-2 text-ui whitespace-nowrap transition-colors touch:min-h-11 duration-(--duration-fast) ease-(--ease) focus-visible:outline-offset-[-2px]',
                isActive
                  ? 'font-semibold text-foreground'
                  : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
              )
            }
          >
            <Icon aria-hidden="true" className="size-4" />
            <span>{label}</span>
            <TabIndicator group="admin-tabs" active={isWithin(pathname, to)} />
          </NavLink>
        ))}
      </nav>
      {/* What this tab is for, under the tabs and above its content, so it changes with the tab. */}
      {tab?.purpose ? (
        <p data-slot="admin-purpose" className="text-ui text-muted-foreground">
          {tab.purpose}
        </p>
      ) : null}
      <Outlet />
    </>
  )
}
