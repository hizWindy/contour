import { useEffect, useRef } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router'
import { PageHeader } from '@/components/page-header'
import { cn } from '@/lib/utils'
import { ADMIN_TABS, adminTabAt } from '@/shell/nav'

/**
 * The Admin page: what every project shares. Its tabs are links (each tab has its own address, so
 * a tab can be shared and the back button works), and the open tab shows below them. A project's
 * own admin, like the Lead Finder's Rules, lives in that project's menu instead.
 *
 * The tabs stay in one row. When the screen is too narrow for them, the row scrolls sideways
 * (it reaches the screen's edges on a phone, so a tab cut off at the edge shows there is more), and the
 * open tab is scrolled into view, so it is never hidden. Three rows of wrapped tabs would push
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
      <PageHeader
        title="Admin"
        description="What every project shares: runs and cost, schedules, the search log, memory, HubSpot and the settings."
      />
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
                '-mb-px flex shrink-0 items-center gap-2 rounded-t-md border-b-2 px-3 py-2 text-ui whitespace-nowrap transition-colors touch:min-h-11 duration-(--duration-fast) ease-(--ease)',
                isActive
                  ? 'border-primary font-semibold text-foreground'
                  : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground',
              )
            }
          >
            <Icon aria-hidden="true" className="size-4" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
      {/* What this tab is for, under the tabs and above its content, so it changes with the tab. */}
      {tab?.purpose ? (
        <p data-slot="admin-purpose" className="max-w-prose text-ui text-muted-foreground">
          {tab.purpose}
        </p>
      ) : null}
      <Outlet />
    </>
  )
}
